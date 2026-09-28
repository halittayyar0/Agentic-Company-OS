import assert from "node:assert/strict";
import test from "node:test";
import { taskBudgetBlockReason } from "./task-budget-policy";

const base = {
  autonomyMode: "finite",
  stepAttempts: 50_000,
  tokensUsed: 1_000,
  estimatedCostUsd: "0.010000",
};

test("finite work has no arbitrary lifetime step stop by default", () => {
  assert.equal(
    taskBudgetBlockReason(base, {
      maxSteps: null,
      maxTokens: 100_000,
      maxReportedCostUsd: 1,
    }),
    null,
  );
});

test("operators can opt into a hard step cap and finite token/cost gates remain", () => {
  assert.match(
    taskBudgetBlockReason(base, {
      maxSteps: 32,
      maxTokens: 100_000,
      maxReportedCostUsd: 1,
    }) ?? "",
    /adım sınırı/iu,
  );
  assert.match(
    taskBudgetBlockReason(
      { ...base, stepAttempts: 1, tokensUsed: 100_000 },
      {
        maxSteps: null,
        maxTokens: 100_000,
        maxReportedCostUsd: 1,
      },
    ) ?? "",
    /Token bütçesi/iu,
  );
  assert.match(
    taskBudgetBlockReason(
      { ...base, stepAttempts: 1, estimatedCostUsd: "1.000000" },
      {
        maxSteps: null,
        maxTokens: 100_000,
        maxReportedCostUsd: 1,
      },
    ) ?? "",
    /maliyet bütçesi/iu,
  );
});

test("continuous lifetime counters never masquerade as a per-cycle budget", () => {
  assert.equal(
    taskBudgetBlockReason(
      {
        ...base,
        autonomyMode: "continuous",
        stepAttempts: 1_000_000,
        tokensUsed: 1_000_000_000,
        estimatedCostUsd: "999999.000000",
      },
      {
        maxSteps: 1,
        maxTokens: 1,
        maxReportedCostUsd: 0.01,
      },
    ),
    null,
  );
});
