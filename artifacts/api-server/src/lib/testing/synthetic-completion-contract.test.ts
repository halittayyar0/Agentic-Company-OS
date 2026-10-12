import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createSyntheticFaultPlan,
  createSyntheticFaultControlWriter,
  createFileBackedSyntheticFaultSource,
} from "./synthetic-fault-plan";
import { createSyntheticCompletion } from "./synthetic-completion";
import {
  ModelRoutesExhaustedError,
  runWithModelFallback,
} from "../orchestrator/model-fallback";
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
  tools: [
    {
      type: "function" as const,
      function: {
        name: "synthetic_fixture_write",
        parameters: { type: "object", properties: {} },
      },
    },
  ],
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

test("clearing a targeted timeout between model retries preserves its failure and releases the next task attempt", async (t) => {
  const runDirectory = await mkdtemp(
    path.join(tmpdir(), "synthetic-timeout-retry-"),
  );
  const keepAlive = setInterval(() => {}, 1_000);
  t.after(async () => {
    clearInterval(keepAlive);
    assert.equal(path.dirname(runDirectory), path.resolve(tmpdir()));
    await rm(runDirectory, { recursive: true, force: true });
  });
  const control = {
    runId: "owned-timeout-retry",
    seed,
    runDirectory,
    controlFile: path.join(runDirectory, "fault-control.json"),
  };
  const faultPlan = createSyntheticFaultPlan({ seed });
  const writer = createSyntheticFaultControlWriter(control);
  const faultSource = createFileBackedSyntheticFaultSource({
    ...control,
    basePlan: faultPlan,
  });
  await writer.set([{ ...identity, outcome: "timeout", delayMs: 5 }]);
  const completion = createSyntheticCompletion({
    ...control,
    identity,
    faultPlan,
    faultSource,
  });
  let failureCount = 0;
  let dispatchCount = 0;
  let usageCount = 0;
  await assert.rejects(
    runWithModelFallback({
      routes: [
        {
          modelId: "synthetic/endurance",
          provider: "ollama",
          source: "task_pin",
          tier: "standard",
          usedFallback: false,
        },
      ],
      attemptsPerRoute: 2,
      execute: () =>
        completion({
          ...params(),
          beforeRequest: async () => {
            dispatchCount++;
          },
          onResponseUsage: async () => {
            usageCount++;
          },
        }),
      onFailure: async () => {
        failureCount++;
        if (failureCount === 1) await writer.clear();
      },
      sleep: async () => {},
    }),
    (error) =>
      error instanceof ModelRoutesExhaustedError &&
      error.failures.length === 2 &&
      error.failures.every((failure) => failure.kind === "timeout"),
  );
  assert.equal(failureCount, 2);
  assert.equal(dispatchCount, 0);
  assert.equal(usageCount, 0);
  const recovered = await createSyntheticCompletion({
    ...control,
    identity: { ...identity, attemptNumber: identity.attemptNumber + 1 },
    faultPlan,
    faultSource,
  })(params());
  assert.equal(recovered.completion.choices.length, 1);

  // A retained outcome must not hide a malformed or rolled-back live control.
  await writeFile(
    control.controlFile,
    JSON.stringify({
      schemaVersion: 1,
      runId: control.runId,
      seed,
      revision: 1,
      entries: [{ ...identity, outcome: "timeout", delayMs: 5 }],
    }),
  );
  await assert.rejects(completion(params()), /revision rollback/iu);
});
