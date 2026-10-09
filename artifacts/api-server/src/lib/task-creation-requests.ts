import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  taskCreationRequestsTable as requests,
  tasksTable,
  type TaskCreationFailureCode,
} from "@workspace/db";
import {
  createProjectWithinTransaction,
  TaskOwnerUnavailable,
  ActiveWorkforceUnavailable,
  type ProjectCreationInput,
} from "./create-project";
import {
  lockRuntimeControlState,
  EmergencyStopError,
} from "./orchestrator/runtime-emergency-stop";
import { RuntimeCapacityError } from "./orchestrator/runtime-capacity";
import { ExecutionPolicyDenied } from "./execution-policy";

export class TaskCreationRequestError extends Error {
  constructor(
    readonly code:
      | "TASK_CREATION_REQUEST_INVALID"
      | "TASK_CREATION_REQUEST_CONFLICT"
      | "TASK_CREATION_PROJECT_REMOVED",
  ) {
    super(code);
  }
}
const identity =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function taskCreationRequestId(value: string): string {
  if (typeof value !== "string" || !identity.test(value))
    throw new TaskCreationRequestError("TASK_CREATION_REQUEST_INVALID");
  return value.toLowerCase();
}
function digest(input: ProjectCreationInput) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "task-creation-v1",
        input.title.trim(),
        input.brief,
        input.ownerAgentId ?? null,
        input.priority ?? "normal",
        input.dueAt?.toISOString() ?? null,
        input.autonomyMode ?? "finite",
        input.autonomyMode === "continuous"
          ? (input.cadenceSeconds ?? 3600)
          : null,
      ]),
    )
    .digest("hex");
}
function rejection(error: unknown): TaskCreationFailureCode | undefined {
  if (
    error instanceof EmergencyStopError ||
    error instanceof RuntimeCapacityError ||
    error instanceof ExecutionPolicyDenied
  )
    return error.code;
  if (
    error instanceof TaskOwnerUnavailable ||
    error instanceof ActiveWorkforceUnavailable
  )
    return "AGENT_UNAVAILABLE";
  return undefined;
}
export function taskCreationRejectionStatus(
  code: TaskCreationFailureCode,
): number {
  return code === "AGENT_UNAVAILABLE"
    ? 400
    : code === "RUNTIME_CAPACITY_EXCEEDED"
      ? 429
      : 423;
}
export async function readProjectCreationRequest(rawId: string) {
  const requestId = taskCreationRequestId(rawId);
  const [receipt] = await db
    .select({
      requestId: requests.requestId,
      state: requests.state,
      taskId: requests.taskId,
      failureCode: requests.failureCode,
      createdAt: requests.createdAt,
    })
    .from(requests)
    .where(eq(requests.requestId, requestId));
  return receipt;
}
export async function createProjectRequest(
  input: ProjectCreationInput,
  rawId: string,
) {
  const requestId = taskCreationRequestId(rawId),
    requestHash = digest(input);
  return db.transaction(async (tx) => {
    // Existing global control lock serializes API replicas before any agent lock.
    // Reading an accepted request under a stop never authorizes another dispatch.
    await lockRuntimeControlState(tx);
    const [prior] = await tx
      .select()
      .from(requests)
      .where(eq(requests.requestId, requestId));
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new TaskCreationRequestError("TASK_CREATION_REQUEST_CONFLICT");
      if (prior.state === "rejected")
        return {
          state: "rejected" as const,
          failureCode: prior.failureCode!,
          replayed: true,
        };
      const [task] = await tx
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, prior.taskId!));
      if (!task)
        throw new TaskCreationRequestError("TASK_CREATION_PROJECT_REMOVED");
      return { state: "created" as const, task, replayed: true };
    }
    let task: typeof tasksTable.$inferSelect;
    try {
      task = await createProjectWithinTransaction(tx, input);
    } catch (error) {
      const failureCode = rejection(error);
      if (!failureCode) throw error; // Storage/unknown failures roll back all writes.
      // These admission exceptions occur before project insertion. Save a final
      // rejection so a delayed copy cannot start after admission changes.
      await tx
        .insert(requests)
        .values({ requestId, requestHash, state: "rejected", failureCode });
      return { state: "rejected" as const, failureCode, replayed: false };
    }
    await tx
      .insert(requests)
      .values({ requestId, requestHash, state: "created", taskId: task.id });
    return { state: "created" as const, task, replayed: false };
  });
}
