import assert from "node:assert/strict";
import test from "node:test";
import { openai } from "./client";
import {
  ChatCompletionTimeoutError,
  resolveLlmRequestTimeoutMs,
  withChatCompletionTimeout,
  createChatCompletion,
} from "./openrouter";

test("missing fleet credentials fail before the durable dispatch boundary", async () => {
  const names = [
    "AI_INTEGRATIONS_OPENAI_BASE_URL",
    "AI_INTEGRATIONS_OPENAI_API_KEY",
  ] as const;
  const saved = names.map((name) => process.env[name]);
  let guards = 0;
  try {
    for (const name of names) delete process.env[name];
    await assert.rejects(
      createChatCompletion({
        model: "gpt-5.6-terra",
        messages: [],
        beforeRequest: async () => {
          guards++;
        },
      }),
      /must be set/u,
    );
    assert.equal(guards, 0);
  } finally {
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  }
});

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

test("the actual fleet entry observes one late SDK response after caller cancellation without another request", async (t) => {
  const names = [
    "AI_INTEGRATIONS_OPENAI_BASE_URL",
    "AI_INTEGRATIONS_OPENAI_API_KEY",
  ] as const;
  const saved = names.map((name) => process.env[name]);
  let release!: (value: unknown) => void,
    entered!: () => void,
    observed!: () => void,
    calls = 0,
    dispatches = 0;
  const held = new Promise((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    evidenceSaved = new Promise<void>((resolve) => {
      observed = resolve;
    });
  try {
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "http://127.0.0.1:1/v1";
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "owned-offline-sdk-fixture";
    t.mock.method(openai.chat.completions, "create", async () => {
      calls++;
      entered();
      return held;
    });
    const controller = new AbortController(),
      failure = new Error("owned caller cancellation");
    const pending = createChatCompletion({
      model: "gpt-5.6-terra",
      messages: [],
      signal: controller.signal,
      beforeRequest: async () => {
        dispatches++;
      },
      onResponseUsage: async (value) => {
        assert.equal(value.provider, "replit");
        assert.equal(value.model, "gpt-5.6-terra");
        assert.equal(value.usage.total_tokens, 5);
        observed();
      },
    });
    const rejected = assert.rejects(pending, (error) => error === failure);
    await started;
    controller.abort(failure);
    await rejected;
    release({
      id: "resp_owned_late",
      object: "chat.completion",
      created: 1,
      model: "canonical-version",
      choices: [],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    });
    await evidenceSaved;
    assert.equal(calls, 1);
    assert.equal(dispatches, 1);
  } finally {
    names.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    });
  }
});
