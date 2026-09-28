import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { resolveModelProvider } from "@workspace/ai-server";
import {
  agentsTable,
  agentInteractionRequestsTable,
  tasksTable,
  db,
} from "@workspace/db";
import {
  SendAgentRequestBody,
  SendAgentRequestResponse,
  GetAgentRequestParams,
} from "@workspace/api-zod";
import { parsePositiveInteger } from "../lib/http-params";
import { createRateLimiter } from "../lib/rate-limit";
import { requireHttpRuntimeHandle } from "../lib/http-runtime-context";
import { AgentConfigChanged } from "../lib/agent-config-version";
import {
  createProjectWithinTransaction,
  TaskOwnerUnavailable,
  ActiveWorkforceUnavailable,
} from "../lib/create-project";
import {
  AgentBusyError,
  ProjectChatUnavailableError,
  runAgentTurn,
} from "../lib/orchestrator/run-agent-turn";
import {
  EmergencyStopError,
  lockRuntimeControlState,
  type RuntimeTransaction,
} from "../lib/orchestrator/runtime-emergency-stop";
import { RuntimeCapacityError } from "../lib/orchestrator/runtime-capacity";
import { RuntimeClaimAdmissionError } from "../lib/orchestrator/runtime-instance-registry";
import { logger } from "../lib/logger";

class RequestConflict extends Error {}
type Input = ReturnType<typeof SendAgentRequestBody.parse>;
type Receipt = ReturnType<typeof SendAgentRequestResponse.parse>;

function rejectedCode(error: unknown): string | undefined {
  if (
    error instanceof AgentConfigChanged ||
    error instanceof EmergencyStopError ||
    error instanceof RuntimeCapacityError ||
    error instanceof ProjectChatUnavailableError
  )
    return error.code;
  if (error instanceof AgentBusyError) return "AGENT_BUSY";
  if (
    error instanceof TaskOwnerUnavailable ||
    error instanceof ActiveWorkforceUnavailable
  )
    return "AGENT_UNAVAILABLE";
  if (error instanceof RuntimeClaimAdmissionError) return "RUNTIME_UNAVAILABLE";
  return undefined;
}

