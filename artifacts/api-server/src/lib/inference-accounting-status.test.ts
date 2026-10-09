import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  inferenceAttemptsTable,
  usageEventsTable,
} from "@workspace/db";
import { readInferenceAccountingStatus } from "./inference-accounting-status";

test.after(() => closeDatabase());
async function fixture(t: test.TestContext) {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Accounting status fixture",
      role: "Fixture",
      systemPrompt: "PRIVATE-prompt-not-status",
    })
    .returning();
  const [root] = await db
    .insert(tasksTable)
    .values({
      title: "Status root",
      brief: "PRIVATE-brief",
      ownerAgentId: agent.id,
    })
    .returning();
  const [child] = await db
    .insert(tasksTable)
    .values({
      title: "Status child",
      brief: "Fixture",
      ownerAgentId: agent.id,
      parentTaskId: root.id,
    })
    .returning();
  const id = randomUUID(),
    now = new Date();
  await db.insert(inferenceAttemptsTable).values({
    id,
    agentId: agent.id,
    taskId: child.id,
    scopeKey: `task:${root.id}`,
    modelId: "fixture-model",
    provider: "ollama",
    kind: "chat",
    state: "dispatched",
    createdAt: now,
    dispatchedAt: now,
    requestDeadlineAt: new Date(now.getTime() + 10000),
  });
  t.after(async () => {
    await db
      .delete(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    await db
      .delete(inferenceAttemptsTable)
      .where(eq(inferenceAttemptsTable.agentId, agent.id));
    await db.delete(tasksTable).where(eq(tasksTable.id, child.id));
    await db.delete(tasksTable).where(eq(tasksTable.id, root.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  return { agent, root, child, id, now };
}
test("one read exposes the rooted family's pending, expired and durably settled evidence without changing work", async (t) => {
  const f = await fixture(t);
  const before = await db
    .select()
    .from(inferenceAttemptsTable)
    .where(eq(inferenceAttemptsTable.id, f.id));
  const pending = await readInferenceAccountingStatus("task", f.root.id, f.now);
  assert.ok(pending);
  assert.equal(pending.status, "pending");
  assert.equal(pending.rootTaskId, f.root.id);
  assert.equal(pending.unsettledCount, 1);
  assert.equal(pending.attempts[0].id, f.id);
  assert.equal(pending.attempts[0].taskId, f.child.id);
  assert.equal(pending.attempts[0].usage, null);
  const expired = await readInferenceAccountingStatus(
    "task",
    f.child.id,
    new Date(f.now.getTime() + 20000),
  );
  assert.equal(expired?.status, "recovery_required");
  assert.deepEqual(
    await db
      .select()
      .from(inferenceAttemptsTable)
      .where(eq(inferenceAttemptsTable.id, f.id)),
    before,
  );
  await db.transaction(async (tx) => {
    await tx.insert(usageEventsTable).values({
      ordinaryInferenceId: f.id,
      agentId: f.agent.id,
      taskId: f.child.id,
      modelId: "fixture-model",
      provider: "ollama",
      kind: "chat",
      promptTokens: 2,
      completionTokens: 3,
      totalTokens: 5,
      usageReported: true,
    });
    await tx
      .update(inferenceAttemptsTable)
      .set({ state: "accounted", settledAt: f.now })
      .where(eq(inferenceAttemptsTable.id, f.id));
  });
  const settled = await readInferenceAccountingStatus("task", f.root.id, f.now);
  assert.equal(settled?.status, "clear");
  assert.equal(settled?.unsettledCount, 0);
  assert.deepEqual(settled?.attempts[0].usage, {
    promptTokens: 2,
    completionTokens: 3,
    totalTokens: 5,
    usageReported: true,
    reportedCostUsd: null,
  });
  assert.doesNotMatch(
    JSON.stringify(settled),
    /PRIVATE|systemPrompt|brief|leaseOwner/,
  );
});
test("agent status shows taskless unknown usage as a lower bound, keeps other agents isolated and never claims zero cost", async (t) => {
  const f = await fixture(t);
  await db
    .update(inferenceAttemptsTable)
    .set({
      scopeKey: `agent:${f.agent.id}`,
      taskId: null,
      state: "uncertain",
      settledAt: f.now,
    })
    .where(eq(inferenceAttemptsTable.id, f.id));
  await db.insert(usageEventsTable).values({
    ordinaryInferenceId: f.id,
    agentId: f.agent.id,
    taskId: null,
    modelId: "fixture-model",
    provider: "ollama",
    kind: "chat",
    totalTokens: 4,
    usageReported: false,
  });
  const status = await readInferenceAccountingStatus(
    "agent",
    f.agent.id,
    f.now,
  );
  assert.equal(status?.status, "recovery_required");
  assert.equal(status?.rootTaskId, null);
  assert.equal(status?.attempts[0].usage?.usageReported, false);
  assert.equal(status?.attempts[0].usage?.totalTokens, 4);
  assert.equal(status?.attempts[0].usage?.reportedCostUsd, null);
  assert.equal(
    await readInferenceAccountingStatus("agent", 2147483647, f.now),
    null,
  );
  assert.equal(
    await readInferenceAccountingStatus("task", 2147483647, f.now),
    null,
  );
  assert.equal(
    (await readInferenceAccountingStatus("task", f.root.id, f.now))?.status,
    "recovery_required",
    "the owner's taskless uncertainty also fences this task",
  );
  await db.transaction(async (tx) => {
    await tx
      .update(usageEventsTable)
      .set({ usageReported: true })
      .where(eq(usageEventsTable.ordinaryInferenceId, f.id));
    await tx
      .update(inferenceAttemptsTable)
      .set({ state: "accounted" })
      .where(eq(inferenceAttemptsTable.id, f.id));
  });
  const unrelatedHistory = await readInferenceAccountingStatus(
    "task",
    f.root.id,
    f.now,
  );
  assert.equal(unrelatedHistory?.status, "clear");
  assert.deepEqual(
    unrelatedHistory?.attempts,
    [],
    "settled agent history must not cross into an unrelated task family",
  );
});
test("bounded history always puts an older unresolved marker before newer settled records", async (t) => {
  const f = await fixture(t);
  const old = new Date(f.now.getTime() - 100000);
  await db
    .update(inferenceAttemptsTable)
    .set({ createdAt: old })
    .where(eq(inferenceAttemptsTable.id, f.id));
  await db.insert(inferenceAttemptsTable).values(
    Array.from({ length: 21 }, (_, i) => ({
      id: randomUUID(),
      agentId: f.agent.id,
      taskId: f.child.id,
      scopeKey: `task:${f.root.id}`,
      modelId: "fixture-model",
      provider: "ollama",
      kind: "chat",
      state: "not_dispatched",
      createdAt: new Date(f.now.getTime() - i),
      requestDeadlineAt: f.now,
      settledAt: f.now,
    })),
  );
  const status = await readInferenceAccountingStatus("task", f.root.id, f.now);
  assert.equal(status?.attempts.length, 20);
  assert.equal(status?.hasMore, true);
  assert.equal(status?.unsettledCount, 1);
  assert.equal(status?.attempts[0].id, f.id);
});
