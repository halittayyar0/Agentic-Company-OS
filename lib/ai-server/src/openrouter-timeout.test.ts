import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatCompletionTimeoutError,
  resolveLlmRequestTimeoutMs,
  withChatCompletionTimeout,
} from "./openrouter";

test("LLM timeout configuration is finite and bounded", () => {
  assert.equal(resolveLlmRequestTimeoutMs("not-a-number"), 120_000);
  assert.equal(resolveLlmRequestTimeoutMs("1"), 5_000);
  assert.equal(resolveLlmRequestTimeoutMs("999999999"), 600_000);
  assert.equal(resolveLlmRequestTimeoutMs("45000"), 45_000);
});

test("LLM operations fail with a classified hard deadline", async () => {
  await assert.rejects(
    withChatCompletionTimeout(
      () => new Promise<never>(() => undefined),
      undefined,
      15,
    ),
    (error: unknown) =>
      error instanceof ChatCompletionTimeoutError &&
      error.code === "LLM_REQUEST_TIMEOUT" &&
      error.timeoutMs === 15,
  );
});

test("caller abort remains distinct from the runtime timeout", async () => {
  const controller = new AbortController();
  const callerError = new Error("caller cancelled");
  const pending = withChatCompletionTimeout(
    () => new Promise<never>(() => undefined),
    controller.signal,
    5_000,
  );
  controller.abort(callerError);
  await assert.rejects(pending, (error: unknown) => error === callerError);
});
