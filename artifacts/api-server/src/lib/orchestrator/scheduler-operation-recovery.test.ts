import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  messagesTable,
  operationInvocationsTable,
  operationReceiptsTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
  type OperationSideEffectClass,
} from "@workspace/db";
import {
  claimOperationInvocation,
  markOperationRunning,
  reserveOperation,
} from "./operation-receipts";
import { reviveAndReleaseStaleWorkCore } from "./scheduler";

async function createTaskOperationFixture(
  sideEffectClass: Extract<
    OperationSideEffectClass,
    "read_only" | "idempotent" | "at_most_once"
  >,
  toolOverride?: string,
) {
  await dbReady;
  const suffix = randomUUID();
  const leaseOwner = `task:${suffix}`;
  const now = new Date();
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Scheduler receipt agent ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(now.getTime() + 60_000),
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Scheduler receipt task ${suffix}`,
      brief: "Recover the durable operation before requeueing its attempt.",
      ownerAgentId: agent.id,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      stepAttempts: 1,
      createdByUser: true,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));

  const runtimeId = `runtime:${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "scheduler-operation-recovery-test",
    processId: 1901,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: now,
  });
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtimeId,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
  });

  const toolName =
    toolOverride ??
    (sideEffectClass === "read_only"
      ? "vm_read_file"
      : sideEffectClass === "idempotent"
        ? "vm_write_file"
        : "vm_run_command");
  const reservation = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId,
    toolName,
    args: { fixture: suffix },
    physical: {
      attemptId,
      workerInstanceId: runtimeId,
      modelToolCallId: `call:${suffix}`,
      callSlot: "round:0:tool:0",
    },
    taskId: task.id,
    agentId: agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: attemptId,
    sideEffectClass,
    externalIdempotencyKey:
      sideEffectClass === "idempotent" ? `effect:${suffix}` : null,
    now,
  });
  const invocationLeaseOwner = `operation:${suffix}`;
  const claim = await claimOperationInvocation({
    receiptId: reservation.receipt.id,
    executionKind: "task_step",
    attemptId,
    workerInstanceId: runtimeId,
    modelToolCallId: `call:${suffix}`,
    leaseOwner: invocationLeaseOwner,
    leaseExpiresAt: new Date(now.getTime() + 30_000),
    taskLeaseOwner: leaseOwner,
    agentLeaseOwner: leaseOwner,
    now,
  });
  assert.equal(claim.claimed, true);
  assert.ok(claim.invocation);
  return {
    now,
    agent,
    task,
    runtimeId,
    attemptId,
    receiptId: reservation.receipt.id,
    invocationId: claim.invocation.id,
    invocationLeaseOwner,
  };
}

async function expireTaskOperation(
  fixture: Awaited<ReturnType<typeof createTaskOperationFixture>>,
  options: { runtimeStale?: boolean } = {},
) {
  const staleAt = new Date(fixture.now.getTime() - 120_000);
  const expiredAt = new Date(fixture.now.getTime() - 1);
  if (options.runtimeStale !== false) {
    await db
      .update(runtimeInstancesTable)
      .set({ state: "stale", lastHeartbeatAt: staleAt })
      .where(eq(runtimeInstancesTable.id, fixture.runtimeId));
  }
  await db
    .update(agentsTable)
    .set({ runLeaseExpiresAt: expiredAt })
    .where(eq(agentsTable.id, fixture.agent.id));
  await db
    .update(tasksTable)
    .set({ leaseExpiresAt: expiredAt })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(operationInvocationsTable)
    .set({ leaseExpiresAt: expiredAt })
    .where(eq(operationInvocationsTable.id, fixture.invocationId));
}

test("scheduler blocks a crashed running at-most-once task operation before attempt recovery", async () => {
  const fixture = await createTaskOperationFixture("at_most_once");
  await markOperationRunning({
    receiptId: fixture.receiptId,
    invocationId: fixture.invocationId,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1),
  });
  await expireTaskOperation(fixture);

  await reviveAndReleaseStaleWorkCore(60_000);

  const [[receipt], [invocation], [task], [attempt]] = await Promise.all([
    db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, fixture.receiptId)),
    db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.id, fixture.invocationId)),
    db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, fixture.attemptId)),
  ]);
  assert.equal(receipt.state, "unknown");
  assert.equal(invocation.state, "unknown");
  assert.equal(task.status, "blocked");
  assert.equal(task.blockedReason, "operation_outcome_unknown");
  assert.equal(task.nextAttemptAt, null);
  assert.equal(task.recoveryCount, 0);
  assert.equal(attempt.state, "blocked");
  assert.equal(attempt.failureKind, "operation_outcome_unknown");
});

