import assert from "node:assert/strict";
import test from "node:test";
import { PlanInferenceError } from "@workspace/ai-server";
import {
  ModelRoutesExhaustedError,
  ModelAdmissionDeniedError,
  classifyRecoverableModelError,
  modelCompatibilityExhaustedError,
  modelRetryDelayMs,
  runWithModelFallback,
} from "./model-fallback";
import type { ModelRouteCandidate } from "./model-select";

test("plan quota or interrupted usage cannot trigger another billable attempt or paid route", async () => {
  for (const kind of [
    "quota",
    "timeout",
    "temporary",
    "cancelled",
    "interrupted",
  ] as const) {
    const failure = new PlanInferenceError(
      kind,
      { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      kind === "quota" ? "subscription_sharing_usage_limit_exceeded" : null,
      kind === "temporary" ? 503 : 200,
    );
    let attempts = 0;
    await assert.rejects(
      runWithModelFallback({
        routes: [
          route("chatgpt:gpt-fixture", "chatgpt"),
          route("openai:gpt-paid", "openai", true),
        ],
        attemptsPerRoute: 3,
        execute: async () => {
          attempts++;
          throw failure;
        },
        sleep: async () => {
          throw new Error("Must not automatically replay plan usage");
        },
      }),
      (error: unknown) => error === failure,
    );
    assert.equal(attempts, 1);
  }
});

function route(
  modelId: string,
  provider: string,
  usedFallback = false,
): ModelRouteCandidate {
  return {
    modelId,
    provider,
    usedFallback,
    source: usedFallback ? "fallback" : "automatic",
    tier: "economy",
  };
}

function providerError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

test("owned admission denials preserve identity without provider retries, waits or failure telemetry", async () => {
  for (const message of [
    "Provider-reported budget reached",
    "Token quota reached",
    "Admission deadline reached",
  ]) {
    const denied = new ModelAdmissionDeniedError(message);
    assert.equal(classifyRecoverableModelError(denied), null);
    let attempts = 0,
      waits = 0,
      failures = 0;
    await assert.rejects(
      runWithModelFallback({
        routes: [
          route("primary", "provider-a"),
          route("fallback", "provider-b", true),
        ],
        execute: async () => {
          attempts++;
          throw denied;
        },
        sleep: async () => {
          waits++;
        },
        onFailure: () => {
          failures++;
        },
      }),
      (error) => error === denied,
    );
    assert.equal(attempts, 1);
    assert.equal(waits, 0);
    assert.equal(failures, 0);
  }
});

test("transient provider errors retry the same route with bounded backoff", async () => {
  const primary = route("primary", "provider-a");
  const delays: number[] = [];
  const failures: string[] = [];
  let calls = 0;

  const result = await runWithModelFallback({
    routes: [primary],
    attemptsPerRoute: 3,
    execute: async () => {
      calls += 1;
      if (calls < 3) throw providerError("rate limit", 429);
      return "ok";
    },
    sleep: async (delay) => {
      delays.push(delay);
    },
    onFailure: (failure) => {
      failures.push(failure.kind);
    },
  });

  assert.equal(result.value, "ok");
  assert.equal(result.route.modelId, "primary");
  assert.equal(result.attempts, 3);
  assert.deepEqual(failures, ["rate_limit", "rate_limit"]);
  assert.deepEqual(delays, [modelRetryDelayMs(1), modelRetryDelayMs(2)]);
  assert.ok(delays.every((delay) => delay <= 5_000));
});

test("auth and model compatibility failures move directly to the next route", async () => {
  const primary = route("pinned", "provider-a");
  const fallback = route("fallback", "provider-b", true);
  const attempted: string[] = [];
  const observedNextRoutes: Array<string | null> = [];

  const result = await runWithModelFallback({
    routes: [primary, fallback],
    attemptsPerRoute: 3,
    execute: async (candidate) => {
      attempted.push(candidate.modelId);
      if (candidate === primary) {
        throw providerError("unauthorized API key", 401);
      }
      return "recovered";
    },
    sleep: async () => {
      assert.fail("authentication failures must not be retried on one route");
    },
    onFailure: (failure) => {
      observedNextRoutes.push(failure.nextRoute?.modelId ?? null);
    },
  });

  assert.equal(result.value, "recovered");
  assert.equal(result.route, fallback);
  assert.deepEqual(attempted, ["pinned", "fallback"]);
  assert.deepEqual(observedNextRoutes, ["fallback"]);
  assert.equal(
    classifyRecoverableModelError(
      providerError("tools are not supported", 422),
    ),
    "tool_compatibility",
  );
  assert.equal(
    classifyRecoverableModelError(
      providerError("Unsupported judge response format", 422),
    ),
    "tool_compatibility",
  );
});

test("payment and depleted-credit failures immediately use another route", async () => {
  const primary = route("paid-primary", "provider-a");
  const fallback = route("alternate", "provider-b", true);
  const attempts: string[] = [];
  const failures: string[] = [];

  const result = await runWithModelFallback({
    routes: [primary, fallback],
    attemptsPerRoute: 3,
    execute: async (candidate) => {
      attempts.push(candidate.modelId);
      if (candidate === primary) {
        throw providerError(
          "Payment required: insufficient credit balance",
          402,
        );
      }
      return "recovered";
    },
    sleep: async () => {
      assert.fail("payment failures must not retry the depleted provider");
    },
    onFailure: (failure) => {
      failures.push(failure.kind);
    },
  });

  assert.equal(result.route, fallback);
  assert.deepEqual(attempts, ["paid-primary", "alternate"]);
  assert.deepEqual(failures, ["payment_required"]);
  assert.equal(
    classifyRecoverableModelError(
      providerError("Account balance exhausted; add funds", 400),
    ),
    "payment_required",
  );
});

test("application errors are not hidden by model fallback", async () => {
  const bug = new TypeError("application invariant failed");
  let calls = 0;
  await assert.rejects(
    runWithModelFallback({
      routes: [route("primary", "a"), route("fallback", "b", true)],
      execute: async () => {
        calls += 1;
        throw bug;
      },
      sleep: async () => {},
    }),
    (error) => error === bug,
  );
  assert.equal(calls, 1);
});

test("exhausted routes expose a safe bounded attempt ledger", async () => {
  await assert.rejects(
    runWithModelFallback({
      routes: [route("first", "a"), route("second", "b", true)],
      attemptsPerRoute: 1,
      execute: async (candidate) => {
        throw providerError(`${candidate.modelId} unavailable`, 503);
      },
      sleep: async () => {},
    }),
    (error) => {
      assert.ok(error instanceof ModelRoutesExhaustedError);
      assert.equal(error.failures.length, 2);
      assert.deepEqual(
        error.failures.map((failure) => failure.route.modelId),
        ["first", "second"],
      );
      assert.doesNotMatch(error.message, /api.?key|secret/iu);
      return true;
    },
  );
});

test("passive model output becomes a recoverable compatibility outage", () => {
  const error = modelCompatibilityExhaustedError(
    route("passive", "provider-a"),
    "passive_lifecycle_response",
  );

  assert.ok(error instanceof ModelRoutesExhaustedError);
  assert.equal(error.failures.length, 1);
  assert.equal(error.failures[0]?.kind, "tool_compatibility");
  assert.match(error.failures[0]?.safeMessage ?? "", /passive_lifecycle/u);
});
