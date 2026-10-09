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
test.after(() => closeDatabase());
import {
  readTaskSpendBlockReason,
  readTaskSpendAdmission,
} from "./task-spend-admission";

test("reported cost coverage distinguishes empty, unknown and partial provider receipts", async () => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: "Coverage", role: "Test", systemPrompt: "Test" })
    .returning();
  for (const autonomyMode of ["finite", "continuous"] as const) {
    const [task] = await db
      .insert(tasksTable)
      .values({
        ownerAgentId: agent.id,
        title: "Coverage",
        brief: "Test",
        autonomyMode,
      })
      .returning();
    const limits = { maxSteps: null, maxTokens: 1, maxReportedCostUsd: 1 };
    let result = await readTaskSpendAdmission(task, limits, "en");
    assert.equal(result.reportedCostUsd, null);
    assert.equal(result.costCoverage, "no_usage");
    assert.equal(result.tokenUsageCoverage, "no_usage");
    await db.insert(usageEventsTable).values({
      agentId: agent.id,
      taskId: task.id,
      kind: "task_step",
      modelId: "test",
      provider: "test",
      totalTokens: 2,
      reportedCostUsd: null,
      usageReported: false,
    });
    result = await readTaskSpendAdmission(task, limits, "en");
    assert.equal(result.reportedCostUsd, null);
    assert.equal(result.costCoverage, "unknown");
    assert.equal(result.tokenUsageCoverage, "unknown");
    assert.equal(result.tokenUnreportedEvents, 1);
    await db.insert(usageEventsTable).values({
      agentId: agent.id,
      taskId: task.id,
      kind: "judge",
      usageReported: true,
      modelId: "test",
      provider: "test",
      totalTokens: 2,
      reportedCostUsd: "0.20",
    });
    result = await readTaskSpendAdmission(task, limits, "en");
    assert.equal(Number(result.reportedCostUsd), 0.2);
    assert.equal(result.costCoverage, "partial");
    assert.equal(result.tokenUsageCoverage, "partial");
    assert.equal(result.tokenReportedEvents, 1);
  }
});

test("recurring budgets use current-cycle usage and durable rolling usage separately", async () => {
  await dbReady;
  const now = new Date();
  const cycle = new Date(now.getTime() - 60_000);
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: "Spend", role: "Test", systemPrompt: "Test" })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      ownerAgentId: agent.id,
      title: "Daily",
      brief: "Test",
      autonomyMode: "continuous",
      lastCycleCompletedAt: cycle,
      tokensUsed: 999999,
      estimatedCostUsd: "999.00",
    })
    .returning();
  const usage = (tokens: number, date: Date) =>
    db.insert(usageEventsTable).values({
      agentId: agent.id,
      taskId: task.id,
      kind: "task_step",
      modelId: "test",
      provider: "test",
      totalTokens: tokens,
      usageReported: true,
      createdAt: date,
    });
  const limits = { maxSteps: null, maxTokens: 100, maxReportedCostUsd: 1 };
  await usage(150, new Date(cycle.getTime() - 60_000));
  assert.equal(await readTaskSpendBlockReason(task, limits, "en", now), null);
  await usage(100, now);
  assert.match(
    (await readTaskSpendBlockReason(task, limits, "en", now)) ?? "",
    /100/,
  );
  const reset = { ...task, lastCycleCompletedAt: new Date(now.getTime() + 1) };
  assert.equal(await readTaskSpendBlockReason(reset, limits, "en", now), null);
  const previous = process.env.MAX_RECURRING_DAILY_TOKENS;
  process.env.MAX_RECURRING_DAILY_TOKENS = "200";
  try {
    assert.match(
      (await readTaskSpendBlockReason(reset, limits, "en", now)) ?? "",
      /250/,
    );
  } finally {
    if (previous === undefined) delete process.env.MAX_RECURRING_DAILY_TOKENS;
    else process.env.MAX_RECURRING_DAILY_TOKENS = previous;
  }
});
