import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import OpenAI from "openai";
import { observeCompletionResponseUsage } from "./completion-usage-observer";
import {
  ChatCompletionTimeoutError,
  withChatCompletionTimeout,
} from "./openrouter";
test("a real loopback SDK response after the host deadline records parsed usage once without returning late output", async () => {
  let release!: () => void,
    observed!: () => void,
    requests = 0,
    observations = 0;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    saved = new Promise<void>((resolve) => {
      observed = resolve;
    });
  const server = createServer(async (req, res) => {
    requests++;
    assert.equal(req.url, "/v1/chat/completions");
    for await (const _chunk of req) {
      /* Consume owned synthetic request only. */
    }
    await held;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "resp_owned_loopback",
        object: "chat.completion",
        created: 1,
        model: "canonical-model",
        choices: [],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new OpenAI({
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "owned-loopback-fixture",
    maxRetries: 0,
  });
  try {
    // Deliberately omit the SDK signal: model the specified slow/ignored-abort
    // boundary with real HTTP parsing. This is not proof of a live provider's
    // cancellation behavior or the production fleet branch (tested separately).
    const pending = withChatCompletionTimeout(
      async () => {
        const completion = await client.chat.completions.create({
          model: "fixture",
          messages: [],
        });
        await observeCompletionResponseUsage(
          {
            model: "fixture",
            messages: [],
            onResponseUsage: async (value) => {
              observations++;
              assert.equal(value.responseId, "resp_owned_loopback");
              assert.equal(value.model, "fixture");
              assert.equal(value.usage.total_tokens, 5);
              observed();
            },
          },
          completion,
          "openai",
        );
        return completion;
      },
      undefined,
      100,
    );
    await assert.rejects(pending, ChatCompletionTimeoutError);
    release();
    await saved;
    assert.equal(requests, 1);
    assert.equal(observations, 1);
  } finally {
    release();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
