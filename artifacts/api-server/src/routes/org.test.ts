import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  approvalRequestsTable,
  db,
  dbReady,
  closeDatabase,
  tasksTable,
  usageEventsTable,
} from "@workspace/db";
test.after(() => closeDatabase());
import app from "../app";
import { seedDefaultOrg } from "../lib/seed";
import { AGENT_TEMPLATES } from "../lib/agent-templates";

test("organization summary aggregates operational data in the database", async (t) => {
  await dbReady;
  await seedDefaultOrg();
  await seedDefaultOrg();
  const roster = await db
    .select({ templateKey: agentsTable.templateKey })
    .from(agentsTable);
  const expectedCount = AGENT_TEMPLATES.filter(
    (template) => template.key !== "specialist",
  ).length;
  assert.equal(
    roster.length,
    expectedCount,
    "restarting does not duplicate stock experts",
  );
  for (const key of [
    "ux_designer",
    "quality_engineer",
    "data_analyst",
    "automation_specialist",
  ]) {
    assert.equal(roster.filter((agent) => agent.templateKey === key).length, 1);
  }

  const [seededRoot] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.isRootCeo, true));
  assert.ok(seededRoot);
  const [rootAgent] = await db
    .update(agentsTable)
    .set({ status: "working" })
    .where(eq(agentsTable.id, seededRoot.id))
    .returning();
  assert.ok(rootAgent);

  const [pendingTask, approvalTask] = await db
    .insert(tasksTable)
    .values([
      {
        title: "Aggregate pending task",
        brief: "Test-only task",
        status: "pending",
        ownerAgentId: rootAgent.id,
      },
      {
        title: "Aggregate approval task",
        brief: "Test-only task",
        status: "awaiting_approval",
        ownerAgentId: rootAgent.id,
      },
      {
        title: "Aggregate completed task",
        brief: "Test-only task",
        status: "completed",
        completedAt: new Date(),
        ownerAgentId: rootAgent.id,
      },
    ])
    .returning();
  assert.ok(pendingTask && approvalTask);

  await db.insert(approvalRequestsTable).values({
    taskId: approvalTask.id,
    agentId: rootAgent.id,
    category: "other",
    title: "Aggregate pending approval",
    description: "Test-only approval",
    status: "pending",
  });
  await db.insert(usageEventsTable).values({
    agentId: rootAgent.id,
    taskId: pendingTask.id,
    kind: "task_step",
    modelId: "test/model",
    provider: "test",
    promptTokens: 40,
    completionTokens: 60,
    totalTokens: 100,
    reportedCostUsd: "0.125",
    usageReported: true,
  });
  await db.insert(usageEventsTable).values([
    {
      agentId: rootAgent.id,
      taskId: pendingTask.id,
      kind: "task_step",
      modelId: "test/model",
      provider: "test",
      totalTokens: 50,
      usageReported: null,
    },
    {
      agentId: rootAgent.id,
      taskId: pendingTask.id,
      kind: "task_step",
      modelId: "chatgpt:fixture",
      provider: "chatgpt",
      totalTokens: 0,
      usageReported: false,
      outcome: "failed",
      failureKind: "interrupted",
    },
  ]);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/org/summary`,
  );
  assert.equal(response.status, 200);

  const summary = (await response.json()) as Record<string, number>;
  assert.equal(summary.totalAgents, expectedCount);
  assert.equal(summary.activeAgents, expectedCount);
  assert.equal(summary.workingAgents, 1);
  assert.equal(summary.tasksInProgress, 1);
  assert.equal(summary.tasksAwaitingApproval, 1);
  assert.equal(summary.tasksCompletedToday, 1);
  assert.equal(summary.pendingApprovals, 1);
  assert.equal(summary.tokensUsedToday, 150);
  assert.equal(summary.estimatedCostTodayUsd, 0.125);
  assert.equal(summary.usageEventsToday, 3);
  assert.equal(summary.costReportedEventsToday, 1);
  assert.equal(summary.tokenReportedEventsToday, 1);
  assert.equal(summary.tokenUnreportedEventsToday, 2);
  assert.equal(summary.tokenUsageCoverageToday, "partial");
});
