import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  tasksTable,
  usageEventsTable,
  db,
  dbReady,
  closeDatabase,
} from "@workspace/db";
import { recordCodexTaskUsage } from "./codex-task-usage";

test.after(() => closeDatabase());
test("one native inference records reported usage once, keeps unknown price and rejects conflicting replay", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Native usage fixture",
      role: "Fixture",
      systemPrompt: "Fixture",
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Native usage fixture",
      brief: "Fixture",
      ownerAgentId: agent.id,
    })
    .returning();
  t.after(async () => {
    await db
      .delete(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  const input = {
    inferenceKey: "codex:" + "a".repeat(64),
    agentId: agent.id,
    taskId: task.id,
    modelId: "chatgpt:fixture-model",
    usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    outcome: "completed" as const,
    failureKind: null,
  };
  await Promise.all([recordCodexTaskUsage(input), recordCodexTaskUsage(input)]);
  const events = await db
    .select()
    .from(usageEventsTable)
    .where(eq(usageEventsTable.agentId, agent.id));
  assert.equal(events.length, 1);
  assert.equal(events[0].totalTokens, 8);
  assert.equal(events[0].usageReported, true);
  assert.equal(events[0].reportedCostUsd, null);
  await assert.rejects(
    recordCodexTaskUsage({
      ...input,
      usage: { promptTokens: 5, completionTokens: 4, totalTokens: 9 },
    }),
    /codex_task_usage_conflict/,
  );
  await assert.rejects(
    recordCodexTaskUsage({ ...input, modelId: "chatgpt:other-model" }),
    /codex_task_usage_conflict/,
  );
});

test("unknown failed native usage and reported zero remain different without fabricated inference", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Unknown native usage fixture",
      role: "Fixture",
      systemPrompt: "Fixture",
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Unknown native usage fixture",
      brief: "Fixture",
      ownerAgentId: agent.id,
    })
    .returning();
  t.after(async () => {
    await db
      .delete(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  const input = {
    inferenceKey: "codex:" + "b".repeat(64),
    agentId: agent.id,
    taskId: task.id,
    modelId: "chatgpt:fixture-model",
    usage: null,
    outcome: "failed" as const,
    failureKind: "codex_interrupted",
  };
  await recordCodexTaskUsage(input);
  await recordCodexTaskUsage({
    ...input,
    inferenceKey: "codex:" + "c".repeat(64),
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  });
  const events = await db
    .select()
    .from(usageEventsTable)
    .where(eq(usageEventsTable.agentId, agent.id))
    .orderBy(usageEventsTable.id);
  assert.equal(events.length, 2);
  assert.equal(events[0].usageReported, false);
  assert.equal(events[1].usageReported, true);
  assert.equal(events[0].outcome, "failed");
  assert.equal(events[0].failureKind, "codex_interrupted");
  for (const bad of [
    { ...input, inferenceKey: "private-token" },
    {
      ...input,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 ** 31 },
    },
    { ...input, outcome: "completed" as const },
  ])
    await assert.rejects(recordCodexTaskUsage(bad), /codex_task_usage_invalid/);
  assert.equal(
    (
      await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.agentId, agent.id))
    ).length,
    2,
  );
});
