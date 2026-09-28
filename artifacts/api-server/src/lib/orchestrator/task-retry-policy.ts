export type TaskStepFailureKind = "model_routes_exhausted" | "runtime";

export interface TaskRetryDecision {
  shouldBlock: boolean;
  retryDelayMs: number;
}

/**
 * Provider/model availability is infrastructure state, not proof that the
 * assigned work is impossible. Such failures always remain queued with capped
 * backoff. Runtime failures still have a finite-task circuit breaker; a
 * continuous responsibility stays recoverable until the operator cancels it.
 */
export function taskRetryDecision(params: {
  autonomyMode: string;
  failureKind: TaskStepFailureKind;
  consecutiveFailures: number;
  maxConsecutiveRuntimeFailures: number;
}): TaskRetryDecision {
  const failureCount = Math.max(1, Math.floor(params.consecutiveFailures));
  const shouldBlock =
    params.failureKind !== "model_routes_exhausted" &&
    params.autonomyMode !== "continuous" &&
    failureCount >= Math.max(1, params.maxConsecutiveRuntimeFailures);
  return {
    shouldBlock,
    retryDelayMs: Math.min(
      15 * 60_000,
      30_000 * 2 ** Math.min(10, Math.max(0, failureCount - 1)),
    ),
  };
}
