import { terminalMessage } from "../vm/terminal-localization";
import {
  getToolCopy,
  toolDispatchText,
  toolMessage,
} from "./tool-localization";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type OpenAI from "openai";
import {
  createChatCompletion,
  completionTokenControl,
  chatGPTPlanHistoryMessage,
  DEFAULT_MAX_COMPLETION_TOKENS,
} from "@workspace/ai-server";
import {
  db,
  activityEventsTable,
  agentsTable,
  messagesTable,
  operationReceiptsTable,
  operationInvocationsTable,
  tasksTable,
  type Agent,
  type Task,
  type Message,
} from "@workspace/db";
import { logger } from "../logger";
import { redactAuditText } from "../audit-redaction";
import { assertAgentConfig } from "../agent-config-version";
import { readWorkspaceLocale, type WorkspaceLocale } from "../workspace-locale";
import { chatTurnCopy } from "./chat-turn-copy";
import { getToolsForAgent } from "./tools";
import { executeTool } from "./execute-tool";
import { buildChatSystemPrompt } from "./system-prompt";
import { selectModel, type ModelOverrideInput } from "./model-select";
import { runAccountedCompletion } from "./inference-accounting";
import {
  computerSurfaceForTool,
  deferredComputerToolMessage,
  isComputerTool,
  resolveMaxToolCallsPerRound,
  resolveMaxToolRounds,
  shouldDeferComputerTool,
} from "./tool-loop-policy";
import { computerStepDetail, recordComputerDecision } from "./computer-session";
import {
  assertExecutionAllowed,
  lockAndAssertExecutionAllowed,
  type RuntimeTransaction,
} from "./runtime-emergency-stop";
import { toolResultForModel } from "./untrusted-tool-output";
import { assertMessageCapacity } from "./runtime-capacity";
import {
  deriveExclusiveTurnPolicy,
  evaluateExclusiveToolCall,
  exclusiveToolBlockedMessage,
  exclusiveTurnSystemPrompt,
  filterToolsForExclusiveTurn,
} from "./exclusive-turn-policy";
import {
  lockAndAssertRuntimeCanFinalizeInteractive,
  lockAndAssertRuntimeCanServeInteractive,
  RuntimeClaimAdmissionError,
  type RuntimeInstanceHandle,
} from "./runtime-instance-registry";

const HISTORY_LIMIT = 20;
const TERMINAL_CHAT_TOOLS = new Set(["request_approval"]);
const CHAT_LEASE_MS = 15 * 60_000;

export class AgentBusyError extends Error {}
export class ProjectChatUnavailableError extends Error {
  readonly code = "PROJECT_CHAT_UNAVAILABLE";
  constructor() {
    super(
      "The project is unavailable or its coordinator changed. Refresh before starting another request.",
    );
    this.name = "ProjectChatUnavailableError";
  }
}

export interface AgentTurnResult {
  userMessage: Message;
  agentMessage: Message;
  createdTasks: Task[];
  createdAgents: Agent[];
  usedModel: string | null;
  usedProvider: string | null;
  outcome?:
    | "reply"
    | "provider_error"
    | "empty_response"
    | "tool_limit"
    | "tool_outcome_unknown"
    | "tool_deferred"
    | "approval_review"
    | "round_limit";
}

export interface RunAgentTurnDependencies {
  /** Exact locally-owned API/combined incarnation admitting this HTTP turn. */
  runtimeHandle: RuntimeInstanceHandle;
  createCompletion?: typeof createChatCompletion;
  runTool?: typeof executeTool;
  locale?: WorkspaceLocale;
  expectedConfig?: string;
  /** Receipt updates share the message transaction; never dispatch external work here. */
  onAccepted?: (tx: RuntimeTransaction, message: Message) => Promise<void>;
  onCompleted?: (
    tx: RuntimeTransaction,
    result: AgentTurnResult,
  ) => Promise<void>;
}

