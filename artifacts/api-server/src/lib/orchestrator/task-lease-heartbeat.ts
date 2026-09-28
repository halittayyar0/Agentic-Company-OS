import { and, eq, inArray, sql } from "drizzle-orm";
import {
  agentsTable,
  db,
  operationInvocationsTable,
  operationReceiptsTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import { logger } from "../logger";
import type { RuntimeOperationsConfig } from "../runtime-operations-config";
import {
  EmergencyStopError,
  lockAndAssertExecutionAllowed,
} from "./runtime-emergency-stop";
import { loseTaskAttemptAfterOwnershipLoss } from "./task-attempt-store";

export interface TaskLeaseTimer {
  unref?(): unknown;
}

export interface TaskLeaseHeartbeatRuntime {
  now(): Date;
  setTimeout(
    callback: () => void | Promise<void>,
    delayMs: number,
  ): TaskLeaseTimer;
  clearTimeout(timer: TaskLeaseTimer): void;
}

export interface TaskLeaseHeartbeat {
  assertOwned(action?: string): Promise<void>;
  attachOperationInvocation(input: AttachedOperationInvocation): void;
  detachOperationInvocation(invocationId: string): void;
  stop(): Promise<void>;
}

export interface AttachedOperationInvocation {
  receiptId: string;
  invocationId: string;
  leaseOwner: string;
  workerInstanceId: string;
}

export interface StartTaskLeaseHeartbeatInput {
  taskId: number;
  agentId: number;
  attemptId: string;
  leaseOwner: string;
  config: RuntimeOperationsConfig;
  runtime?: TaskLeaseHeartbeatRuntime;
  afterAgentLockBeforeTaskLock?: () => Promise<void>;
}

export class TaskLeaseOwnershipLostError extends Error {
  readonly code = "TASK_LEASE_OWNERSHIP_LOST";

  constructor(message = "Task, agent, or attempt ownership was lost") {
    super(message);
    this.name = "TaskLeaseOwnershipLostError";
  }
}

class TaskLeaseOwnershipMismatchError extends Error {}

interface HeartbeatState {
  input: StartTaskLeaseHeartbeatInput;
  runtime: TaskLeaseHeartbeatRuntime;
  stopped: boolean;
  permanentlyLost: boolean;
  consecutiveFailures: number;
  currentAction: string;
  timer: TaskLeaseTimer | null;
  tail: Promise<void>;
  inFlightCallbacks: Set<Promise<void>>;
  stopPromise: Promise<void> | null;
  activeOperations: Map<string, AttachedOperationInvocation>;
}

const systemRuntime: TaskLeaseHeartbeatRuntime = {
  now: () => new Date(),
  setTimeout(callback, delayMs) {
    return setTimeout(() => void callback(), delayMs);
  },
  clearTimeout(timer) {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

function timestampFrom(runtime: TaskLeaseHeartbeatRuntime): Date {
  const now = runtime.now();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Task lease heartbeat clock returned an invalid timestamp");
  }
  return now;
}

async function renewOwnership(state: HeartbeatState): Promise<void> {
  const now = timestampFrom(state.runtime);
  const leaseExpiresAt = new Date(
    now.getTime() + state.input.config.taskLeaseMs,
  );
  await db.transaction(async (tx) => {
    await lockAndAssertExecutionAllowed(tx);
    const attachedOperations = [...state.activeOperations.values()].sort(
      (left, right) =>
        left.receiptId.localeCompare(right.receiptId, "en") ||
        left.invocationId.localeCompare(right.invocationId, "en"),
    );
    for (const runtimeInstanceId of [
      ...new Set(
        attachedOperations.map((operation) => operation.workerInstanceId),
      ),
    ].sort((left, right) => left.localeCompare(right, "en"))) {
      await tx.execute(
        sql`SELECT id FROM ${runtimeInstancesTable} WHERE ${runtimeInstancesTable.id} = ${runtimeInstanceId} FOR UPDATE`,
      );
    }
    const [agent] = await tx
      .update(agentsTable)
      .set({
        status: "working",
        currentTaskId: state.input.taskId,
        currentAction: state.currentAction,
        lastActiveAt: now,
        runLeaseExpiresAt: leaseExpiresAt,
      })
      .where(
        and(
          eq(agentsTable.id, state.input.agentId),
          eq(agentsTable.isActive, true),
          eq(agentsTable.runLeaseOwner, state.input.leaseOwner),
        ),
      )
      .returning({ id: agentsTable.id });
    if (!agent) throw new TaskLeaseOwnershipMismatchError();
    await state.input.afterAgentLockBeforeTaskLock?.();

    const [task] = await tx
      .update(tasksTable)
      .set({ leaseExpiresAt, lastHeartbeatAt: now })
      .where(
        and(
          eq(tasksTable.id, state.input.taskId),
          eq(tasksTable.ownerAgentId, state.input.agentId),
          eq(tasksTable.leaseOwner, state.input.leaseOwner),
        ),
      )
      .returning({ id: tasksTable.id });
    if (!task) throw new TaskLeaseOwnershipMismatchError();

    const [attempt] = await tx
      .update(taskAttemptsTable)
      .set({ lastHeartbeatAt: now })
      .where(
        and(
          eq(taskAttemptsTable.id, state.input.attemptId),
          eq(taskAttemptsTable.taskId, state.input.taskId),
          eq(taskAttemptsTable.agentId, state.input.agentId),
          eq(taskAttemptsTable.leaseOwner, state.input.leaseOwner),
          inArray(taskAttemptsTable.state, ["claimed", "running"]),
        ),
      )
      .returning({
        id: taskAttemptsTable.id,
        logicalExecutionId: taskAttemptsTable.logicalExecutionId,
        workerInstanceId: taskAttemptsTable.workerInstanceId,
      });
    if (!attempt) throw new TaskLeaseOwnershipMismatchError();

    for (const operation of attachedOperations) {
      await tx.execute(
        sql`SELECT id FROM ${operationReceiptsTable} WHERE ${operationReceiptsTable.id} = ${operation.receiptId} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM ${operationInvocationsTable} WHERE ${operationInvocationsTable.id} = ${operation.invocationId} FOR UPDATE`,
      );
      const [receipt] = await tx
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.id, operation.receiptId));
      const [invocation] = await tx
        .select()
        .from(operationInvocationsTable)
        .where(eq(operationInvocationsTable.id, operation.invocationId));
      if (
        receipt &&
        invocation &&
        ["succeeded", "failed", "unknown"].includes(receipt.state) &&
        ["succeeded", "failed", "unknown"].includes(invocation.state)
      ) {
        state.activeOperations.delete(operation.invocationId);
        continue;
      }
      const activePair =
        (receipt?.state === "reserved" && invocation?.state === "claimed") ||
        (receipt?.state === "running" && invocation?.state === "running");
      if (
        !activePair ||
        receipt?.executionKind !== "task_step" ||
        receipt.taskId !== state.input.taskId ||
        receipt.agentId !== state.input.agentId ||
        receipt.logicalExecutionId !== attempt.logicalExecutionId ||
        invocation?.receiptId !== receipt.id ||
        invocation.attemptId !== state.input.attemptId ||
        invocation.workerInstanceId !== operation.workerInstanceId ||
        invocation.workerInstanceId !== attempt.workerInstanceId ||
        invocation.leaseOwner !== operation.leaseOwner ||
        invocation.taskLeaseOwner !== state.input.leaseOwner ||
        invocation.agentLeaseOwner !== state.input.leaseOwner
      ) {
        throw new TaskLeaseOwnershipMismatchError();
      }
      const [renewedInvocation] = await tx
        .update(operationInvocationsTable)
        .set({ leaseExpiresAt, lastHeartbeatAt: now })
        .where(
          and(
            eq(operationInvocationsTable.id, operation.invocationId),
            eq(operationInvocationsTable.receiptId, operation.receiptId),
            eq(operationInvocationsTable.leaseOwner, operation.leaseOwner),
            inArray(operationInvocationsTable.state, ["claimed", "running"]),
          ),
        )
        .returning({ id: operationInvocationsTable.id });
      if (!renewedInvocation) throw new TaskLeaseOwnershipMismatchError();
    }
  });
}

