import type { ModelRouteCandidate } from "./model-select";

export type ModelFailureKind =
  | "rate_limit"
  | "timeout"
  | "authentication"
  | "payment_required"
  | "model_unavailable"
  | "tool_compatibility"
  | "provider_unavailable";

export interface ModelAttemptFailure {
  route: ModelRouteCandidate;
  routeIndex: number;
  attempt: number;
  kind: ModelFailureKind;
  retrySameRoute: boolean;
  nextDelayMs: number | null;
  nextRoute: ModelRouteCandidate | null;
  safeMessage: string;
}

export interface ModelFallbackResult<T> {
  value: T;
  route: ModelRouteCandidate;
  routeIndex: number;
  attempts: number;
}

interface ProviderErrorShape {
  status?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
  cause?: unknown;
}

export class ModelRoutesExhaustedError extends Error {
  readonly code = "MODEL_ROUTES_EXHAUSTED";
  readonly failures: ReadonlyArray<ModelAttemptFailure>;

  constructor(failures: ReadonlyArray<ModelAttemptFailure>) {
    const routes = [
      ...new Set(failures.map((failure) => failure.route.modelId)),
    ];
    super(
      `All ${routes.length} configured model route(s) were unavailable after ${failures.length} bounded attempt(s).`,
    );
    this.name = "ModelRoutesExhaustedError";
    this.failures = failures;
  }
}

export type ModelCompatibilityFailureReason =
  | "passive_lifecycle_response"
  | "tool_batch_limit_exceeded"
  | "lifecycle_tool_rejected"
  | "tool_calls_rejected";

/**
 * Converts a syntactically successful but unusable model response into the
 * same recoverable path as provider-declared tool incompatibility. This keeps
 * small/passive models from creating a tight, falsely-successful scheduler
 * loop when no permitted fallback route remains.
 */
export function modelCompatibilityExhaustedError(
  route: ModelRouteCandidate,
  reason: ModelCompatibilityFailureReason,
): ModelRoutesExhaustedError {
  return new ModelRoutesExhaustedError([
    {
      route,
      routeIndex: 0,
      attempt: 1,
      kind: "tool_compatibility",
      retrySameRoute: false,
      nextDelayMs: null,
      nextRoute: null,
      safeMessage: `${route.provider}/${route.modelId}: tool_compatibility (${reason})`,
    },
  ]);
}

function numericStatus(error: ProviderErrorShape): number | null {
  const direct = Number(error.status);
  if (Number.isInteger(direct) && direct >= 100 && direct <= 599) {
    return direct;
  }
  const cause =
    typeof error.cause === "object" && error.cause !== null
      ? (error.cause as ProviderErrorShape)
      : null;
  const nested = Number(cause?.status);
  return Number.isInteger(nested) && nested >= 100 && nested <= 599
    ? nested
    : null;
}

