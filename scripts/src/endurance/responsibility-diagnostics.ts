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