function enqueueRenewal(state: HeartbeatState): Promise<void> {
  const renewal = state.tail
    .catch(() => undefined)
    .then(() => renewOwnership(state));
  state.tail = renewal.catch(() => undefined);
  return renewal;
}

function clearScheduledTimer(state: HeartbeatState): void {
  if (!state.timer) return;
  state.runtime.clearTimeout(state.timer);
  state.timer = null;
}

async function persistOwnershipLoss(
  state: HeartbeatState,
  error: unknown,
): Promise<void> {
  const failureKind =
    error instanceof EmergencyStopError ? "emergency_stop" : "lease_lost";
  await loseTaskAttemptAfterOwnershipLoss({
    attemptId: state.input.attemptId,
    taskId: state.input.taskId,
    agentId: state.input.agentId,
    leaseOwner: state.input.leaseOwner,
    failureKind,
    sanitizedError:
      failureKind === "emergency_stop"
        ? "Emergency stop revoked task ownership."
        : "Task or agent lease owner no longer matches this attempt.",
    now: timestampFrom(state.runtime),
  }).catch((persistError) => {
    logger.error(
      {
        error: persistError,
        taskId: state.input.taskId,
        attemptId: state.input.attemptId,
      },
      "Failed to persist lost task attempt after ownership loss",
    );
  });
}

