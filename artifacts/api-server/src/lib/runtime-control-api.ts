import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  dbReady,
  approvalRequestsTable,
  runtimeBrowserSessionsTable,
  runtimeControlCommandsTable,
  runtimeInstancesTable,
  type RuntimeControlCommandKind,
} from "@workspace/db";
import type {
  RuntimeBrowserCommand,
  RuntimeBrowserCommandInput,
  RuntimeBrowserSessionAdvertisement,
  RuntimeControlAck,
  RuntimeControlDelivery,
} from "./runtime-control-protocol";
import {
  decryptRuntimeEnvelope,
  digestRuntimePayload,
  encryptRuntimeEnvelope,
  readRuntimeControlKey,
} from "./runtime-control-crypto";

const DEFAULT_POLL_WAIT_MS = 20_000;
const DEFAULT_WORKER_FRESH_MS = 30_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 35_000;
let pollWaitMs = DEFAULT_POLL_WAIT_MS;
let workerFreshMs = DEFAULT_WORKER_FRESH_MS;
let commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS;

interface WorkerChannel {
  runtimeId: string;
  startedAt: Date;
  lastSeenAt: number;
  queue: RuntimeControlDelivery[];
  waiter: ((delivery: RuntimeControlDelivery | null) => void) | null;
}

interface PendingCommand {
  targetRuntimeId: string;
  resolve(value: unknown): void;
  reject(error: RuntimeControlUnavailableError): void;
  timer: ReturnType<typeof setTimeout>;
}

export class RuntimeControlUnavailableError extends Error {
  constructor(
    message: string,
    readonly code:
      | "BROWSER_RUNTIME_UNROUTABLE"
      | "BROWSER_RUNTIME_TIMEOUT"
      | "BROWSER_RUNTIME_OUTCOME_UNKNOWN",
    readonly status = 503,
  ) {
    super(message);
    this.name = "RuntimeControlUnavailableError";
  }
}

const workers = new Map<string, WorkerChannel>();
const pendingCommands = new Map<string, PendingCommand>();
let initialized = false;

function channelKey(runtimeId: string, startedAt: Date): string {
  return `${runtimeId}:${startedAt.toISOString()}`;
}

function liveChannel(runtimeId: string, startedAt: Date): WorkerChannel | null {
  const channel = workers.get(channelKey(runtimeId, startedAt));
  return channel && Date.now() - channel.lastSeenAt <= workerFreshMs
    ? channel
    : null;
}

async function markDeliveryDispatched(
  delivery: RuntimeControlDelivery,
): Promise<boolean> {
  const dispatched = await db
    .update(runtimeControlCommandsTable)
    .set({ state: "dispatched", dispatchedAt: new Date() })
    .where(
      and(
        eq(runtimeControlCommandsTable.id, delivery.id),
        eq(runtimeControlCommandsTable.state, "queued"),
        gt(runtimeControlCommandsTable.expiresAt, new Date()),
      ),
    )
    .returning({ id: runtimeControlCommandsTable.id });
  return dispatched.length === 1 && pendingCommands.has(delivery.id);
}

function removeQueuedDelivery(channel: WorkerChannel, id: string): void {
  const index = channel.queue.findIndex((delivery) => delivery.id === id);
  if (index >= 0) channel.queue.splice(index, 1);
}

async function settleCommandTimeout(
  channel: WorkerChannel,
  id: string,
): Promise<"timeout" | "outcome_unknown"> {
  removeQueuedDelivery(channel, id);
  const [settled] = await db
    .update(runtimeControlCommandsTable)
    .set({
      state: sql`case
        when ${runtimeControlCommandsTable.state} = 'queued' then 'expired'
        else 'unknown'
      end`,
      finishedAt: new Date(),
      failureKind: sql`case
        when ${runtimeControlCommandsTable.state} = 'queued' then 'dispatch_timeout'
        else 'ack_timeout'
      end`,
    })
    .where(
      and(
        eq(runtimeControlCommandsTable.id, id),
        inArray(runtimeControlCommandsTable.state, ["queued", "dispatched"]),
      ),
    )
    .returning({ state: runtimeControlCommandsTable.state });
  if (settled) {
    return settled.state === "expired" ? "timeout" : "outcome_unknown";
  }

  const [terminal] = await db
    .select({ state: runtimeControlCommandsTable.state })
    .from(runtimeControlCommandsTable)
    .where(eq(runtimeControlCommandsTable.id, id))
    .limit(1);
  return terminal?.state === "expired" ? "timeout" : "outcome_unknown";
}