test("scheduler converges an expired effect even while its worker process remains healthy", async () => {
  const fixture = await createTaskOperationFixture("at_most_once");
  await markOperationRunning({
    receiptId: fixture.receiptId,
    invocationId: fixture.invocationId,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1),
  });
  await expireTaskOperation(fixture, { runtimeStale: false });

  await reviveAndReleaseStaleWorkCore(60_000);

  const [[receipt], [invocation], [task], [attempt], [runtime]] =
    await Promise.all([
      db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.id, fixture.receiptId)),
      db
        .select()
        .from(operationInvocationsTable)
        .where(eq(operationInvocationsTable.id, fixture.invocationId)),
      db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
      db
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, fixture.attemptId)),
      db
        .select()
        .from(runtimeInstancesTable)
        .where(eq(runtimeInstancesTable.id, fixture.runtimeId)),
    ]);
  assert.equal(receipt.state, "unknown");
  assert.equal(invocation.state, "unknown");
  assert.equal(task.status, "blocked");
  assert.equal(task.blockedReason, "operation_outcome_unknown");
  assert.equal(task.nextAttemptAt, null);
  assert.equal(task.recoveryCount, 0);
  assert.equal(attempt.state, "blocked");
  assert.equal(attempt.failureKind, "operation_outcome_unknown");
  assert.equal(runtime.state, "healthy");
});

test("scheduler preserves an expired invocation while its direct task ownership remains live", async () => {
  const fixture = await createTaskOperationFixture("at_most_once");
  await markOperationRunning({
    receiptId: fixture.receiptId,
    invocationId: fixture.invocationId,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1),
  });
  await db
    .update(operationInvocationsTable)
    .set({ leaseExpiresAt: new Date(fixture.now.getTime() - 1) })
    .where(eq(operationInvocationsTable.id, fixture.invocationId));

  await reviveAndReleaseStaleWorkCore(60_000);

  const [[receipt], [invocation], [task], [attempt]] = await Promise.all([
    db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, fixture.receiptId)),
    db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.id, fixture.invocationId)),
    db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, fixture.attemptId)),
  ]);
  assert.equal(receipt.state, "running");
  assert.equal(invocation.state, "running");
  assert.equal(task.status, "in_progress");
  assert.equal(task.leaseOwner !== null, true);
  assert.equal(task.nextAttemptAt, null);
  assert.equal(task.recoveryCount, 0);
  assert.equal(attempt.state, "running");
});

test("scheduler safely requeues pre-effect and replayable crashed task operations", async () => {
  const cases = [
    { sideEffectClass: "at_most_once" as const, running: false },
    { sideEffectClass: "read_only" as const, running: true },
    { sideEffectClass: "idempotent" as const, running: true },
  ];
  for (const item of cases) {
    const fixture = await createTaskOperationFixture(item.sideEffectClass);
    if (item.running) {
      await markOperationRunning({
        receiptId: fixture.receiptId,
        invocationId: fixture.invocationId,
        leaseOwner: fixture.invocationLeaseOwner,
        now: new Date(fixture.now.getTime() + 1),
      });
    }
    await expireTaskOperation(fixture);

    await reviveAndReleaseStaleWorkCore(60_000);

    const [[receipt], [invocation], [task], [attempt]] = await Promise.all([
      db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.id, fixture.receiptId)),
      db
        .select()
        .from(operationInvocationsTable)
        .where(eq(operationInvocationsTable.id, fixture.invocationId)),
      db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
      db
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, fixture.attemptId)),
    ]);
    assert.equal(receipt.state, "reserved", item.sideEffectClass);
    assert.equal(invocation.state, "failed", item.sideEffectClass);
    assert.equal(task.status, "in_progress", item.sideEffectClass);
    assert.equal(task.leaseOwner, null, item.sideEffectClass);
    assert.ok(task.nextAttemptAt, item.sideEffectClass);
    assert.equal(task.recoveryCount, 1, item.sideEffectClass);
    assert.equal(attempt.state, "lost", item.sideEffectClass);
  }
});

