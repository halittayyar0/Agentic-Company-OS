export type TaskStepFailureKind =
  | "model_routes_exhausted"
  | "provider_setup_required"
  | "chatgpt_plan"
  | "runtime";

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
  planRetryAt?: number | null;
  now?: number;
}): TaskRetryDecision {
  const failureCount = Math.max(1, Math.floor(params.consecutiveFailures));
  const backoff = Math.min(
    15 * 60_000,
    30_000 * 2 ** Math.min(10, Math.max(0, failureCount - 1)),
  );
  if (params.failureKind === "chatgpt_plan") {
    // An unknown quota reset or unfinished response requires explicit review.
    // Only a quota's actual Retry-After allows automatic plan admission.
    const floor = params.planRetryAt;
    if (floor == null || !Number.isSafeInteger(floor) || floor <= 0)
      return { shouldBlock: true, retryDelayMs: 0 };
    return {
      shouldBlock: false,
      retryDelayMs: Math.max(backoff, floor - (params.now ?? Date.now())),
    };
  }
  const shouldBlock =
    params.failureKind !== "model_routes_exhausted" &&
    params.failureKind !== "provider_setup_required" &&
    params.autonomyMode !== "continuous" &&
    failureCount >= Math.max(1, params.maxConsecutiveRuntimeFailures);
  return {
    shouldBlock,
    retryDelayMs: backoff,
  };
}
