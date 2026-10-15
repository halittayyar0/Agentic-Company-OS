const ATTEMPT_STATES = new Set([
  "not_started",
  "claimed",
  "running",
  "succeeded",
  "retrying",
  "blocked",
  "lost",
  "unknown",
]);
const TASK_STATES = new Set([
  "pending",
  "planning",
  "in_progress",
  "awaiting_approval",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "unknown",
]);
const RECEIPT_STATES = new Set([
  "reserved",
  "running",
  "succeeded",
  "failed",
  "unknown",
]);
const INVOCATION_STATES = new Set([
  "claimed",
  "running",
  "succeeded",
  "failed",
  "lost",
  "unknown",
]);
const BLOCKED_REASONS = new Set([
  "user_input",
  "budget",
  "runtime_failure",
  "approval_rejected",
  "approval_expired",
  "approval_outcome_unknown",
  "operation_outcome_unknown",
  "approval_action_failed",
  "owner_inactive",
  "unknown",
]);

export interface ResponsibilityGapSnapshot {
  sampledAt: string;
  expectedCycles: number;
  attemptsTruncated: boolean;
  receiptsTruncated: boolean;
  inferenceAccounting?: {
    status: string;
    observedAt: string;
    unsettledCount: number;
    hasMore: boolean;
    attempts: Array<{
      id: string;
      agentId: number;
      taskId: number | null;
      state: string;
      requestDeadlineAt: string;
      dispatchedAt: string | null;
      settledAt: string | null;
      savedEvidenceAvailable: boolean;
      usagePresent: boolean;
    }>;
  };
  gaps: Array<{
    agentId: number;
    cycleNumber: number;
    observedCompletedCycles: number;
    taskId: number | null;
    attemptState: string;
    attemptNumber: number | null;
    task: {
      status: string;
      cycleCount: number;
      nextAttemptAt: string | null;
      blockedReason: string | null;
    } | null;
    receiptStates: string[];
    invocationStates: string[];
  }>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid responsibility diagnostic object");
  return value as Record<string, unknown>;
}
function integer(
  value: unknown,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  )
    throw new TypeError("Invalid responsibility diagnostic integer");
  return Number(value);
}
function iso(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError("Invalid responsibility diagnostic timestamp");
  return value;
}
function state(value: unknown, allowed: Set<string>): string {
  return typeof value === "string" && allowed.has(value) ? value : "unknown";
}
function states(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value) || value.length > 32)
    throw new TypeError("Invalid responsibility diagnostic state collection");
  return [...new Set(value.map((value) => state(value, allowed)))].sort();
}

function normalizeAccounting(
  value: unknown,
): NonNullable<ResponsibilityGapSnapshot["inferenceAccounting"]> {
  const input = object(value);
  if (
    !Array.isArray(input.attempts) ||
    input.attempts.length > 20 ||
    typeof input.hasMore !== "boolean"
  )
    throw new TypeError("Invalid responsibility accounting diagnostic");
  const timestamp = (value: unknown) =>
    typeof value === "string"
      ? iso(value)
      : iso(new Date(integer(value, 0, 8640000000000000)).toISOString());
  return {
    status: state(
      input.status,
      new Set(["clear", "pending", "recovery_required"]),
    ),
    observedAt: timestamp(input.observedAt),
    unsettledCount: integer(input.unsettledCount),
    hasMore: input.hasMore,
    attempts: input.attempts.map((value) => {
      const attempt = object(value);
      if (
        typeof attempt.id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(
          attempt.id,
        ) ||
        typeof attempt.savedEvidenceAvailable !== "boolean"
      )
        throw new TypeError("Invalid responsibility accounting identity");
      return {
        id: attempt.id,
        agentId: integer(attempt.agentId, 1, 2147483647),
        taskId:
          attempt.taskId === null
            ? null
            : integer(attempt.taskId, 1, 2147483647),
        state: state(
          attempt.state,
          new Set([
            "reserved",
            "dispatched",
            "uncertain",
            "accounted",
            "not_dispatched",
          ]),
        ),
        requestDeadlineAt: timestamp(attempt.requestDeadlineAt),
        dispatchedAt:
          attempt.dispatchedAt === null
            ? null
            : timestamp(attempt.dispatchedAt),
        settledAt:
          attempt.settledAt === null ? null : timestamp(attempt.settledAt),
        savedEvidenceAvailable: attempt.savedEvidenceAvailable,
        usagePresent:
          typeof attempt.usagePresent === "boolean"
            ? attempt.usagePresent
            : attempt.usage !== null && attempt.usage !== undefined,
      };
    }),
  };
}

/** Reconstruct a bounded metadata record; never serialize upstream objects. */
export function normalizeResponsibilityGapSnapshot(
  value: unknown,
  expectedCycles: number,
): ResponsibilityGapSnapshot {
  const input = object(value);
  if (
    input.expectedCycles !== expectedCycles ||
    !Array.isArray(input.gaps) ||
    input.gaps.length > 10 ||
    typeof input.attemptsTruncated !== "boolean" ||
    typeof input.receiptsTruncated !== "boolean"
  )
    throw new TypeError("Invalid responsibility diagnostic scope");
  const seen = new Set<number>();
  return {
    sampledAt: iso(input.sampledAt),
    expectedCycles,
    attemptsTruncated: input.attemptsTruncated,
    receiptsTruncated: input.receiptsTruncated,
    ...(input.inferenceAccounting === undefined
      ? {}
      : {
          inferenceAccounting: normalizeAccounting(input.inferenceAccounting),
        }),
    gaps: input.gaps.map((value) => {
      const gap = object(value),
        agentId = integer(gap.agentId, 1, 2147483647);
      if (seen.has(agentId))
        throw new TypeError("Duplicate responsibility diagnostic agent");
      seen.add(agentId);
      const task = gap.task === null ? null : object(gap.task);
      return {
        agentId,
        cycleNumber: integer(gap.cycleNumber, 0, expectedCycles - 1),
        observedCompletedCycles: integer(
          gap.observedCompletedCycles,
          0,
          expectedCycles,
        ),
        taskId: gap.taskId === null ? null : integer(gap.taskId, 1, 2147483647),
        attemptState: state(gap.attemptState, ATTEMPT_STATES),
        attemptNumber:
          gap.attemptNumber === null ? null : integer(gap.attemptNumber, 1),
        task: task
          ? {
              status: state(task.status, TASK_STATES),
              cycleCount: integer(task.cycleCount),
              nextAttemptAt:
                task.nextAttemptAt === null ? null : iso(task.nextAttemptAt),
              blockedReason:
                task.blockedReason === null
                  ? null
                  : state(task.blockedReason, BLOCKED_REASONS),
            }
          : null,
        receiptStates: states(gap.receiptStates, RECEIPT_STATES),
        invocationStates: states(gap.invocationStates, INVOCATION_STATES),
      };
    }),
  };
}
