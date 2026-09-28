import assert from "node:assert/strict";
import test from "node:test";
import { configureOpenRouter } from "@workspace/ai-server";
import { resolveJudgeExecutionModelBoundary } from "./execute-tool";
import { selectJudgeModelPlan } from "./judge";

const original = {
  key: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseUrl: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
};

test.after(() => {
  if (original.key === undefined) {
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  } else {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = original.key;
  }
  if (original.baseUrl === undefined) {
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  } else {
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = original.baseUrl;
  }
  configureOpenRouter({ apiKey: null });
});

test("a free task pin also constrains completion judging to free routes", () => {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  configureOpenRouter({ apiKey: "test-openrouter-key" });

  const plan = selectJudgeModelPlan({
    agent: { depth: 1 },
    taskExecutionModelId: "minimax/minimax-m3:free",
  });

  assert.equal(plan.primary.modelId, "minimax/minimax-m3:free");
  assert.equal(plan.primary.source, "task_pin");
  assert.equal(plan.freeOnly, true);
  assert.ok(plan.routes.every((route) => route.modelId.endsWith(":free")));
});

test("a paid execution pin keeps the independent economy judge", () => {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  configureOpenRouter({ apiKey: "test-openrouter-key" });

  const plan = selectJudgeModelPlan({
    agent: { depth: 0 },
    taskExecutionModelId: "gpt-5.6-sol",
  });

  assert.notEqual(plan.primary.modelId, "gpt-5.6-sol");
  assert.equal(plan.primary.source, "automatic");
  assert.equal(plan.primary.tier, "economy");
  assert.equal(plan.freeOnly, false);
});

test("a legacy task inherits a manual free agent boundary for judging", () => {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  configureOpenRouter({ apiKey: "test-openrouter-key" });

  const effectiveBoundary = resolveJudgeExecutionModelBoundary({
    taskExecutionModelId: null,
    turnModelId: null,
    agentModelMode: "manual",
    agentModelId: "minimax/minimax-m3:free",
  });
  const plan = selectJudgeModelPlan({
    agent: { depth: 1 },
    taskExecutionModelId: effectiveBoundary,
  });

  assert.equal(effectiveBoundary, "minimax/minimax-m3:free");
  assert.equal(plan.freeOnly, true);
  assert.ok(plan.routes.every((route) => route.modelId.endsWith(":free")));
});

test("a per-message free override constrains approval judging for an automatic agent", () => {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  configureOpenRouter({ apiKey: "test-openrouter-key" });

  const effectiveBoundary = resolveJudgeExecutionModelBoundary({
    taskExecutionModelId: null,
    turnModelId: "minimax/minimax-m3:free",
    agentModelMode: "auto",
    agentModelId: null,
  });
  const plan = selectJudgeModelPlan({
    agent: { depth: 0 },
    taskExecutionModelId: effectiveBoundary,
  });

  assert.equal(effectiveBoundary, "minimax/minimax-m3:free");
  assert.equal(plan.freeOnly, true);
  assert.ok(plan.routes.every((route) => route.modelId.endsWith(":free")));
});

test("paid chat and agent selections do not pin the economy judge", () => {
  assert.equal(
    resolveJudgeExecutionModelBoundary({
      taskExecutionModelId: null,
      turnModelId: "gpt-5.6-sol",
      agentModelMode: "manual",
      agentModelId: "gpt-5.6-sol",
    }),
    null,
  );
});
