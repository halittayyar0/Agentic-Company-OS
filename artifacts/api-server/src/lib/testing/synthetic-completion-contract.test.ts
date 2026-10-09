import assert from "node:assert/strict";
import test from "node:test";
import { createSyntheticFaultPlan } from "./synthetic-fault-plan";
import { createSyntheticCompletion } from "./synthetic-completion";
const identity = { taskId: 42, attemptNumber: 1, step: 0 },
  seed = 240901;
const options = (
  outcome: "success" | "malformed" | "rate_limit" | "timeout",
) => ({
  runId: "owned-adapter-contract",
  seed,
  identity,
  faultPlan: createSyntheticFaultPlan({
    seed,
    entries: [{ ...identity, outcome, delayMs: 1000 }],
  }),
});
const params = () => ({
  model: "synthetic/endurance",
  messages: [{ role: "user" as const, content: "Owned offline fixture" }],
});
for (const outcome of ["success", "malformed"] as const)
  test(`synthetic ${outcome} acknowledges one dispatch and awaits its exact bounded usage before returning`, async () => {
    const events: string[] = [];
    const completion = await createSyntheticCompletion(options(outcome))({
      ...params(),
      beforeRequest: async () => {
        events.push("dispatch");
      },
      onResponseUsage: async (evidence: unknown) => {
        assert.equal(events.at(-1), "dispatch");
        const saved = evidence as {
          provider: string;
          model: string;
          responseId: string;
          usage: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
          };
        };
        assert.equal(saved.provider, "ollama");
        assert.equal(saved.model, "synthetic/endurance");
        assert.equal(
          saved.usage.total_tokens,
          saved.usage.prompt_tokens + saved.usage.completion_tokens,
        );
        assert.ok(!JSON.stringify(evidence).includes("Owned offline fixture"));
        await new Promise((resolve) => setTimeout(resolve, 1));
        events.push("usage");
      },
    });
    events.push("returned");
    assert.deepEqual(events, ["dispatch", "usage", "returned"]);
    assert.equal(completion.provider, "ollama");
  });
test("a rejected synthetic dispatch cannot create output or report usage", async () => {
  const denied = new Error("Owned dispatch denied");
  let observed = 0;
  await assert.rejects(
    createSyntheticCompletion(options("success"))({
      ...params(),
      beforeRequest: async () => {
        throw denied;
      },
      onResponseUsage: async () => {
        observed++;
      },
    }),
    (error) => error === denied,
  );
  assert.equal(observed, 0);
});
test("synthetic rate limit and locally cancelled preparation never acknowledge dispatch or invent a receipt", async () => {
  for (const outcome of ["rate_limit", "timeout"] as const) {
    let dispatches = 0,
      observed = 0;
    const controller = new AbortController();
    if (outcome === "timeout")
      controller.abort(
        new DOMException("Owned preparation cancelled", "AbortError"),
      );
    await assert.rejects(
      createSyntheticCompletion(options(outcome))({
        ...params(),
        signal: controller.signal,
        beforeRequest: async () => {
          dispatches++;
        },
        onResponseUsage: async () => {
          observed++;
        },
      }),
    );
    assert.equal(dispatches, 0);
    assert.equal(observed, 0);
  }
});
