import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

export interface TaskReadFailure {
  kind: "http" | "timeout" | "network";
  status: number | null;
  elapsedMs: number;
  retryAfterMs: number;
}
export interface TaskReadSummary {
  attempts: number;
  transientFailures: number;
  lastFailure: TaskReadFailure | null;
  lastTaskAt: string | null;
}
class TaskReadError extends Error {
  constructor(readonly failure: TaskReadFailure) {
    super("transient_task_observation_failure");
  }
}

/** Re-observe one admitted task; this function has no work-dispatch operation. */
export async function observeOwnedFirstTask<
  T extends { status: string },
>(input: {
  baseUrl: string;
  operatorToken: string;
  taskId: number;
  deadline: number;
  summary: TaskReadSummary;
  onTask?: (task: T) => void;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<unknown>;
}): Promise<T> {
  const origin = new URL(input.baseUrl);
  assert.ok(
    origin.protocol === "http:" &&
      ["127.0.0.1", "[::1]"].includes(origin.hostname) &&
      !origin.username &&
      !origin.password &&
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash,
    "owned_task_observation_origin_required",
  );
  assert.ok(Number.isSafeInteger(input.taskId) && input.taskId > 0);
  const now = input.now ?? Date.now,
    sleep = input.sleep ?? delay,
    read = input.fetch ?? fetch;
  const url = origin.origin + "/api/tasks/" + input.taskId;
  const wait = async (milliseconds: number) => {
    const remaining = input.deadline - now();
    if (remaining <= 0) throw new Error("task_observation_deadline");
    await sleep(Math.min(milliseconds, remaining));
  };
  for (;;) {
    const started = now(),
      remaining = input.deadline - started;
    if (remaining <= 0) throw new Error("task_observation_deadline");
    const signal = AbortSignal.timeout(Math.max(1, Math.min(15000, remaining)));
    input.summary.attempts++;
    let task: T;
    try {
      let response: Response;
      try {
        response = await read(url, {
          method: "GET",
          headers: { authorization: "Bearer " + input.operatorToken },
          redirect: "error",
          signal,
        });
      } catch (error) {
        if (
          !signal.aborted &&
          !(error instanceof TypeError) &&
          !(
            error instanceof Error &&
            ["AbortError", "TimeoutError"].includes(error.name)
          )
        )
          throw new Error("unexpected_task_observation_error");
        throw new TaskReadError({
          kind: signal.aborted ? "timeout" : "network",
          status: null,
          elapsedMs: now() - started,
          retryAfterMs: 1000,
        });
      }
      if (!response.ok) {
        const retryable = [408, 429, 500, 502, 503, 504].includes(
          response.status,
        );
        const header = response.headers.get("retry-after") ?? "";
        const retryAfterMs = /^\d+$/u.test(header)
          ? Math.min(Number(header) * 1000, Number.MAX_SAFE_INTEGER)
          : 1000;
        await response.body?.cancel().catch(() => undefined);
        if (!retryable)
          throw new Error("terminal_task_observation_http_" + response.status);
        throw new TaskReadError({
          kind: "http",
          status: response.status,
          elapsedMs: now() - started,
          retryAfterMs,
        });
      }
      try {
        task = (await response.json()) as T;
      } catch (error) {
        if (
          signal.aborted ||
          error instanceof TypeError ||
          (error instanceof Error &&
            ["AbortError", "TimeoutError"].includes(error.name))
        )
          throw new TaskReadError({
            kind: signal.aborted ? "timeout" : "network",
            status: response.status,
            elapsedMs: now() - started,
            retryAfterMs: 1000,
          });
        throw new Error("invalid_task_observation_json");
      }
      if (
        !task ||
        ![
          "pending",
          "planning",
          "in_progress",
          "awaiting_approval",
          "blocked",
          "completed",
          "failed",
          "cancelled",
        ].includes(task.status)
      )
        throw new Error("invalid_task_observation_state");
    } catch (error) {
      if (!(error instanceof TaskReadError)) throw error;
      input.summary.lastFailure = error.failure;
      input.summary.transientFailures++;
      // Preserve the original task deadline and fail persistent read outages.
      if (input.summary.transientFailures > 3)
        throw new Error("task_observation_transient_limit");
      await wait(error.failure.retryAfterMs);
      continue;
    }
    if (now() >= input.deadline) throw new Error("task_observation_deadline");
    input.summary.lastTaskAt = new Date(now()).toISOString();
    input.onTask?.(task);
    if (["completed", "failed", "blocked", "cancelled"].includes(task.status))
      return task;
    await wait(1000);
  }
}