export async function runAgentTurn(
  agent: Agent,
  userContent: string,
  modelOverride?: ModelOverrideInput,
  task?: Task,
  dependencies?: RunAgentTurnDependencies,
): Promise<AgentTurnResult> {
  const createCompletion =
    dependencies?.createCompletion ?? createChatCompletion;
  const runTool = dependencies?.runTool ?? executeTool;
  const runtimeHandle = dependencies?.runtimeHandle;
  const locale = dependencies?.locale ?? (await readWorkspaceLocale());
  const statusCopy = getToolCopy(locale);
  const taskId = task?.id ?? null;
  const leaseOwner = `chat:${process.pid}:${randomUUID()}`;
  const computerLoopId = `chat-turn:${randomUUID()}`;
  const leaseStartedAt = new Date();
  const leaseExpiresAt = new Date(leaseStartedAt.getTime() + CHAT_LEASE_MS);
  const { claimed, userMessage, admittedTask } = await db.transaction(
    async (tx) => {
      await lockAndAssertExecutionAllowed(tx);
      if (!runtimeHandle) {
        throw new RuntimeClaimAdmissionError(
          "Interactive chat requires an exact HTTP runtime handle",
        );
      }
      await lockAndAssertRuntimeCanServeInteractive(tx, runtimeHandle);
      await assertMessageCapacity(tx, agent.id);
      await tx.execute(
        sql`SELECT id FROM ${agentsTable} WHERE id = ${agent.id} FOR UPDATE`,
      );
      const [reviewed] = await tx
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, agent.id));
      if (!reviewed) throw new AgentBusyError("Agent is unavailable");
      assertAgentConfig(reviewed, dependencies?.expectedConfig);
      let admittedTask: Task | undefined;
      if (taskId !== null) {
        await tx.execute(
          sql`SELECT id FROM ${tasksTable} WHERE id = ${taskId} FOR UPDATE`,
        );
        [admittedTask] = await tx
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, taskId));
        if (!admittedTask || admittedTask.ownerAgentId !== agent.id)
          throw new ProjectChatUnavailableError();
      }
      const [claimed] = await tx
        .update(agentsTable)
        .set({
          runLeaseOwner: leaseOwner,
          runLeaseExpiresAt: leaseExpiresAt,
          status: "working",
          currentTaskId: taskId,
          currentAction: statusCopy.chatAnalyzing,
          lastActiveAt: leaseStartedAt,
        })
        .where(
          and(
            eq(agentsTable.id, agent.id),
            eq(agentsTable.isActive, true),
            or(
              isNull(agentsTable.runLeaseExpiresAt),
              lt(agentsTable.runLeaseExpiresAt, leaseStartedAt),
            ),
          ),
        )
        .returning();
      if (!claimed)
        throw new AgentBusyError(
          "Agent is already handling another task or chat turn",
        );
      const [userMessage] = await tx
        .insert(messagesTable)
        .values({
          agentId: claimed.id,
          role: "user",
          content: userContent,
          taskId,
        })
        .returning();
      await dependencies?.onAccepted?.(tx, userMessage);
      return { claimed, userMessage, admittedTask };
    },
  );
  if (!claimed) {
    throw new AgentBusyError(
      "Agent is already handling another task or chat turn",
    );
  }
  // The transaction can only return a claim after validating this exact
  // handle. Repeat the fail-closed narrowing for the remaining tool loop so
  // TypeScript and future refactors cannot reintroduce a nullable identity.
  if (!runtimeHandle) {
    throw new RuntimeClaimAdmissionError(
      "Interactive chat lost its admitted HTTP runtime handle",
    );
  }
  // Permissions, prompt and model must come from the row actually claimed.
  agent = claimed;
  task = admittedTask;

  try {
    const copy = chatTurnCopy(locale);
    const historyNewestFirst = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.agentId, agent.id),
          taskId === null
            ? isNull(messagesTable.taskId)
            : eq(messagesTable.taskId, taskId),
        ),
      )
      .orderBy(desc(messagesTable.createdAt), desc(messagesTable.id))
      .limit(HISTORY_LIMIT + 1);
    const history = historyNewestFirst.reverse();

    const exclusivePolicy = deriveExclusiveTurnPolicy(userContent);
    if (exclusivePolicy) {
      await db.insert(activityEventsTable).values({
        agentId: agent.id,
        taskId,
        type: "note",
        summary: redactAuditText(
          terminalMessage(locale, "scopeActivated", {
            tools: exclusivePolicy.allowedTools.join(", "),
          }),
          500,
        ),
        detail: {
          guard: "exclusive_turn_scope",
          outcome: "activated",
          allowedFamilies: [...exclusivePolicy.families],
          allowedTools: [...exclusivePolicy.allowedTools],
          exactSudoCommandBound: Boolean(exclusivePolicy.exactSudoCommand),
        },
        severity: "info",
      });
    }
    const baseSystemPrompt = await buildChatSystemPrompt(agent, task, locale);
    const systemPrompt = exclusivePolicy
      ? `${baseSystemPrompt}\n\n${exclusiveTurnSystemPrompt(exclusivePolicy, locale)}`
      : baseSystemPrompt;
    const tools = filterToolsForExclusiveTurn(
      await getToolsForAgent(agent, false),
      exclusivePolicy,
    );
    const maxToolRounds = resolveMaxToolRounds(
      "chat",
      tools.map((tool) => tool.function.name),
    );
    const maxToolCallsPerRound = resolveMaxToolCallsPerRound();

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history
        .filter((m) => m.id !== userMessage.id && m.role !== "system")
        .map((m): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
          role: m.role === "agent" ? "assistant" : "user",
          content: m.content,
        })),
      { role: "user", content: userContent },
    ];

    const selection = selectModel({
      purpose: "chat",
      agentDepth: agent.depth,
      agent: { modelMode: agent.modelMode, modelId: agent.modelId },
      override: modelOverride,
    });
    const model = selection.modelId;
    let usedModel: string | null = null;
    let usedProvider: string | null = null;
    let outcome: NonNullable<AgentTurnResult["outcome"]> = "reply";
    let unknownOperation:
      | { receiptId: string; toolName: string; modelToolCallId: string }
      | undefined;

    const createdTasks: Task[] = [];
    const createdAgents: Agent[] = [];
    const scopeBlockedTools = new Set<string>();
    let finalText = "";

    for (let round = 0; round < maxToolRounds; round++) {
      await assertExecutionAllowed();
      const [heartbeat] = await db
        .update(agentsTable)
        .set({
          currentAction: toolMessage(locale, "chatPlanning", {
            round: round + 1,
            total: maxToolRounds,
          }),
          lastActiveAt: new Date(),
          runLeaseExpiresAt: new Date(Date.now() + CHAT_LEASE_MS),
        })
        .where(
          and(
            eq(agentsTable.id, agent.id),
            eq(agentsTable.isActive, true),
            eq(agentsTable.runLeaseOwner, leaseOwner),
            gt(agentsTable.runLeaseExpiresAt, new Date()),
          ),
        )
        .returning({ id: agentsTable.id });
      if (!heartbeat) throw new AgentBusyError("Agent chat lease was lost");
      let completion;
      try {
        const { completion: result, provider } = await runAccountedCompletion(
          {
            provider: selection.provider ?? "unknown",
            modelId: model,
            agentId: agent.id,
            taskId,
            kind: "chat",
            locale,
            agentLeaseOwner: leaseOwner,
            assertOwnership: assertExecutionAllowed,
          },
          {
            model,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            ...completionTokenControl(model, DEFAULT_MAX_COMPLETION_TOKENS),
          },
          createCompletion,
        );
        usedModel = result.model?.trim() || model;
        usedProvider = provider;
        completion = result;
      } catch (error) {
        logger.error({ error, agentId: agent.id }, "LLM chat call failed");
        outcome = "provider_error";
        finalText = copy.provider;
        break;
      }

      const choice = completion.choices[0];
      const assistantMessage = choice?.message;
      if (!assistantMessage) {
        outcome = "empty_response";
        finalText = copy.empty;
        break;
      }

      const toolCalls = assistantMessage.tool_calls ?? [];
      if (toolCalls.length === 0) {
        finalText = assistantMessage.content ?? "";
        if (!finalText.trim()) {
          outcome = "empty_response";
          finalText = copy.empty;
        }
        break;
      }
      if (toolCalls.length > maxToolCallsPerRound) {
        outcome = "tool_limit";
        finalText = copy.toolLimit;
        break;
      }

      messages.push(chatGPTPlanHistoryMessage(completion));

      let turnTerminated = false;
      let computerToolExecutedInBatch = false;
      for (const [toolIndex, toolCall] of toolCalls.entries()) {
        if (toolCall.type !== "function") continue;
        const toolName = toolCall.function.name;
        if (exclusivePolicy) {
          const scopeDecision = evaluateExclusiveToolCall(
            exclusivePolicy,
            toolName,
            toolCall.function.arguments,
          );
          if (!scopeDecision.allowed) {
            const blockedMessage = exclusiveToolBlockedMessage(
              exclusivePolicy,
              toolName,
              scopeDecision.explanation,
              locale,
              scopeDecision.reason,
            );
            scopeBlockedTools.add(toolName);
            await db.insert(activityEventsTable).values({
              agentId: agent.id,
              taskId,
              type: "note",
              summary: redactAuditText(blockedMessage, 1_000),
              detail: {
                guard: "exclusive_turn_scope",
                outcome: "blocked_before_execution",
                blockedTool: toolName,
                allowedFamilies: [...exclusivePolicy.families],
              },
              severity: "warning",
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: toolResultForModel(toolName, blockedMessage),
            });
            continue;
          }
        }
        if (shouldDeferComputerTool(toolName, computerToolExecutedInBatch)) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: deferredComputerToolMessage(toolName, locale),
          });
          continue;
        }
        if (isComputerTool(toolName)) {
          computerToolExecutedInBatch = true;
          const decision = recordComputerDecision(
            agent.id,
            computerSurfaceForTool(toolName),
            toolName,
          );
          await db.insert(activityEventsTable).values({
            agentId: agent.id,
            taskId,
            type: "note",
            summary: redactAuditText(
              terminalMessage(locale, "computerSelected", {
                name: agent.name,
                tool: toolName,
              }),
              500,
            ),
            detail: computerStepDetail(decision, { selectedTool: toolName }),
            severity: "info",
          });
        }
        const [toolHeartbeat] = await db
          .update(agentsTable)
          .set({
            currentAction: toolDispatchText(locale, toolName),
            lastActiveAt: new Date(),
            runLeaseExpiresAt: new Date(Date.now() + CHAT_LEASE_MS),
          })
          .where(
            and(
              eq(agentsTable.id, agent.id),
              eq(agentsTable.isActive, true),
              eq(agentsTable.runLeaseOwner, leaseOwner),
              gt(agentsTable.runLeaseExpiresAt, new Date()),
            ),
          )
          .returning({ id: agentsTable.id });
        if (!toolHeartbeat)
          throw new AgentBusyError("Agent chat lease was lost");
        await assertExecutionAllowed();
        const result = await runTool(
          {
            agent,
            locale,
            taskId,
            computerLoopId,
            turnModelId: model,
            exclusiveTurnPolicy: exclusivePolicy ?? undefined,
            operationIdentity: {
              executionKind: "chat_turn",
              logicalExecutionId: `chat:${userMessage.id}`,
              runtimeInstanceId: runtimeHandle.id,
              originAttemptId: null,
              sourceMessageId: userMessage.id,
              modelToolCallId: toolCall.id,
              callSlot: `round:${round}:tool:${toolIndex}`,
              agentLeaseOwner: leaseOwner,
            },
          },
          toolName,
          toolCall.function.arguments,
        );
        createdTasks.push(...result.createdTasks);
        createdAgents.push(...result.createdAgents);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResultForModel(toolName, result.content),
        });
        if (
          result.toolOutcome === "unknown" ||
          result.toolOutcome === "outcome_unknown"
        ) {
          outcome = "tool_outcome_unknown";
          if (result.receiptId) {
            unknownOperation = {
              receiptId: result.receiptId,
              toolName,
              modelToolCallId: toolCall.id,
            };
          }
          finalText =
            copy.unknown +
            (result.receiptId
              ? `\n\n${toolMessage(locale, "receiptLabel", { id: result.receiptId })}`
              : "");
          turnTerminated = true;
          break;
        }
        if (result.toolOutcome === "deferred") {
          outcome = "tool_deferred";
          finalText =
            copy.deferred +
            (result.receiptId
              ? `\n\n${toolMessage(locale, "receiptLabel", { id: result.receiptId })}`
              : "");
          turnTerminated = true;
          break;
        }
        if (TERMINAL_CHAT_TOOLS.has(toolName)) {
          outcome = "approval_review";
          finalText = `${copy.approval}\n\n${result.content}`;
          turnTerminated = true;
          break;
        }
      }

      if (turnTerminated) break;

      if (round === maxToolRounds - 1) {
        outcome = "round_limit";
        // A tool returning a record does not prove that its effect succeeded.
        finalText = copy.roundLimit;
      }
    }

    if (exclusivePolicy && scopeBlockedTools.size > 0) {
      const guardNotice = `${copy.scope} ${[...scopeBlockedTools].join(", ")}`;
      finalText = finalText ? `${finalText}\n\n${guardNotice}` : guardNotice;
    }

    return await db.transaction(async (tx) => {
      await lockAndAssertRuntimeCanFinalizeInteractive(tx, runtimeHandle);
      await tx.execute(
        sql`SELECT id FROM ${agentsTable} WHERE id = ${agent.id} FOR UPDATE`,
      );
      const [owner] = await tx
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, agent.id));
      const ownsLease =
        owner?.runLeaseOwner === leaseOwner &&
        owner.runLeaseExpiresAt !== null &&
        owner.runLeaseExpiresAt.getTime() > Date.now();
      let canRecordUnknown = false;
      if (
        owner?.isActive &&
        !ownsLease &&
        outcome === "tool_outcome_unknown" &&
        unknownOperation
      ) {
        // Recording an already fenced outcome does not reacquire execution
        // authority. Require the exact turn, tool and original physical owner;
        // a replacement lease remains untouched, including in finally below.
        await tx.execute(
          sql`SELECT id FROM ${operationReceiptsTable} WHERE id = ${unknownOperation.receiptId} FOR UPDATE`,
        );
        const [evidence] = await tx
          .select({ id: operationInvocationsTable.id })
          .from(operationReceiptsTable)
          .innerJoin(
            operationInvocationsTable,
            eq(operationInvocationsTable.receiptId, operationReceiptsTable.id),
          )
          .where(
            and(
              eq(operationReceiptsTable.id, unknownOperation.receiptId),
              eq(operationReceiptsTable.state, "unknown"),
              eq(operationReceiptsTable.executionKind, "chat_turn"),
              eq(operationReceiptsTable.agentId, agent.id),
              taskId === null
                ? isNull(operationReceiptsTable.taskId)
                : eq(operationReceiptsTable.taskId, taskId),
              eq(
                operationReceiptsTable.logicalExecutionId,
                `chat:${userMessage.id}`,
              ),
              eq(operationReceiptsTable.sourceMessageId, userMessage.id),
              eq(operationReceiptsTable.toolName, unknownOperation.toolName),
              eq(operationInvocationsTable.executionKind, "chat_turn"),
              eq(operationInvocationsTable.state, "unknown"),
              isNotNull(operationInvocationsTable.effectStartedAt),
              eq(operationInvocationsTable.agentLeaseOwner, leaseOwner),
              eq(operationInvocationsTable.workerInstanceId, runtimeHandle.id),
              eq(
                operationInvocationsTable.modelToolCallId,
                unknownOperation.modelToolCallId,
              ),
            ),
          )
          .limit(1);
        canRecordUnknown = !!evidence;
      }
      if (!owner?.isActive || (!ownsLease && !canRecordUnknown)) {
        throw new AgentBusyError(
          "Agent chat lease was lost before finalization",
        );
      }
      const [agentMessage] = await tx
        .insert(messagesTable)
        .values({
          agentId: agent.id,
          role: outcome === "reply" ? "agent" : "system",
          content: finalText || copy.empty,
          taskId,
          modelId: usedModel,
        })
        .returning();
      const result = {
        userMessage,
        agentMessage,
        createdTasks,
        createdAgents,
        usedModel,
        usedProvider,
        outcome,
      };
      await dependencies?.onCompleted?.(tx, result);
      return result;
    });
  } finally {
    await db
      .update(agentsTable)
      .set({
        status: "idle",
        currentTaskId: null,
        currentAction: null,
        lastActiveAt: new Date(),
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(
        and(
          eq(agentsTable.id, agent.id),
          eq(agentsTable.runLeaseOwner, leaseOwner),
        ),
      );
  }
}