function deliver(
  channel: WorkerChannel,
  delivery: RuntimeControlDelivery,
): void {
  if (channel.waiter) {
    const waiter = channel.waiter;
    channel.waiter = null;
    void markDeliveryDispatched(delivery).then(
      (dispatched) => waiter(dispatched ? delivery : null),
      () => waiter(null),
    );
    return;
  }
  channel.queue.push(delivery);
}

async function synchronizeBrowserSessions(
  runtimeId: string,
  startedAt: Date,
  sessions: RuntimeBrowserSessionAdvertisement[],
): Promise<void> {
  const advertisedAgentIds = sessions.map((session) => session.agentId);
  await db.transaction(async (transaction) => {
    const owned = await transaction
      .select({ agentId: runtimeBrowserSessionsTable.agentId })
      .from(runtimeBrowserSessionsTable)
      .where(eq(runtimeBrowserSessionsTable.runtimeInstanceId, runtimeId));
    const staleIds = owned
      .map((row) => row.agentId)
      .filter((agentId) => !advertisedAgentIds.includes(agentId));
    if (staleIds.length > 0) {
      await transaction
        .delete(runtimeBrowserSessionsTable)
        .where(inArray(runtimeBrowserSessionsTable.agentId, staleIds));
    }
    for (const session of sessions) {
      await transaction
        .insert(runtimeBrowserSessionsTable)
        .values({
          agentId: session.agentId,
          runtimeInstanceId: runtimeId,
          runtimeStartedAt: startedAt,
          browserSessionId: session.sessionId,
          browserSessionEpoch: session.sessionEpoch,
          observedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: runtimeBrowserSessionsTable.agentId,
          setWhere: eq(
            runtimeBrowserSessionsTable.runtimeInstanceId,
            runtimeId,
          ),
          set: {
            runtimeInstanceId: runtimeId,
            runtimeStartedAt: startedAt,
            browserSessionId: session.sessionId,
            browserSessionEpoch: session.sessionEpoch,
            observedAt: new Date(),
          },
        });
    }
  });
}

async function upsertBrowserSession(
  runtimeId: string,
  startedAt: Date,
  session: RuntimeBrowserSessionAdvertisement,
): Promise<void> {
  await db
    .insert(runtimeBrowserSessionsTable)
    .values({
      agentId: session.agentId,
      runtimeInstanceId: runtimeId,
      runtimeStartedAt: startedAt,
      browserSessionId: session.sessionId,
      browserSessionEpoch: session.sessionEpoch,
      observedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: runtimeBrowserSessionsTable.agentId,
      setWhere: eq(runtimeBrowserSessionsTable.runtimeInstanceId, runtimeId),
      set: {
        runtimeInstanceId: runtimeId,
        runtimeStartedAt: startedAt,
        browserSessionId: session.sessionId,
        browserSessionEpoch: session.sessionEpoch,
        observedAt: new Date(),
      },
    });
}

export async function initializeRuntimeControlApi(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (initialized || environment.RUNTIME_ROLE !== "api") return;
  await dbReady;
  const now = new Date();
  await db
    .update(runtimeControlCommandsTable)
    .set({ state: "expired", finishedAt: now, failureKind: "api_restarted" })
    .where(eq(runtimeControlCommandsTable.state, "queued"));
  await db
    .update(runtimeControlCommandsTable)
    .set({
      state: "unknown",
      finishedAt: now,
      failureKind: "api_restarted_after_dispatch",
    })
    .where(eq(runtimeControlCommandsTable.state, "dispatched"));
  initialized = true;
}