test("scheduler fences legacy released screenshots without waiting for another claim", async () => {
  const fixture = await createTaskOperationFixture(
    "idempotent",
    "browser_save_screenshot",
  );
  await markOperationRunning({
    receiptId: fixture.receiptId,
    invocationId: fixture.invocationId,
    leaseOwner: fixture.invocationLeaseOwner,
  });
  // Persist the release left by the old policy after an actual effect boundary.
  await db
    .update(operationInvocationsTable)
    .set({
      state: "failed",
      finishedAt: new Date(),
      failureKind: "idempotent_effect_failed",
    })
    .where(eq(operationInvocationsTable.id, fixture.invocationId));
  await db
    .update(operationReceiptsTable)
    .set({ state: "reserved", startedAt: null, finishedAt: null })
    .where(eq(operationReceiptsTable.id, fixture.receiptId));
  await reviveAndReleaseStaleWorkCore(60_000);
  await reviveAndReleaseStaleWorkCore(60_000);
  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, fixture.receiptId));
  const invocations = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.receiptId, fixture.receiptId));
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  const [attempt] = await db
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.id, fixture.attemptId));
  assert.equal(receipt.state, "unknown");
  assert.equal(
    receipt.sideEffectClass,
    "idempotent",
    "historical identity is retained",
  );
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].state, "unknown");
  assert.equal(task.status, "blocked");
  assert.equal(task.blockedReason, "operation_outcome_unknown");
  assert.equal(task.nextAttemptAt, null);
  assert.equal(task.recoveryCount, 0);
  assert.equal(attempt.state, "blocked");
});

test("scheduler terminates a crashed running chat operation as unknown", async () => {
  await dbReady;
  const suffix = randomUUID();
  const leaseOwner = `chat:${suffix}`;
  const now = new Date();
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Scheduler chat agent ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(now.getTime() + 60_000),
    })
    .returning();
  const [sourceMessage] = await db
    .insert(messagesTable)
    .values({
      agentId: agent.id,
      role: "user",
      content: "Run one durable chat effect.",
      taskId: null,
    })
    .returning();
  const reservation = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "chat_turn",
    logicalExecutionId: `chat:${sourceMessage.id}`,
    toolName: "vm_run_command",
    args: { fixture: suffix },
    physical: {
      attemptId: null,
      workerInstanceId: null,
      modelToolCallId: `call:${suffix}`,
      callSlot: "round:0:tool:0",
    },
    taskId: null,
    agentId: agent.id,
    approvalId: null,
    sourceMessageId: sourceMessage.id,
    originAttemptId: null,
    sideEffectClass: "at_most_once",
    now,
  });
  const invocationLeaseOwner = `operation:${suffix}`;
  const claim = await claimOperationInvocation({
    receiptId: reservation.receipt.id,
    executionKind: "chat_turn",
    attemptId: null,
    workerInstanceId: null,
    modelToolCallId: `call:${suffix}`,
    leaseOwner: invocationLeaseOwner,
    leaseExpiresAt: new Date(now.getTime() + 30_000),
    taskLeaseOwner: null,
    agentLeaseOwner: leaseOwner,
    now,
  });
  assert.equal(claim.claimed, true);
  assert.ok(claim.invocation);
  await markOperationRunning({
    receiptId: reservation.receipt.id,
    invocationId: claim.invocation.id,
    leaseOwner: invocationLeaseOwner,
    now: new Date(now.getTime() + 1),
  });
  const expiredAt = new Date(now.getTime() - 1);
  await db
    .update(agentsTable)
    .set({ runLeaseExpiresAt: expiredAt })
    .where(eq(agentsTable.id, agent.id));
  await db
    .update(operationInvocationsTable)
    .set({ leaseExpiresAt: expiredAt })
    .where(eq(operationInvocationsTable.id, claim.invocation.id));

  await reviveAndReleaseStaleWorkCore(60_000);

  const [[receipt], [invocation], [persistedAgent]] = await Promise.all([
    db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, reservation.receipt.id)),
    db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.id, claim.invocation.id)),
    db.select().from(agentsTable).where(eq(agentsTable.id, agent.id)),
  ]);
  assert.equal(receipt.state, "unknown");
  assert.equal(invocation.state, "unknown");
  assert.equal(persistedAgent.runLeaseOwner, null);
  assert.equal(persistedAgent.status, "idle");
});
