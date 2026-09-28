import assert from "node:assert/strict";
import test from "node:test";
import { taskRetryDecision } from "./task-retry-policy";

test("finite work remains queued through repeated provider/model outages", () => {
  const decision = taskRetryDecision({
    autonomyMode: "finite",
    failureKind: "model_routes_exhausted",
    consecutiveFailures: 500,
    maxConsecutiveRuntimeFailures: 5,
  });
  assert.equal(decision.shouldBlock, false);
  assert.equal(decision.retryDelayMs, 15 * 60_000);
});

test("finite runtime bugs retain a bounded circuit breaker", () => {
  assert.equal(
    taskRetryDecision({
      autonomyMode: "finite",
      failureKind: "runtime",
      consecutiveFailures: 4,
      maxConsecutiveRuntimeFailures: 5,
    }).shouldBlock,
    false,
  );
  assert.equal(
    taskRetryDecision({
      autonomyMode: "finite",
      failureKind: "runtime",
      consecutiveFailures: 5,
      maxConsecutiveRuntimeFailures: 5,
    }).shouldBlock,
    true,
  );
});

test("continuous responsibilities remain recoverable and backoff is capped", () => {
  const decision = taskRetryDecision({
    autonomyMode: "continuous",
    failureKind: "runtime",
    consecutiveFailures: 50,
    maxConsecutiveRuntimeFailures: 5,
  });
  assert.equal(decision.shouldBlock, false);
  assert.equal(decision.retryDelayMs, 15 * 60_000);
});