export function createAgentRequestsRouter(
  dependencies: { runTurn?: typeof runAgentTurn } = {},
): IRouter {
  const router = Router();
  const limiter = createRateLimiter({
    namespace: "agent-requests",
    max: 12,
    windowMs: 60_000,
  });
  const runTurn = dependencies.runTurn ?? runAgentTurn;

  async function read(requestId: string) {
    return (
      await db
        .select()
        .from(agentInteractionRequestsTable)
        .where(eq(agentInteractionRequestsTable.requestId, requestId))
    )[0];
  }
  function receipt(
    input: Input,
    agentId: number,
    patch: Record<string, unknown> = {},
  ): Receipt {
    return SendAgentRequestResponse.parse({
      requestId: input.requestId,
      agentId,
      kind: input.kind,
      ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      deliveryState: "unconfirmed",
      outcome: "unconfirmed",
      replayed: false,
      createdTasks: [],
      createdAgents: [],
      ...patch,
    });
  }
  async function save(
    tx: RuntimeTransaction,
    requestId: string,
    requestHash: string,
    value: Receipt,
  ) {
    const [updated] = await tx
      .update(agentInteractionRequestsTable)
      .set({
        // JSON roundtrip is deliberate: stored receipts use the same ISO dates as HTTP.
        response: JSON.parse(
          JSON.stringify(SendAgentRequestResponse.parse(value)),
        ) as Record<string, unknown>,
      })
      .where(
        and(
          eq(agentInteractionRequestsTable.requestId, requestId),
          eq(agentInteractionRequestsTable.requestHash, requestHash),
        ),
      )
      .returning({ requestId: agentInteractionRequestsTable.requestId });
    if (!updated) throw new Error("Send receipt is missing or changed");
  }

  router.get(
    "/agents/:agentId/requests/:requestId",
    async (req, res): Promise<void> => {
      const params = GetAgentRequestParams.safeParse(req.params);
      const id = parsePositiveInteger(req.params.agentId, "agentId", {
        maximum: 2147483647,
      });
      if (!params.success || !id.ok) {
        res.status(400).json({
          code: "AGENT_REQUEST_INVALID",
          error: "Invalid request identity",
        });
        return;
      }
      const stored = await read(params.data.requestId);
      if (!stored || stored.agentId !== params.data.agentId) {
        res.status(404).json({
          code: "AGENT_REQUEST_NOT_FOUND",
          error: "Receipt not found",
        });
        return;
      }
      res.json(
        SendAgentRequestResponse.parse({ ...stored.response, replayed: true }),
      );
    },
  );

  router.post(
    "/agents/:agentId/requests",
    limiter,
    async (req, res): Promise<void> => {
      const id = parsePositiveInteger(req.params.agentId, "agentId", {
        maximum: 2147483647,
      });
      const parsed = SendAgentRequestBody.strict().safeParse(req.body);
      if (!id.ok || !parsed.success) {
        res
          .status(400)
          .json({ code: "AGENT_REQUEST_INVALID", error: "Invalid request" });
        return;
      }
      const input = parsed.data;
      if (
        !input.content.trim() ||
        (input.taskId !== undefined && input.kind !== "ask") ||
        (input.kind !== "ask" &&
          (input.content.length > 8000 ||
            input.modelMode !== undefined ||
            input.modelId !== undefined)) ||
        (input.modelMode === "manual" && !input.modelId?.trim()) ||
        (input.modelId !== undefined &&
          (input.modelMode !== "manual" ||
            input.modelId !== input.modelId.trim() ||
            !resolveModelProvider(input.modelId)))
      ) {
        res.status(400).json({
          code: "AGENT_REQUEST_INVALID",
          error: "Invalid content or model selection",
        });
        return;
      }
      const agentId = id.value;
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify([
            // Preserve the original direct-request hash so existing receipts
            // remain replayable after upgrading. Scoped requests use a distinct
            // domain and bind the project without ever degrading to direct chat.
            ...(input.taskId === undefined
              ? ["agent-request-v1"]
              : ["project-chat-request-v1", input.taskId]),
            agentId,
            input.kind,
            input.content,
            input.locale,
            input.modelMode ?? null,
            input.modelId ?? null,
            input.expectedConfig ?? null,
          ]),
        )
        .digest("hex");
      try {
        // Short serialized reservation. Only its creator may dispatch; a restart or
        // a concurrent replay never takes over an unconfirmed request.
        const existing = await db.transaction(async (tx) => {
          await lockRuntimeControlState(tx);
          const [stored] = await tx
            .select()
            .from(agentInteractionRequestsTable)
            .where(
              eq(agentInteractionRequestsTable.requestId, input.requestId),
            );
          if (stored) {
            if (
              stored.agentId !== agentId ||
              stored.requestHash !== requestHash
            )
              throw new RequestConflict();
            return stored.response;
          }
          await tx.insert(agentInteractionRequestsTable).values({
            requestId: input.requestId,
            agentId,
            requestHash,
            response: receipt(input, agentId),
          });
          return undefined;
        });
        if (existing) {
          res.json(
            SendAgentRequestResponse.parse({ ...existing, replayed: true }),
          );
          return;
        }
        try {
          if (input.kind !== "ask") {
            const result = await db.transaction(async (tx) => {
              const task = await createProjectWithinTransaction(
                tx,
                {
                  title: input.content.trim().slice(0, 88),
                  brief: input.content,
                  ownerAgentId: agentId,
                  autonomyMode:
                    input.kind === "continuous" ? "continuous" : "finite",
                  ...(input.kind === "continuous"
                    ? { cadenceSeconds: 3600 }
                    : {}),
                },
                input.expectedConfig,
              );
              const complete = receipt(input, agentId, {
                deliveryState: "complete",
                outcome: "queued",
                task,
                createdTasks: [task],
              });
              await save(tx, input.requestId, requestHash, complete);
              return complete;
            });
            res.json(result);
            return;
          }
          const [agent] = await db
            .select()
            .from(agentsTable)
            .where(eq(agentsTable.id, agentId));
          if (!agent?.isActive) throw new TaskOwnerUnavailable();
          const task =
            input.taskId === undefined
              ? undefined
              : (
                  await db
                    .select()
                    .from(tasksTable)
                    .where(eq(tasksTable.id, input.taskId))
                )[0];
          if (
            input.taskId !== undefined &&
            (!task || task.ownerAgentId !== agentId)
          )
            throw new ProjectChatUnavailableError();
          await runTurn(
            agent,
            input.content,
            { modelMode: input.modelMode, modelId: input.modelId },
            task,
            {
              runtimeHandle: requireHttpRuntimeHandle(),
              locale: input.locale,
              expectedConfig: input.expectedConfig,
              onAccepted: async (tx, userMessage) => {
                await save(
                  tx,
                  input.requestId,
                  requestHash,
                  receipt(input, agentId, { userMessage }),
                );
              },
              onCompleted: async (tx, result) => {
                await save(
                  tx,
                  input.requestId,
                  requestHash,
                  receipt(input, agentId, {
                    ...result,
                    deliveryState: "complete",
                    outcome: result.outcome ?? "reply",
                  }),
                );
              },
            },
          );
        } catch (error) {
          const stored = await read(input.requestId);
          if (!stored) throw error;
          const saved = SendAgentRequestResponse.parse(stored.response);
          // A cleanup failure after commit must not erase a completed receipt. A
          // saved user message means execution was admitted: never claim rejection.
          const code = rejectedCode(error);
          if (
            saved.deliveryState === "unconfirmed" &&
            !saved.userMessage &&
            code
          ) {
            await db.transaction((tx) =>
              save(
                tx,
                input.requestId,
                requestHash,
                receipt(input, agentId, {
                  deliveryState: "rejected",
                  outcome: "rejected",
                  failureCode: code,
                }),
              ),
            );
          } else {
            logger.warn(
              { error, requestId: input.requestId, agentId },
              "Agent request ended; recover its durable receipt before starting new work",
            );
          }
        }
        const stored = await read(input.requestId);
        if (!stored) throw new Error("Send receipt is missing");
        res.json(SendAgentRequestResponse.parse(stored.response));
      } catch (error) {
        if (error instanceof RequestConflict) {
          res.status(409).json({
            code: "AGENT_REQUEST_CONFLICT",
            error: "Request identity belongs to another intent",
          });
          return;
        }
        throw error;
      }
    },
  );
  return router;
}

export default createAgentRequestsRouter();
