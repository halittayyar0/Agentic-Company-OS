import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  taskAttemptsTable,
  type Task,
  type TaskAttempt,
  type TaskAttemptState,
} from "@workspace/db";
import { appendOperationsChanged } from "../operations/operations-events";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type TaskAttemptExecutor = typeof db | DatabaseTransaction;

export type ClaimedTask = Omit<Task, "leaseOwner"> & {
  leaseOwner: string;
  runtimeAttemptId: string;
  runtimeInstanceId: string;
  logicalExecutionId: string;
};

export interface CreateTaskAttemptInput {
  task: Omit<Task, "leaseOwner"> & { leaseOwner: string };
  workerInstanceId: string;
  recoveryOfAttemptId?: string | null;
  now?: Date;
}

export interface TransitionTaskAttemptInput {
  attemptId: string;
  taskId: number;
  agentId: number;
  leaseOwner: string;
  from: ReadonlyArray<TaskAttemptState>;
  state: TaskAttemptState;
  now?: Date;
  modelId?: string | null;
  provider?: string | null;
  failureKind?: string | null;
  sanitizedError?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reportedCostUsd?: number | null;
}

const TERMINAL_ATTEMPT_STATES = new Set<TaskAttemptState>([
  "succeeded",
  "retrying",
  "blocked",
  "lost",
]);

export async function recoveryParentForTask(
  task: Pick<Task, "id" | "stepAttempts">,
  executor: TaskAttemptExecutor = db,
): Promise<string | null> {
  if (task.stepAttempts <= 1) return null;
  const [candidate] = await executor
    .select({ id: taskAttemptsTable.id })
    .from(taskAttemptsTable)
    .where(
      and(
        eq(taskAttemptsTable.taskId, task.id),
        eq(taskAttemptsTable.attemptNumber, task.stepAttempts - 1),
        inArray(taskAttemptsTable.state, ["lost", "retrying"]),
      ),
    )
    .orderBy(
      desc(taskAttemptsTable.finishedAt),
      desc(taskAttemptsTable.startedAt),
    )
    .limit(1);
  return candidate?.id ?? null;
}

async function createTaskAttemptWithExecutor(
  input: CreateTaskAttemptInput,
  executor: TaskAttemptExecutor,
): Promise<TaskAttempt> {
  const now = input.now ?? new Date();
  let logicalExecutionId: string = randomUUID();
  if (input.recoveryOfAttemptId) {
    const [recoveryParent] = await executor
      .select({ logicalExecutionId: taskAttemptsTable.logicalExecutionId })
      .from(taskAttemptsTable)
      .where(
        and(
          eq(taskAttemptsTable.id, input.recoveryOfAttemptId),
          eq(taskAttemptsTable.taskId, input.task.id),
          eq(taskAttemptsTable.agentId, input.task.ownerAgentId),
          eq(taskAttemptsTable.cycleNumber, input.task.cycleCount),
          inArray(taskAttemptsTable.state, ["lost", "retrying"]),
        ),
      )
      .limit(1);
    if (!recoveryParent) {
      throw new Error("Task attempt recovery parent could not be resolved");
    }
    logicalExecutionId = recoveryParent.logicalExecutionId;
  }
  const [attempt] = await executor
    .insert(taskAttemptsTable)
    .values({
      id: randomUUID(),
      taskId: input.task.id,
      agentId: input.task.ownerAgentId,
      workerInstanceId: input.workerInstanceId,
      leaseOwner: input.task.leaseOwner,
      attemptNumber: input.task.stepAttempts,
      cycleNumber: input.task.cycleCount,
      state: "claimed",
      startedAt: now,
      lastHeartbeatAt: now,
      recoveryOfAttemptId: input.recoveryOfAttemptId ?? null,
      logicalExecutionId,
    })
    .returning();
  if (!attempt) throw new Error("Task attempt insert returned no row");
  await appendOperationsChanged(executor, {
    kind: "attempt_created",
    taskId: attempt.taskId,
    agentId: attempt.agentId,
    runtimeInstanceId: attempt.workerInstanceId,
    attemptId: attempt.id,
    state: attempt.state,
    createdAt: now,
  });
  return attempt;
}

export async function createTaskAttempt(
  input: CreateTaskAttemptInput,
  executor: TaskAttemptExecutor = db,
): Promise<TaskAttempt> {
  if (executor === db) {
    return db.transaction((tx) => createTaskAttemptWithExecutor(input, tx));
  }
  return createTaskAttemptWithExecutor(input, executor);
}

async function transitionTaskAttemptWithExecutor(
  input: TransitionTaskAttemptInput,
  executor: TaskAttemptExecutor,
): Promise<TaskAttempt | null> {
  const now = input.now ?? new Date();
  const [attempt] = await executor
    .update(taskAttemptsTable)
    .set({
      state: input.state,
      lastHeartbeatAt: now,
      finishedAt: TERMINAL_ATTEMPT_STATES.has(input.state) ? now : null,
      ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.failureKind !== undefined
        ? { failureKind: input.failureKind }
        : {}),
      ...(input.sanitizedError !== undefined
        ? { sanitizedError: input.sanitizedError }
        : {}),
      ...(input.promptTokens !== undefined
        ? { promptTokens: input.promptTokens }
        : {}),
      ...(input.completionTokens !== undefined
        ? { completionTokens: input.completionTokens }
        : {}),
      ...(input.totalTokens !== undefined
        ? { totalTokens: input.totalTokens }
        : {}),
      ...(input.reportedCostUsd !== undefined
        ? {
            reportedCostUsd:
              input.reportedCostUsd === null
                ? null
                : input.reportedCostUsd.toFixed(6),
          }
        : {}),
    })
    .where(
      and(
        eq(taskAttemptsTable.id, input.attemptId),
        eq(taskAttemptsTable.taskId, input.taskId),
        eq(taskAttemptsTable.agentId, input.agentId),
        eq(taskAttemptsTable.leaseOwner, input.leaseOwner),
        inArray(taskAttemptsTable.state, [...input.from]),
      ),
    )
    .returning();
  if (!attempt) return null;
  await appendOperationsChanged(executor, {
    kind: "attempt_state_changed",
    taskId: attempt.taskId,
    agentId: attempt.agentId,
    attemptId: attempt.id,
    state: attempt.state,
    createdAt: now,
  });
  return attempt;
}

export async function transitionTaskAttempt(
  input: TransitionTaskAttemptInput,
  executor: TaskAttemptExecutor = db,
): Promise<TaskAttempt | null> {
  if (executor === db) {
    return db.transaction((tx) => transitionTaskAttemptWithExecutor(input, tx));
  }
  return transitionTaskAttemptWithExecutor(input, executor);
}

export async function loseTaskAttemptAfterOwnershipLoss(input: {
  attemptId: string;
  taskId: number;
  agentId: number;
  leaseOwner: string;
  failureKind: "lease_lost" | "emergency_stop";
  sanitizedError: string;
  now?: Date;
}): Promise<boolean> {
  const attempt = await transitionTaskAttempt({
    attemptId: input.attemptId,
    taskId: input.taskId,
    agentId: input.agentId,
    leaseOwner: input.leaseOwner,
    from: ["claimed", "running"],
    state: "lost",
    now: input.now,
    failureKind: input.failureKind,
    sanitizedError: input.sanitizedError,
  });
  return attempt !== null;
}