export async function pollRuntimeControl(input: {
  runtimeId: string;
  startedAt: Date;
  sessions: RuntimeBrowserSessionAdvertisement[];
}): Promise<RuntimeControlDelivery | null> {
  await initializeRuntimeControlApi();
  const [runtime] = await db
    .select({
      id: runtimeInstancesTable.id,
      startedAt: runtimeInstancesTable.startedAt,
      role: runtimeInstancesTable.role,
      state: runtimeInstancesTable.state,
    })
    .from(runtimeInstancesTable)
    .where(
      and(
        eq(runtimeInstancesTable.id, input.runtimeId),
        eq(runtimeInstancesTable.startedAt, input.startedAt),
      ),
    )
    .limit(1);
  if (
    !runtime ||
    runtime.role !== "worker" ||
    (runtime.state !== "starting" && runtime.state !== "healthy")
  ) {
    throw new RuntimeControlUnavailableError(
      "Worker runtime is not eligible for control commands.",
      "BROWSER_RUNTIME_UNROUTABLE",
      409,
    );
  }

  await synchronizeBrowserSessions(
    input.runtimeId,
    input.startedAt,
    input.sessions,
  );
  const key = channelKey(input.runtimeId, input.startedAt);
  let channel = workers.get(key);
  if (!channel) {
    channel = {
      runtimeId: input.runtimeId,
      startedAt: input.startedAt,
      lastSeenAt: Date.now(),
      queue: [],
      waiter: null,
    };
    workers.set(key, channel);
  }
  channel.lastSeenAt = Date.now();
  if (channel.waiter) {
    channel.waiter(null);
    channel.waiter = null;
  }
  while (channel.queue.length > 0) {
    const queued = channel.queue.shift()!;
    if (await markDeliveryDispatched(queued)) return queued;
  }
  return new Promise<RuntimeControlDelivery | null>((resolve) => {
    const timer = setTimeout(() => {
      if (channel?.waiter === complete) channel.waiter = null;
      resolve(null);
    }, pollWaitMs);
    timer.unref?.();
    const complete = (delivery: RuntimeControlDelivery | null): void => {
      clearTimeout(timer);
      resolve(delivery);
    };
    channel!.waiter = complete;
  });
}

type BrowserOwnerResolution =
  | {
      kind: "owned";
      channel: WorkerChannel;
      expectedSession: { sessionId: string; sessionEpoch: number };
    }
  | { kind: "unavailable" }
  | { kind: "none" };

async function ownerForAgent(agentId: number): Promise<BrowserOwnerResolution> {
  const [owner] = await db
    .select()
    .from(runtimeBrowserSessionsTable)
    .where(eq(runtimeBrowserSessionsTable.agentId, agentId))
    .limit(1);
  if (owner) {
    const ownerChannel = liveChannel(
      owner.runtimeInstanceId,
      owner.runtimeStartedAt,
    );
    return ownerChannel
      ? {
          kind: "owned",
          channel: ownerChannel,
          expectedSession: {
            sessionId: owner.browserSessionId,
            sessionEpoch: owner.browserSessionEpoch,
          },
        }
      : { kind: "unavailable" };
  }

  {
    const [approvalOwner] = await db
      .select({
        runtimeInstanceId: approvalRequestsTable.browserRuntimeInstanceId,
        browserSessionId: approvalRequestsTable.browserSessionId,
        browserSessionEpoch: approvalRequestsTable.browserSessionEpoch,
        runtimeStartedAt: runtimeInstancesTable.startedAt,
      })
      .from(approvalRequestsTable)
      .innerJoin(
        runtimeInstancesTable,
        eq(
          runtimeInstancesTable.id,
          approvalRequestsTable.browserRuntimeInstanceId,
        ),
      )
      .where(
        and(
          eq(approvalRequestsTable.agentId, agentId),
          isNull(approvalRequestsTable.bindingInvalidatedAt),
        ),
      )
      .orderBy(
        desc(approvalRequestsTable.createdAt),
        desc(approvalRequestsTable.id),
      )
      .limit(1);
    if (
      !approvalOwner?.runtimeInstanceId ||
      !approvalOwner.browserSessionId ||
      !approvalOwner.browserSessionEpoch
    ) {
      return { kind: "none" };
    }
    const approvalChannel = liveChannel(
      approvalOwner.runtimeInstanceId,
      approvalOwner.runtimeStartedAt,
    );
    if (!approvalChannel) return { kind: "unavailable" };
    return {
      kind: "owned",
      channel: approvalChannel,
      expectedSession: {
        sessionId: approvalOwner.browserSessionId,
        sessionEpoch: approvalOwner.browserSessionEpoch,
      },
    };
  }
}

