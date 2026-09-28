import assert from "node:assert/strict";
import test from "node:test";
import { configureDirectOpenAI } from "./first-party-providers";
import { createChatCompletion } from "./openrouter";

test("an explicit diagnostic disables SDK retries after a provider error", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  configureDirectOpenAI({ apiKey: "test-only-diagnostic-key" });
  globalThis.fetch = async () => {
    requests++;
    return new Response(
      JSON.stringify({
        error: { message: "Unavailable", type: "server_error" },
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    await assert.rejects(
      createChatCompletion({
        model: "openai:gpt-5.6-terra",
        messages: [{ role: "user", content: "OK" }],
        maxTokens: 10,
        disableRetries: true,
        signal: AbortSignal.timeout(5_000),
      }),
    );
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = original;
    configureDirectOpenAI({ apiKey: null });
  }
});
