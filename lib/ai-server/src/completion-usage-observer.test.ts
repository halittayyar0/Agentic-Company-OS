import assert from "node:assert/strict";
import test from "node:test";
import { observeCompletionResponseUsage } from "./completion-usage-observer";
import { withChatCompletionTimeout } from "./openrouter";
const completion = {
  id: "resp_fixture",
  object: "chat.completion" as const,
  created: 1,
  model: "canonical-model",
  choices: [],
  usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
};
test("observations contain requested route and usage only, without model output or usage extras", async () => {
  let evidence: unknown;
  await observeCompletionResponseUsage(
    {
      model: "requested-alias",
      messages: [],
      onResponseUsage: async (value) => {
        evidence = value;
      },
    },
    completion,
    "openrouter",
  );
  assert.deepEqual(evidence, {
    provider: "openrouter",
    model: "requested-alias",
    responseId: "resp_fixture",
    usage: {
      prompt_tokens: 2,
      completion_tokens: 3,
      total_tokens: 5,
      cost: undefined,
    },
  });
});
test("missing or partial usage does not become full response evidence", async () => {
  let calls = 0;
  for (const usage of [
    undefined,
    { prompt_tokens: 2, completion_tokens: 3, total_tokens: 1 },
  ])
    await observeCompletionResponseUsage(
      {
        model: "fixture",
        messages: [],
        onResponseUsage: async () => {
          calls++;
        },
      },
      { ...completion, usage },
      "openrouter",
    );
  assert.equal(calls, 0);
});
test("response observation remains awaited and a callback failure is not swallowed", async () => {
  const failure = new Error("owned evidence store failure");
  await assert.rejects(
    observeCompletionResponseUsage(
      {
        model: "fixture",
        messages: [],
        onResponseUsage: async () => {
          throw failure;
        },
      },
      completion,
      "openrouter",
    ),
    (error) => error === failure,
  );
});
test("a response action completing after its host deadline can still observe usage without returning a late result", async () => {
  let release!: () => void,
    calls = 0;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const observed = new Promise<void>((resolve, reject) => {
    const pending = withChatCompletionTimeout(
      async () => {
        try {
          await held;
          await observeCompletionResponseUsage(
            {
              model: "fixture",
              messages: [],
              onResponseUsage: async () => {
                calls++;
                resolve();
              },
            },
            completion,
            "openrouter",
          );
          return completion;
        } catch (error) {
          reject(error);
          throw error;
        }
      },
      undefined,
      15,
    );
    void assert.rejects(pending).then(() => release());
  });
  await observed;
  assert.equal(calls, 1);
});
test("a rejected late journal callback stays handled after the deadline has already rejected the caller", async () => {
  let release!: () => void,
    observed!: () => void,
    calls = 0;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    done = new Promise<void>((resolve) => {
      observed = resolve;
    });
  const failure = new Error("owned late journal outage");
  const pending = withChatCompletionTimeout(
    async () => {
      await held;
      await observeCompletionResponseUsage(
        {
          model: "fixture",
          messages: [],
          onResponseUsage: async () => {
            calls++;
            observed();
            throw failure;
          },
        },
        completion,
        "openrouter",
      );
      return completion;
    },
    undefined,
    15,
  );
  await assert.rejects(pending, (error) => error !== failure);
  release();
  await done;
  // Advance past the rejection turn. node:test itself fails the test on any
  // unhandled rejection, including one reported after this body finishes.
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
});