function chooseLiveWorker(): WorkerChannel | null {
  return (
    [...workers.values()]
      .filter((worker) => Date.now() - worker.lastSeenAt <= workerFreshMs)
      .sort((left, right) => left.queue.length - right.queue.length)[0] ?? null
  );
}

export async function dispatchBrowserRuntimeCommand<T>(
  command: RuntimeBrowserCommandInput,
  options: { allowSessionAllocation?: boolean } = {},
): Promise<T> {
  await initializeRuntimeControlApi();
  const owner = await ownerForAgent(command.agentId);
  if (owner.kind === "unavailable") {
    throw new RuntimeControlUnavailableError(
      "Tarayici oturumunun sahibi olan worker su anda ulasilabilir degil.",
      "BROWSER_RUNTIME_UNROUTABLE",
    );
  }
  const channel =
    (owner.kind === "owned" ? owner.channel : null) ??
    (options.allowSessionAllocation ? chooseLiveWorker() : null);
  if (!channel) {
    throw new RuntimeControlUnavailableError(
      "Tarayici oturumunun sahibi olan worker su anda ulasilabilir degil.",
      "BROWSER_RUNTIME_UNROUTABLE",
    );
  }
  const payload = {
    ...command,
    expectedSession: owner.kind === "owned" ? owner.expectedSession : null,
  } as RuntimeBrowserCommand;
  const secret = readRuntimeControlKey();
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + commandTimeoutMs);
  await db.insert(runtimeControlCommandsTable).values({
    id,
    targetRuntimeInstanceId: channel.runtimeId,
    targetRuntimeStartedAt: channel.startedAt,
    agentId: command.agentId,
    kind: command.kind as RuntimeControlCommandKind,
    state: "queued",
    payloadDigest: digestRuntimePayload(payload, secret),
    expiresAt,
  });
  const delivery: RuntimeControlDelivery = {
    id,
    envelope: encryptRuntimeEnvelope(payload, secret),
  };

  const result = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const pending = pendingCommands.get(id);
      if (!pending) return;
      pendingCommands.delete(id);
      void settleCommandTimeout(channel, id).then(
        (disposition) => {
          reject(
            new RuntimeControlUnavailableError(
              disposition === "outcome_unknown"
                ? "Worker komutu aldi ancak sonucunu dogrulamadi; otomatik tekrar yapilmayacak."
                : "Worker komutu zamaninda teslim alamadi.",
              disposition === "outcome_unknown"
                ? "BROWSER_RUNTIME_OUTCOME_UNKNOWN"
                : "BROWSER_RUNTIME_TIMEOUT",
            ),
          );
        },
        () => {
          reject(
            new RuntimeControlUnavailableError(
              "Komut zaman asimina ugradi ancak kalici teslim durumu dogrulanamadi; otomatik tekrar yapilmayacak.",
              "BROWSER_RUNTIME_OUTCOME_UNKNOWN",
            ),
          );
        },
      );
    }, commandTimeoutMs);
    timer.unref?.();
    pendingCommands.set(id, {
      targetRuntimeId: channel.runtimeId,
      resolve: (value) => resolve(value as T),
      reject,
      timer,
    });
  });
  deliver(channel, delivery);
  return result;
}