async function handleRenewalFailure(
  state: HeartbeatState,
  error: unknown,
  explicitAssertion: boolean,
): Promise<never> {
  const exactOwnershipLoss =
    error instanceof TaskLeaseOwnershipMismatchError ||
    error instanceof EmergencyStopError;
  state.consecutiveFailures = Math.min(state.consecutiveFailures + 1, 3);
  if (exactOwnershipLoss) {
    state.permanentlyLost = true;
    clearScheduledTimer(state);
    await persistOwnershipLoss(state, error);
  }

  if (!explicitAssertion && !state.permanentlyLost) throw error;
  throw new TaskLeaseOwnershipLostError(
    exactOwnershipLoss
      ? "Task or agent lease owner no longer matches this attempt"
      : "Task lease ownership could not be verified",
  );
}

function scheduleHeartbeat(state: HeartbeatState): void {
  if (state.stopped || state.permanentlyLost) return;
  const timer = state.runtime.setTimeout(() => {
    const callback = (async () => {
      if (state.timer === timer) state.timer = null;
      if (state.stopped || state.permanentlyLost) return;
      try {
        await enqueueRenewal(state);
        state.consecutiveFailures = 0;
      } catch (error) {
        await handleRenewalFailure(state, error, false).catch(() => undefined);
      } finally {
        if (!state.stopped && !state.permanentlyLost) scheduleHeartbeat(state);
      }
    })();
    state.inFlightCallbacks.add(callback);
    void callback.finally(() => state.inFlightCallbacks.delete(callback));
    return callback;
  }, state.input.config.taskHeartbeatMs);
  state.timer = timer;
  timer.unref?.();
}

export function startTaskLeaseHeartbeat(
  input: StartTaskLeaseHeartbeatInput,
): TaskLeaseHeartbeat {
  const state: HeartbeatState = {
    input,
    runtime: input.runtime ?? systemRuntime,
    stopped: false,
    permanentlyLost: false,
    consecutiveFailures: 0,
    currentAction: "Görev üzerinde çalışıyor",
    timer: null,
    tail: Promise.resolve(),
    inFlightCallbacks: new Set(),
    stopPromise: null,
    activeOperations: new Map(),
  };

  const heartbeat: TaskLeaseHeartbeat = {
    async assertOwned(action) {
      if (state.stopped || state.permanentlyLost) {
        throw new TaskLeaseOwnershipLostError();
      }
      if (action) state.currentAction = action;
      try {
        await enqueueRenewal(state);
        state.consecutiveFailures = 0;
      } catch (error) {
        await handleRenewalFailure(state, error, true);
      }
    },
    attachOperationInvocation(input) {
      if (state.stopped || state.permanentlyLost) {
        throw new TaskLeaseOwnershipLostError();
      }
      if (
        !input.receiptId.trim() ||
        !input.invocationId.trim() ||
        !input.leaseOwner.trim() ||
        !input.workerInstanceId.trim()
      ) {
        throw new TypeError(
          "Attached operation invocation identity is incomplete.",
        );
      }
      state.activeOperations.set(input.invocationId, { ...input });
    },
    detachOperationInvocation(invocationId) {
      state.activeOperations.delete(invocationId);
    },
    stop() {
      if (state.stopPromise) return state.stopPromise;
      state.stopped = true;
      clearScheduledTimer(state);
      state.stopPromise = (async () => {
        await state.tail.catch(() => undefined);
        while (state.inFlightCallbacks.size > 0) {
          await Promise.allSettled([...state.inFlightCallbacks]);
        }
      })();
      return state.stopPromise;
    },
  };
  scheduleHeartbeat(state);
  return Object.freeze(heartbeat);
}
