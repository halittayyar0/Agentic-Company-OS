import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  db,
  dbReady,
  taskAttemptsTable,
  tasksTable,
  usageEventsTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { readWorkspaceLocale } from "../workspace-locale";
import { toolMessage } from "./tool-localization";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import {
  claimDueTasks,
  enforceTaskBudgets,
  reviveAndReleaseStaleWork,
} from "./scheduler";

test("finite budgets use the durable usage ledger including judge calls", async () => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Ledger budget agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [finiteTask, continuousTask] = await db
    .insert(tasksTable)
    .values([
      {
        title: "Finite ledger budget",
        brief: "Judge usage must count toward the finite task budget.",
        ownerAgentId: agent.id,
        status: "pending",
        createdByUser: true,
      },
      {
        title: "Continuous ledger telemetry",
        brief: "Lifetime usage must not stop continuous cadence.",
        ownerAgentId: agent.id,
        status: "pending",
        autonomyMode: "continuous",
        cadenceSeconds: 60,
        createdByUser: true,
      },
    ])
    .returning();
  await db.insert(usageEventsTable).values([
    {
      agentId: agent.id,
      taskId: finiteTask.id,
      kind: "judge",
      modelId: "judge-test",
      provider: "openrouter",
      promptTokens: 100_000,
      totalTokens: 100_000,
      reportedCostUsd: "1.000000",
    },
    {
      agentId: agent.id,
      taskId: continuousTask.id,
      kind: "judge",
      modelId: "judge-test",
      provider: "openrouter",
      promptTokens: 100_000,
      totalTokens: 100_000,
      reportedCostUsd: "1.000000",
    },
  ]);

  const locale = await readWorkspaceLocale();
  await enforceTaskBudgets();

  const [blocked] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, finiteTask.id));
  const [stillContinuous] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, continuousTask.id));
  const [event] = await db
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.taskId, finiteTask.id),
        eq(activityEventsTable.type, "error"),
      ),
    );

  assert.equal(blocked.status, "blocked");
  assert.equal(
    blocked.lastError,
    toolMessage(locale, "schedulerTokenBudget", {
      used: 100_000,
      limit: 100_000,
    }),
  );
  assert.equal(blocked.tokensUsed, 0);
  assert.equal(
    event?.detail?.usageSource,
    "max(task_aggregate,usage_events_ledger)",
  );
  assert.equal(event?.detail?.tokensUsed, 100_000);
  assert.equal(stillContinuous.status, "pending");

  await db
    .update(tasksTable)
    .set({ status: "cancelled" })
    .where(eq(tasksTable.id, continuousTask.id));
  await db
    .update(agentsTable)
    .set({ isActive: false, status: "archived" })
    .where(eq(agentsTable.id, agent.id));
});

test("due-task selection cannot be starved by busy or inactive owners", async (t) => {
  await dbReady;
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  t.after(() => runtime.stopHeartbeat());
  const future = new Date(Date.now() + 10 * 60_000);
  const old = new Date(Date.now() - 60 * 60_000);
  const [busyOwner, inactiveOwner, availableOwner] = await db
    .insert(agentsTable)
    .values([
      {
        name: "Busy scheduler owner",
        role: "Test",
        systemPrompt: "Test only",
        status: "working",
        runLeaseOwner: "test:busy-owner",
        runLeaseExpiresAt: future,
        createdByUser: true,
      },
      {
        name: "Inactive scheduler owner",
        role: "Test",
        systemPrompt: "Test only",
        status: "archived",
        isActive: false,
        createdByUser: true,
      },
      {
        name: "Available scheduler owner",
        role: "Test",
        systemPrompt: "Test only",
        createdByUser: true,
      },
    ])
    .returning();

  await db.insert(tasksTable).values([
    ...Array.from({ length: 25 }, (_, index) => ({
      title: `Busy old task ${index}`,
      brief: "Must not occupy the global due-task candidate window.",
      ownerAgentId: busyOwner.id,
      status: "pending",
      createdByUser: true,
      updatedAt: old,
    })),
    ...Array.from({ length: 25 }, (_, index) => ({
      title: `Inactive old task ${index}`,
      brief: "Must not occupy the global due-task candidate window.",
      ownerAgentId: inactiveOwner.id,
      status: "pending",
      createdByUser: true,
      updatedAt: old,
    })),
  ]);
  const [availableTask] = await db
    .insert(tasksTable)
    .values({
      title: "Available owner due task",
      brief: "This task must be selected despite older ineligible rows.",
      ownerAgentId: availableOwner.id,
      status: "pending",
      createdByUser: true,
    })
    .returning();

  const claimed = await claimDueTasks(runtime, config);

  assert.deepEqual(
    claimed.map((task) => task.id),
    [availableTask.id],
  );
  assert.equal(claimed[0]?.ownerAgentId, availableOwner.id);
});

test("stale recovery preserves a durably committed continuous cadence even after a later heartbeat", async (t) => {
  await dbReady;
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  t.after(() => runtime.stopHeartbeat());
  const now = Date.now();
  const expired = new Date(now - 60_000);
  const heartbeat = new Date(now - 30_000);
  const cycleCompleted = new Date(now - 90_000);
  const nextRun = new Date(now + 7 * 24 * 60 * 60_000);
  const leaseOwner = `task:completed-cycle:${now}`;
  const [owner] = await db
    .insert(agentsTable)
    .values({
      name: "Cadence crash recovery owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: expired,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Committed seven-day cadence",
      brief: "A cleanup crash must not wake this responsibility early.",
      ownerAgentId: owner.id,
      status: "in_progress",
      autonomyMode: "continuous",
      cadenceSeconds: 7 * 24 * 60 * 60,
      cycleCount: 4,
      lastHeartbeatAt: heartbeat,
      lastCycleCompletedAt: cycleCompleted,
      nextAttemptAt: nextRun,
      leaseOwner,
      leaseExpiresAt: expired,
      stepAttempts: 1,
      createdByUser: true,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, owner.id));
  const attemptId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task.id,
    agentId: owner.id,
    workerInstanceId: runtime.id,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 4,
    state: "succeeded",
    startedAt: new Date(now - 120_000),
    lastHeartbeatAt: heartbeat,
    finishedAt: cycleCompleted,
  });

  await reviveAndReleaseStaleWork();

  const [persisted] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  const recoveryEvents = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.taskId, task.id));
  const [persistedAttempt] = await db
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.id, attemptId));
  assert.equal(persisted.leaseOwner, null);
  assert.equal(persisted.cycleCount, 4);
  assert.equal(
    persisted.lastCycleCompletedAt?.getTime(),
    cycleCompleted.getTime(),
  );
  assert.equal(persisted.nextAttemptAt?.getTime(), nextRun.getTime());
  assert.equal(persisted.recoveryCount, 0);
  assert.equal(persisted.lastError, null);
  assert.equal(persistedAttempt.state, "succeeded");
  assert.equal(
    recoveryEvents.some((event) => event.detail?.reason === "expired_lease"),
    false,
  );
});
