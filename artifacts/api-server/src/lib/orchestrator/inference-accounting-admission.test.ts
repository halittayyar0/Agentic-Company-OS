import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  tasksTable,
  usageEventsTable,
  inferenceAttemptsTable,
  taskAttemptsTable,
  db,
  dbReady,
  closeDatabase,
} from "@workspace/db";
import { readFamilySpendAdmission } from "./family-spend-admission";
import { enforceTaskBudgets } from "./scheduler";
import { stepTask } from "./step-task";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
test.after(() => closeDatabase());

async function fixture(t: test.TestContext) {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Owned family accounting fixture",
      role: "Fixture",
      systemPrompt: "Fixture",
    })
    .returning();
  const [root] = await db
    .insert(tasksTable)
    .values({
      title: "Owned recurring root",
      brief: "Fixture",
      ownerAgentId: agent.id,
      autonomyMode: "continuous",
      lastCycleCompletedAt: new Date(),
    })
    .returning();
  const [child] = await db
    .insert(tasksTable)
    .values({
      title: "Owned child",
      brief: "Fixture",
      ownerAgentId: agent.id,
      parentTaskId: root.id,
    })
    .returning();
  t.after(async () => {
    await db
      .delete(usageEventsTable)
      .where(eq(usageEventsTable.agentId, agent.id));
    await db
      .delete(inferenceAttemptsTable)
      .where(eq(inferenceAttemptsTable.agentId, agent.id));
    await db
      .delete(taskAttemptsTable)
      .where(eq(taskAttemptsTable.agentId, agent.id));
    await db.delete(tasksTable).where(eq(tasksTable.id, child.id));
    await db.delete(tasksTable).where(eq(tasksTable.id, root.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  return { agent, root, child };
}

test("associated chat and project meeting receipts consume the same rooted task allowance", async (t) => {
  const f = await fixture(t);
  await db.insert(usageEventsTable).values({
    agentId: f.agent.id,
    taskId: f.child.id,
    kind: "chat",
    modelId: "fixture",
    provider: "openrouter",
    promptTokens: 250001,
    totalTokens: 250001,
    usageReported: true,
  });
  const admission = await readFamilySpendAdmission(f.root.id, "en");
  assert.equal(admission.tokensUsed, 250001);
  assert.match(admission.reason ?? "", /shared.*token/iu);
});

test("unsettled inference blocks the entire family across cycle/day boundaries in all seven languages", async (t) => {
  const f = await fixture(t),
    id = randomUUID(),
    old = new Date(Date.now() - 10 * 86400_000);
  await db.insert(inferenceAttemptsTable).values({
    id,
    agentId: f.agent.id,
    taskId: f.child.id,
    scopeKey: `task:${f.root.id}`,
    modelId: "fixture",
    provider: "openrouter",
    kind: "task_step",
    state: "uncertain",
    createdAt: old,
    requestDeadlineAt: old,
    dispatchedAt: old,
    settledAt: old,
  });
  const reasons = new Set<string>();
  for (const locale of [
    "tr",
    "en",
    "de",
    "ru",
    "zh-CN",
    "zh-TW",
    "ar",
  ] as const) {
    const admission = await readFamilySpendAdmission(
      f.child.id,
      locale,
      new Date(Date.now() + 10 * 86400_000),
    );
    assert.ok(admission.reason);
    assert.equal(admission.accountingStatus, "recovery_required");
    assert.equal(admission.inferenceAttemptId, id);
    assert.ok(admission.reason.includes(id));
    assert.doesNotMatch(admission.reason, /\{[a-z]+\}/iu);
    reasons.add(admission.reason);
  }
  assert.equal(reasons.size, 7);
});

test("a live family inference defers queued work without consuming failures, then settlement permits progress", async (t) => {
  const f = await fixture(t),
    id = randomUUID();
  await db.insert(inferenceAttemptsTable).values({
    id,
    agentId: f.agent.id,
    taskId: f.root.id,
    scopeKey: `task:${f.root.id}`,
    modelId: "fixture",
    provider: "openrouter",
    kind: "chat",
    state: "dispatched",
    dispatchedAt: new Date(),
    requestDeadlineAt: new Date(Date.now() + 300000),
  });
  const admission = await readFamilySpendAdmission(f.child.id, "en");
  assert.equal(admission.accountingStatus, "pending");
  assert.equal(admission.inferenceAttemptId, id);
  await enforceTaskBudgets();
  const [waiting] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, f.child.id));
  assert.equal(waiting.status, "pending");
  assert.equal(waiting.blockedReason, null);
  assert.equal(waiting.consecutiveFailures, 0);
  assert.ok(
    waiting.nextAttemptAt && waiting.nextAttemptAt.getTime() > Date.now(),
  );
  assert.ok(waiting.lastError?.includes(id));
  await db.transaction(async (tx) => {
    await tx.insert(usageEventsTable).values({
      ordinaryInferenceId: id,
      agentId: f.agent.id,
      taskId: f.root.id,
      kind: "chat",
      modelId: "fixture",
      provider: "openrouter",
      usageReported: true,
    });
    await tx
      .update(inferenceAttemptsTable)
      .set({ state: "accounted", settledAt: new Date() })
      .where(eq(inferenceAttemptsTable.id, id));
  });
  const elapsed = new Date(Date.now() - 10000);
  await db
    .update(tasksTable)
    .set({ nextAttemptAt: elapsed })
    .where(eq(tasksTable.id, f.child.id));
  await enforceTaskBudgets();
  const [resumable] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, f.child.id));
  assert.equal(resumable.status, "pending");
  assert.equal(resumable.nextAttemptAt?.getTime(), elapsed.getTime());
  assert.equal((await readFamilySpendAdmission(f.child.id, "en")).reason, null);
});

