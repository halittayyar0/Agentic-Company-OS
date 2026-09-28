import type { RuntimeInstanceHandle } from "./orchestrator/runtime-instance-registry";
import {
  beforeOperatorEffect,
  OperatorRequestError,
} from "./operator-requests";
import { db, runtimeBrowserSessionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  decryptRuntimeEnvelope,
  encryptRuntimeEnvelope,
  readRuntimeControlKey,
} from "./runtime-control-crypto";
import type {
  RuntimeBrowserCommand,
  RuntimeControlAck,
  RuntimeControlDelivery,
} from "./runtime-control-protocol";
import {
  assertExistingBrowserSessionIdentity,
  captureView,
  closeSession,
  configureBrowserSessionAffinityPublisher,
  getBrowserControlState,
  getExistingBrowserSessionIdentity,
  heartbeatBrowserControl,
  listExistingBrowserSessions,
  navigateTo,
  releaseBrowserControl,
  sendRawInput,
  takeOverBrowserControl,
  runAtMostOnceBrowserEffect,
} from "./vm/browser";

const EXPECTED_CONTROL_PATH = "/api/internal/runtime-control";

export interface RuntimeControlWorkerController {
  stop(): Promise<void>;
}

export function configureRuntimeControlWorkerAffinity(
  runtime: Pick<RuntimeInstanceHandle, "id" | "startedAt">,
): void {
  configureBrowserSessionAffinityPublisher(async ({ agentId, session }) => {
    if (!session) {
      await db
        .delete(runtimeBrowserSessionsTable)
        .where(
          and(
            eq(runtimeBrowserSessionsTable.agentId, agentId),
            eq(runtimeBrowserSessionsTable.runtimeInstanceId, runtime.id),
          ),
        );
      return;
    }
    await db.transaction(async (transaction) => {
      const [owner] = await transaction
        .select()
        .from(runtimeBrowserSessionsTable)
        .where(eq(runtimeBrowserSessionsTable.agentId, agentId))
        .for("update")
        .limit(1);
      if (
        owner &&
        owner.runtimeInstanceId !== runtime.id &&
        Date.now() - owner.observedAt.getTime() <= 30_000
      ) {
        throw new Error("Agent browser session already has a live owner.");
      }
      await transaction
        .insert(runtimeBrowserSessionsTable)
        .values({
          agentId,
          runtimeInstanceId: runtime.id,
          runtimeStartedAt: runtime.startedAt,
          browserSessionId: session.sessionId,
          browserSessionEpoch: session.sessionEpoch,
          observedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: runtimeBrowserSessionsTable.agentId,
          set: {
            runtimeInstanceId: runtime.id,
            runtimeStartedAt: runtime.startedAt,
            browserSessionId: session.sessionId,
            browserSessionEpoch: session.sessionEpoch,
            observedAt: new Date(),
          },
        });
    });
  });
}

function readControlUrl(environment: NodeJS.ProcessEnv): URL {
  const raw = environment.RUNTIME_CONTROL_API_URL?.trim();
  if (!raw) throw new Error("RUNTIME_CONTROL_API_URL is required for workers.");
  const url = new URL(raw);
  const privateHttpHost =
    url.hostname === "app" ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(url.hostname);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && privateHttpHost)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/$/u, "") !== EXPECTED_CONTROL_PATH
  ) {
    throw new Error(
      "RUNTIME_CONTROL_API_URL must be the exact internal runtime-control URL over HTTPS or private HTTP.",
    );
  }
  url.pathname = EXPECTED_CONTROL_PATH;
  return url;
}

function isSessionIdentity(value: unknown): value is {
  sessionId: string;
  sessionEpoch: number;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === "string" &&
    record.sessionId.length > 0 &&
    record.sessionId.length <= 256 &&
    Number.isSafeInteger(record.sessionEpoch) &&
    Number(record.sessionEpoch) > 0
  );
}

function parseCommand(value: unknown): RuntimeBrowserCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid runtime browser command.");
  }
  const command = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(command.agentId) ||
    Number(command.agentId) <= 0 ||
    (command.expectedSession !== null &&
      !isSessionIdentity(command.expectedSession)) ||
    typeof command.kind !== "string" ||
    ![
      "browser_control_state",
      "browser_take_over",
      "browser_heartbeat",
      "browser_release",
      "browser_view",
      "browser_navigate",
      "browser_input",
      "browser_close",
    ].includes(command.kind)
  ) {
    throw new Error("Invalid runtime browser command.");
  }
  return command as unknown as RuntimeBrowserCommand;
}

async function assertExpected(command: RuntimeBrowserCommand): Promise<void> {
  if (!command.expectedSession) {
    throw new Error("The command is not bound to an existing browser session.");
  }
  await assertExistingBrowserSessionIdentity(
    command.agentId,
    command.expectedSession,
  );
}

