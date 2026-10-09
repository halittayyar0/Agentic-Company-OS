import assert from "node:assert/strict";
import test from "node:test";
import {
  agentsTable,
  db,
  dbReady,
  closeDatabase,
  tasksTable,
  usageEventsTable,
} from "@workspace/db";
import {
  readIndividualTaskSpendAdmission,
  readTaskSpendAdmission,
  TaskSpendBudgetError,
} from "./task-spend-admission";
import { readFamilySpendAdmission } from "./family-spend-admission";
import { runJudge } from "./judge";

test.after(() => closeDatabase());
test("unknown durable token receipts stop task and family inference in each applicable window", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Unknown token fence",
      role: "Fixture",
      systemPrompt: "Fixture",
    })
    .returning();
  const now = new Date(),
    yesterday = new Date(now.getTime() - 86_400_000),
    cycleStart = new Date(now.getTime() - 60_000);
  const limits = { maxSteps: null, maxTokens: 100_000, maxReportedCostUsd: 10 };
  for (const scenario of [
    "finite",
    "cycle",
    "rolling_day",
    "outside_windows",
    "measured_tokens",
    "measured_zero",
    "partial",
    "legacy",
  ] as const) {
    await t.test(scenario, async () => {
      const [root] = await db
        .insert(tasksTable)
        .values({
          ownerAgentId: agent.id,
          title: scenario,
          brief: "Fixture",
          autonomyMode:
            scenario === "finite" ||
            scenario === "partial" ||
            scenario === "legacy"
              ? "finite"
              : "continuous",
          lastCycleCompletedAt: cycleStart,
        })
        .returning();
      const [child] = await db
        .insert(tasksTable)
        .values({
          ownerAgentId: agent.id,
          parentTaskId: root.id,
          title: "Child",
          brief: "Fixture",
        })
        .returning();
      const createdAt =
        scenario === "rolling_day"
          ? new Date(cycleStart.getTime() - 60_000)
          : scenario === "outside_windows"
            ? new Date(yesterday.getTime() - 60_000)
            : now;
      for (const taskId of [root.id, child.id]) {
        await db.insert(usageEventsTable).values({
          taskId,
          agentId: agent.id,
          kind: "task_step",
          modelId: "chatgpt:fixture",
          provider: "chatgpt",
          totalTokens: scenario === "measured_tokens" ? 5 : 0,
          usageReported:
            scenario === "legacy"
              ? null
              : scenario === "measured_tokens" || scenario === "measured_zero",
          reportedCostUsd: null,
          createdAt,
        });
        if (scenario === "partial")
          await db.insert(usageEventsTable).values({
            taskId,
            agentId: agent.id,
            kind: "judge",
            modelId: "fixture",
            provider: "fixture",
            totalTokens: 3,
            usageReported: true,
            reportedCostUsd: null,
            createdAt,
          });
      }
      const individual = await readIndividualTaskSpendAdmission(
        root,
        limits,
        "en",
        now,
      );
      const family = await readFamilySpendAdmission(child.id, "en", now);
      const allowed =
        scenario === "measured_tokens" ||
        scenario === "measured_zero" ||
        scenario === "outside_windows";
      for (const admission of [individual, family]) {
        if (allowed) assert.equal(admission.reason, null);
        else
          assert.match(
            admission.reason ?? "",
            /usage.*not reported|unreported.*usage/i,
            `${scenario} must stop before any subsequent inference`,
          );
        assert.equal(
          admission.reportedCostUsd,
          null,
          "unknown dollars are never fabricated",
        );
      }
    });
  }
});

test("unreceipted legacy tokens pause below the numerical cap without clearing their evidence", async () => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: "Legacy usage", role: "Fixture", systemPrompt: "Fixture" })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      ownerAgentId: agent.id,
      title: "Legacy",
      brief: "Fixture",
      tokensUsed: 7,
    })
    .returning();
  for (const result of [
    await readIndividualTaskSpendAdmission(task, undefined, "en"),
    await readFamilySpendAdmission(task.id, "en"),
  ]) {
    assert.match(result.reason ?? "", /usage.*not reported/i);
    assert.equal(result.tokensUsed, 7);
    assert.equal(result.tokenUsageCoverage, "unknown");
  }
});

test("an unreported child receipt stops parent completion review before a provider request", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: "Unknown child", role: "Fixture", systemPrompt: "Fixture" })
    .returning();
  const [root] = await db
    .insert(tasksTable)
    .values({ ownerAgentId: agent.id, title: "Parent", brief: "Fixture" })
    .returning();
  const [child] = await db
    .insert(tasksTable)
    .values({
      ownerAgentId: agent.id,
      parentTaskId: root.id,
      title: "Child",
      brief: "Fixture",
    })
    .returning();
  await db.insert(usageEventsTable).values({
    agentId: agent.id,
    taskId: child.id,
    kind: "task_step",
    provider: "chatgpt",
    modelId: "chatgpt:fixture",
    usageReported: false,
    totalTokens: 0,
  });
  assert.equal(
    (await readIndividualTaskSpendAdmission(root, undefined, "en")).reason,
    null,
  );
  const result = await readTaskSpendAdmission(root, undefined, "en");
  assert.equal(result.budgetScope, "family");
  assert.equal(result.rootTaskId, root.id);
  const originalFetch = globalThis.fetch;
  const fixtureEnv = [
    "AI_INTEGRATIONS_OPENAI_API_KEY",
    "AI_INTEGRATIONS_OPENAI_BASE_URL",
  ] as const;
  const previous = fixtureEnv.map((name) => process.env[name]);
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "fixture";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
  let calls = 0,
    reviews = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("No provider request is allowed");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    fixtureEnv.forEach((name, i) => {
      if (previous[i] === undefined) delete process.env[name];
      else process.env[name] = previous[i];
    });
  });
  await assert.rejects(
    runJudge({
      locale: "en",
      agent,
      taskId: root.id,
      purpose: "completion",
      originalBrief: "Fixture",
      actionSummary: "Fixture",
      persistReview: async () => {
        reviews++;
      },
    }),
    (error) =>
      error instanceof TaskSpendBudgetError &&
      /usage.*not reported/i.test(error.message),
  );
  assert.equal(calls, 0);
  assert.equal(reviews, 0);
});