function settleAfterAdmissionRead(t: test.TestContext, id: string) {
  const execute = db.execute.bind(db);
  let settled = false;
  t.mock.method(
    db,
    "execute",
    async (statement: Parameters<typeof db.execute>[0]) => {
      const result = await execute(statement);
      if (!settled && result.rows[0]?.accounting_id === id) {
        settled = true;
        await db.transaction(async (tx) => {
          const [attempt] = await tx
            .select()
            .from(inferenceAttemptsTable)
            .where(eq(inferenceAttemptsTable.id, id));
          await tx.insert(usageEventsTable).values({
            ordinaryInferenceId: id,
            agentId: attempt.agentId,
            taskId: attempt.taskId,
            kind: attempt.kind,
            modelId: attempt.modelId,
            provider: attempt.provider,
            usageReported: true,
          });
          await tx
            .update(inferenceAttemptsTable)
            .set({ state: "accounted", settledAt: new Date() })
            .where(eq(inferenceAttemptsTable.id, id));
        });
      }
      return result;
    },
  );
  return () => settled;
}

test("scheduler cannot block a family using an admission read superseded by settlement", async (t) => {
  const f = await fixture(t),
    id = randomUUID();
  await db.insert(inferenceAttemptsTable).values({
    id,
    agentId: f.agent.id,
    taskId: f.root.id,
    scopeKey: `task:${f.root.id}`,
    modelId: "fixture",
    provider: "openrouter",
    kind: "chat",
    state: "dispatched",
    dispatchedAt: new Date(),
    requestDeadlineAt: new Date(Date.now() - 10000),
  });
  const settled = settleAfterAdmissionRead(t, id);
  await enforceTaskBudgets();
  assert.equal(
    settled(),
    true,
    "The real admission snapshot must be superseded before the queue mutation",
  );
  const [root] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, f.root.id));
  assert.equal(root.status, "pending");
  assert.equal(root.blockedReason, null);
});

for (const mode of ["live", "abandoned", "settled"] as const)
  test(`a claimed task observes ${mode} inference without increasing its failure counter`, async (t) => {
    const pending = mode !== "abandoned";
    const f = await fixture(t),
      inferenceId = randomUUID(),
      leaseOwner = randomUUID();
    const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
    const runtime = await registerRuntimeInstance(
      { role: "worker", schedulerEnabled: true },
      config,
    );
    t.after(() => runtime.stopHeartbeat());
    const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      url = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "owned-test-key";
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
    t.after(() => {
      if (key === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = key;
      if (url === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = url;
    });
    const leaseExpiresAt = new Date(Date.now() + 900000);
    await db
      .update(agentsTable)
      .set({
        status: "working",
        currentTaskId: f.child.id,
        modelMode: "manual",
        modelId: "gpt-5.6-sol",
        runLeaseOwner: leaseOwner,
        runLeaseExpiresAt: leaseExpiresAt,
      })
      .where(eq(agentsTable.id, f.agent.id));
    const [claimed] = await db
      .update(tasksTable)
      .set({
        status: "in_progress",
        leaseOwner,
        leaseExpiresAt,
        consecutiveFailures: 9,
      })
      .where(eq(tasksTable.id, f.child.id))
      .returning();
    const attemptId = randomUUID(),
      logicalExecutionId = randomUUID();
    await db.insert(taskAttemptsTable).values({
      id: attemptId,
      taskId: f.child.id,
      agentId: f.agent.id,
      workerInstanceId: runtime.id,
      leaseOwner,
      attemptNumber: 1,
      cycleNumber: 0,
      state: "claimed",
      logicalExecutionId,
    });
    await db.insert(inferenceAttemptsTable).values({
      id: inferenceId,
      agentId: f.agent.id,
      taskId: f.root.id,
      scopeKey: `task:${f.root.id}`,
      modelId: "fixture",
      provider: "openrouter",
      kind: "chat",
      state: "dispatched",
      dispatchedAt: new Date(),
      requestDeadlineAt: new Date(
        Date.now() + (mode === "live" ? 300000 : -10000),
      ),
    });
    const settled =
      mode === "settled" ? settleAfterAdmissionRead(t, inferenceId) : null;
    let calls = 0;
    await stepTask(
      {
        ...claimed,
        leaseOwner,
        runtimeAttemptId: attemptId,
        runtimeInstanceId: runtime.id,
        logicalExecutionId,
      },
      {
        runtimeOperationsConfig: config,
        createCompletion: async () => {
          calls++;
          throw new Error("Fixture must never be dispatched");
        },
      },
    );
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, f.child.id));
    const [attempt] = await db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, attemptId));
    assert.equal(calls, 0);
    if (settled)
      assert.equal(
        settled(),
        true,
        "The real admission snapshot must be superseded before finalization",
      );
    assert.equal(task.consecutiveFailures, 9);
    assert.equal(task.status, pending ? "in_progress" : "blocked");
    assert.equal(attempt.state, pending ? "retrying" : "blocked");
    assert.equal(attempt.failureKind, "inference_accounting");
    assert.ok(task.lastError?.includes(inferenceId));
    assert.equal(task.leaseOwner, null);
    if (pending)
      assert.ok(
        task.nextAttemptAt && task.nextAttemptAt.getTime() > Date.now(),
      );
    else assert.equal(task.nextAttemptAt, null);
  });