function errorText(error: ProviderErrorShape): string {
  return [error.name, error.code, error.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

/**
 * Only failures attributable to inference transport/capability are eligible
 * for model failover. Application bugs and lifecycle errors are deliberately
 * rethrown so a fallback cannot hide them.
 */
export function classifyRecoverableModelError(
  error: unknown,
): ModelFailureKind | null {
  if (!(error instanceof Error) && (typeof error !== "object" || !error)) {
    return null;
  }
  const shaped = error as ProviderErrorShape;
  const status = numericStatus(shaped);
  const text = errorText(shaped);

  if (
    /llm_request_timeout|timeout|timed out|deadline|aborterror/u.test(text) ||
    status === 408
  ) {
    return "timeout";
  }
  if (
    status === 402 ||
    /payment.?required|insufficient.{0,24}(?:credit|balance|fund)|(?:credit|account).{0,16}balance.{0,24}(?:low|empty|depleted|exhausted)|out of credits|add (?:funds|credits)|billing.{0,16}(?:limit|disabled)/u.test(
      text,
    )
  ) {
    return "payment_required";
  }
  if (status === 429 || /rate.?limit|quota|capacity|overloaded/u.test(text)) {
    return "rate_limit";
  }
  if (
    status === 401 ||
    status === 403 ||
    /unauthori[sz]ed|forbidden|api.?key/u.test(text)
  ) {
    return "authentication";
  }
  if (
    status === 404 ||
    /model.{0,32}(?:not found|unavailable|does not exist|no endpoints)/u.test(
      text,
    )
  ) {
    return "model_unavailable";
  }
  if (
    (status === 400 || status === 422) &&
    /tool|function|response.?format|unsupported|not support|invalid parameter/u.test(
      text,
    )
  ) {
    return "tool_compatibility";
  }
  if (
    (status !== null && status >= 500) ||
    status === 409 ||
    status === 425 ||
    /apiconnection|connection|econn|enotfound|fetch failed|network|socket|provider|base.?url|credentials?|must be (?:set|configured)/u.test(
      text,
    )
  ) {
    return "provider_unavailable";
  }
  return null;
}

export function resolveModelRetryAttempts(
  raw = process.env.MODEL_RETRY_ATTEMPTS_PER_ROUTE,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(3, Math.floor(parsed)));
}

export function modelRetryDelayMs(
  attempt: number,
  rawBase = process.env.MODEL_RETRY_BASE_DELAY_MS,
): number {
  const parsed = Number(rawBase);
  const base = Number.isFinite(parsed)
    ? Math.max(0, Math.min(5_000, Math.floor(parsed)))
    : 750;
  return Math.min(5_000, base * 2 ** Math.max(0, attempt - 1));
}

function safeFailureMessage(
  kind: ModelFailureKind,
  route: ModelRouteCandidate,
): string {
  return `${route.provider}/${route.modelId}: ${kind}`;
}

function defaultSleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Executes one logical completion against a bounded route plan. The same
 * conversation payload is supplied by the caller for every attempt, so a
 * provider switch cannot lose task context. A primary route is retried only
 * for transient failures; auth/model/tool incompatibility moves directly to
 * the next allowed route.
 */
export async function runWithModelFallback<T>(params: {
  routes: ReadonlyArray<ModelRouteCandidate>;
  execute: (route: ModelRouteCandidate) => Promise<T>;
  attemptsPerRoute?: number;
  onFailure?: (failure: ModelAttemptFailure) => void | Promise<void>;
  sleep?: (delayMs: number) => Promise<void>;
}): Promise<ModelFallbackResult<T>> {
  if (params.routes.length === 0) {
    throw new Error("At least one model route is required.");
  }
  const attemptsPerRoute = Math.max(
    1,
    Math.min(3, params.attemptsPerRoute ?? resolveModelRetryAttempts()),
  );
  const sleep = params.sleep ?? defaultSleep;
  const failures: ModelAttemptFailure[] = [];
  let attemptCount = 0;

  for (let routeIndex = 0; routeIndex < params.routes.length; routeIndex++) {
    const route = params.routes[routeIndex]!;
    for (let attempt = 1; attempt <= attemptsPerRoute; attempt++) {
      attemptCount += 1;
      try {
        return {
          value: await params.execute(route),
          route,
          routeIndex,
          attempts: attemptCount,
        };
      } catch (error) {
        const kind = classifyRecoverableModelError(error);
        if (!kind) throw error;

        const transient =
          kind === "rate_limit" ||
          kind === "timeout" ||
          kind === "provider_unavailable";
        const retrySameRoute = transient && attempt < attemptsPerRoute;
        const nextRoute = retrySameRoute
          ? null
          : (params.routes[routeIndex + 1] ?? null);
        const nextDelayMs = retrySameRoute ? modelRetryDelayMs(attempt) : null;
        const failure: ModelAttemptFailure = {
          route,
          routeIndex,
          attempt,
          kind,
          retrySameRoute,
          nextDelayMs,
          nextRoute,
          safeMessage: safeFailureMessage(kind, route),
        };
        failures.push(failure);
        await params.onFailure?.(failure);

        if (retrySameRoute) {
          await sleep(nextDelayMs!);
          continue;
        }
        break;
      }
    }
  }

  throw new ModelRoutesExhaustedError(failures);
}