async function executeCommand(
  command: RuntimeBrowserCommand,
): Promise<unknown> {
  const beforeEffect = async () => {
    const owner = command.operatorOwner;
    const id =
      /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    if (
      !owner ||
      owner.agentId !== command.agentId ||
      owner.kind !== command.kind ||
      typeof owner.requestId !== "string" ||
      !id.test(owner.requestId) ||
      typeof owner.ownerId !== "string" ||
      !id.test(owner.ownerId)
    )
      throw new OperatorRequestError("ownership_lost");
    await beforeOperatorEffect(owner);
  };
  switch (command.kind) {
    case "browser_control_state":
      await assertExpected(command);
      return getBrowserControlState(command.agentId);
    case "browser_take_over":
      return takeOverBrowserControl(
        command.agentId,
        command.expectedSession ?? undefined,
        beforeEffect,
      );
    case "browser_heartbeat":
      await assertExpected(command);
      return heartbeatBrowserControl(command.agentId, command.leaseId);
    case "browser_release":
      await assertExpected(command);
      return releaseBrowserControl(
        command.agentId,
        command.leaseId,
        beforeEffect,
      );
    case "browser_view":
      await assertExpected(command);
      return captureView(command.agentId, command.expectedSession!);
    case "browser_navigate":
      await assertExpected(command);
      await navigateTo(
        command.agentId,
        command.url,
        "operator",
        command.leaseId,
        beforeEffect,
        command.expectedSession!,
      );
      // Navigation has already crossed its effect boundary. A later image
      // failure cannot turn it into a safely failed, replayable command.
      return runAtMostOnceBrowserEffect(() =>
        captureView(command.agentId, command.expectedSession!),
      );
    case "browser_input":
      await assertExpected(command);
      await sendRawInput(
        command.agentId,
        command.input,
        command.leaseId,
        command.expectedSession!,
        beforeEffect,
      );
      return { path: command.input.action, deleted: true };
    case "browser_close":
      await assertExpected(command);
      return {
        path: "browser-session",
        deleted: await closeSession(
          command.agentId,
          command.leaseId ?? undefined,
          command.expectedSession!,
          beforeEffect,
        ),
      };
  }
}

async function executeDelivery(
  delivery: RuntimeControlDelivery,
  secret: string,
): Promise<RuntimeControlAck> {
  let command: RuntimeBrowserCommand | null = null;
  try {
    command = parseCommand(decryptRuntimeEnvelope(delivery.envelope, secret));
    const result = await executeCommand(command);
    const identity = await getExistingBrowserSessionIdentity(command.agentId);
    return {
      id: delivery.id,
      ok: true,
      resultEnvelope: encryptRuntimeEnvelope(result, secret),
      session: identity ? { agentId: command.agentId, ...identity } : null,
    };
  } catch (error) {
    const identity = command
      ? await getExistingBrowserSessionIdentity(command.agentId).catch(
          () => null,
        )
      : null;
    return {
      id: delivery.id,
      ok: false,
      failureKind:
        error instanceof Error
          ? error.name.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 128)
          : "worker_error",
      // Do not reflect Playwright/provider messages: they can contain URLs,
      // page text or typed secrets. Detailed diagnostics stay process-local.
      sanitizedError: "Worker browser command failed.",
      session:
        command && identity ? { agentId: command.agentId, ...identity } : null,
    };
  }
}

async function postJson(
  url: URL,
  path: "/poll" | "/ack",
  secret: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const endpoint = new URL(url);
  endpoint.pathname = `${EXPECTED_CONTROL_PATH}${path}`;
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-runtime-control-key": secret,
    },
    body: JSON.stringify(body),
    signal,
  });
}

export function startRuntimeControlWorker(
  runtime: Pick<RuntimeInstanceHandle, "id" | "startedAt">,
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeControlWorkerController {
  const secret = readRuntimeControlKey(environment);
  const controlUrl = readControlUrl(environment);
  let stopping = false;
  let pollAbort: AbortController | null = null;
  let loopPromise: Promise<void>;

  const loop = async (): Promise<void> => {
    while (!stopping) {
      try {
        pollAbort = new AbortController();
        const timeout = setTimeout(() => pollAbort?.abort(), 25_000);
        timeout.unref?.();
        const response = await postJson(
          controlUrl,
          "/poll",
          secret,
          {
            runtimeId: runtime.id,
            startedAt: runtime.startedAt.toISOString(),
            sessions: await listExistingBrowserSessions(),
          },
          pollAbort.signal,
        ).finally(() => clearTimeout(timeout));
        pollAbort = null;
        if (stopping) break;
        if (response.status === 204) continue;
        if (!response.ok) {
          await response.body?.cancel();
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        const delivery = (await response.json()) as RuntimeControlDelivery;
        if (
          !delivery ||
          typeof delivery.id !== "string" ||
          !delivery.envelope ||
          typeof delivery.envelope.ciphertext !== "string"
        ) {
          continue;
        }
        const ack = await executeDelivery(delivery, secret);
        // A lost acknowledgement is an unknown outcome. Never retry it: the
        // API command timeout records that state and requires operator review.
        await postJson(controlUrl, "/ack", secret, {
          runtimeId: runtime.id,
          ...ack,
        })
          .then((response) => response.body?.cancel())
          .catch(() => undefined);
      } catch {
        pollAbort = null;
        if (!stopping) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
  };
  loopPromise = loop();

  return Object.freeze({
    async stop(): Promise<void> {
      if (stopping) return loopPromise;
      stopping = true;
      pollAbort?.abort();
      await loopPromise;
    },
  });
}