export async function acknowledgeRuntimeControl(
  runtimeId: string,
  ack: RuntimeControlAck,
): Promise<void> {
  const pending = pendingCommands.get(ack.id);
  if (!pending || pending.targetRuntimeId !== runtimeId) return;
  clearTimeout(pending.timer);
  pendingCommands.delete(ack.id);
  let result: unknown = null;
  try {
    result =
      ack.ok && ack.resultEnvelope
        ? decryptRuntimeEnvelope(ack.resultEnvelope)
        : null;
  } catch {
    ack = {
      ...ack,
      ok: false,
      failureKind: "invalid_result_envelope",
      sanitizedError: "Worker result envelope could not be authenticated.",
    };
  }
  const failureText = ack.sanitizedError
    ?.replace(/[\r\n\t]+/g, " ")
    .slice(0, 1024);
  // A worker can acknowledge an uncertain effect; receiving an acknowledgement
  // alone does not prove that a dispatched input/navigation failed safely.
  const outcomeUnknown =
    !ack.ok &&
    ["BrowserActionOutcomeUnknownError", "invalid_result_envelope"].includes(
      ack.failureKind ?? "",
    );
  await db
    .update(runtimeControlCommandsTable)
    .set({
      state: ack.ok ? "succeeded" : outcomeUnknown ? "unknown" : "failed",
      finishedAt: new Date(),
      resultDigest: ack.ok ? digestRuntimePayload(result) : null,
      failureKind: ack.ok
        ? null
        : ack.failureKind?.slice(0, 128) || "worker_error",
      sanitizedError: ack.ok ? null : failureText || "Worker command failed.",
    })
    .where(
      and(
        eq(runtimeControlCommandsTable.id, ack.id),
        eq(runtimeControlCommandsTable.state, "dispatched"),
      ),
    );
  const [command] = await db
    .select({
      startedAt: runtimeControlCommandsTable.targetRuntimeStartedAt,
      agentId: runtimeControlCommandsTable.agentId,
      kind: runtimeControlCommandsTable.kind,
    })
    .from(runtimeControlCommandsTable)
    .where(eq(runtimeControlCommandsTable.id, ack.id))
    .limit(1);
  if (command) {
    if (ack.session) {
      await upsertBrowserSession(runtimeId, command.startedAt, ack.session);
    } else if (ack.ok && command.kind === "browser_close") {
      await db
        .delete(runtimeBrowserSessionsTable)
        .where(
          and(
            eq(runtimeBrowserSessionsTable.agentId, command.agentId),
            eq(runtimeBrowserSessionsTable.runtimeInstanceId, runtimeId),
          ),
        );
    }
  }
  if (ack.ok) pending.resolve(result);
  else {
    pending.reject(
      new RuntimeControlUnavailableError(
        failureText || "Worker tarayici komutunu tamamlayamadi.",
        outcomeUnknown
          ? "BROWSER_RUNTIME_OUTCOME_UNKNOWN"
          : "BROWSER_RUNTIME_UNROUTABLE",
        outcomeUnknown ? 503 : 409,
      ),
    );
  }
}

export async function noBrowserSessionResponse(
  agentId: number,
): Promise<boolean> {
  return (await ownerForAgent(agentId)).kind === "none";
}

export function resetRuntimeControlApiForTest(): void {
  for (const pending of pendingCommands.values()) clearTimeout(pending.timer);
  pendingCommands.clear();
  for (const worker of workers.values()) worker.waiter?.(null);
  workers.clear();
  initialized = false;
  pollWaitMs = DEFAULT_POLL_WAIT_MS;
  workerFreshMs = DEFAULT_WORKER_FRESH_MS;
  commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS;
}

export function configureRuntimeControlTimingForTest(input: {
  pollWaitMs?: number;
  workerFreshMs?: number;
  commandTimeoutMs?: number;
}): void {
  if (input.pollWaitMs !== undefined) pollWaitMs = input.pollWaitMs;
  if (input.workerFreshMs !== undefined) workerFreshMs = input.workerFreshMs;
  if (input.commandTimeoutMs !== undefined) {
    commandTimeoutMs = input.commandTimeoutMs;
  }
}
