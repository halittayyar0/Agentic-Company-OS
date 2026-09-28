import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { WORKSPACE_LOCALES, type WorkspaceLocale } from "../workspace-locale";
import { toolMessage } from "./tool-localization";
import { and, eq } from "drizzle-orm";
import {
  agentsTable,
  approvalRequestsTable,
  activityEventsTable,
  db,
  dbReady,
  operationInvocationsTable,
  operationReceiptsTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import {
  type ReserveOperationInput,
  claimOperationInvocation,
  completeOperation,
  heartbeatOperationInvocation,
  invalidateApprovalBinding,
  markOperationRunning,
  markOperationUnknown,
  markRuntimeOperationsUnknownAfterDrainTimeout,
  OperationInvocationStateError,
  OperationReconciliationConflictError,
  recoverInterruptedOperation,
  releaseOperationForSafeRetry,
  reconcileOperation,
  reserveOperation,
  runTransactionalOperation,
} from "./operation-receipts";

async function createTaskExecutionFixture(
  sideEffectClass:
    | "read_only"
    | "transactional"
    | "idempotent"
    | "at_most_once"
    | "approval_at_most_once",
  presentation: { toolName?: string; executionLocale?: WorkspaceLocale } = {},
) {
  await dbReady;
  const suffix = randomUUID();
  const leaseOwner = `task-lease-${suffix}`;
  const now = new Date();
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Crash owner ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(now.getTime() + 90_000),
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Crash receipt ${suffix}`,
      brief: "Prove the effect boundary survives worker loss.",
      ownerAgentId: agent.id,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + 90_000),
      stepAttempts: 1,
      createdByUser: true,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  const runtimeId = `runtime-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "receipt-crash-test",
    processId: 1801,
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

  const reservation = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId,
    toolName:
      presentation.toolName ??
      (sideEffectClass === "idempotent"
        ? "vm_write_file"
        : sideEffectClass === "transactional"
          ? "log_note"
          : "vm_run_command"),
    executionLocale: presentation.executionLocale,
    args: { targetHash: `target-${suffix}` },
    physical: {
      attemptId,
      workerInstanceId: runtimeId,
      modelToolCallId: `call-${suffix}`,
      callSlot: "provider:0:tool:0",
    },
    taskId: task.id,
    agentId: agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: attemptId,
    sideEffectClass,
    externalIdempotencyKey:
      sideEffectClass === "read_only" ? null : `external-${suffix}`,
    now,
  });
  assert.equal(reservation.execute, true);

  const invocationLeaseOwner = `invocation-${suffix}`;
  const claim = await claimOperationInvocation({
    receiptId: reservation.receipt.id,
    executionKind: "task_step",
    attemptId,
    workerInstanceId: runtimeId,
    modelToolCallId: `call-${suffix}`,
    leaseOwner: invocationLeaseOwner,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    taskLeaseOwner: leaseOwner,
    agentLeaseOwner: leaseOwner,
    now,
  });
  assert.equal(claim.claimed, true);
  assert.ok(claim.invocation);

  return {
    suffix,
    now,
    agent,
    task,
    runtimeId,
    attemptId,
    logicalExecutionId,
    leaseOwner,
    invocationLeaseOwner,
    receipt: reservation.receipt,
    invocation: claim.invocation!,
  };
}

async function expireExecution(
  fixture: Awaited<ReturnType<typeof createTaskExecutionFixture>>,
) {
  const expiredAt = new Date(fixture.now.getTime() + 120_000);
  const staleHeartbeat = new Date(fixture.now.getTime() - 120_000);
  await db
    .update(runtimeInstancesTable)
    .set({ state: "stale", lastHeartbeatAt: staleHeartbeat })
    .where(eq(runtimeInstancesTable.id, fixture.runtimeId));
  await db
    .update(agentsTable)
    .set({ runLeaseExpiresAt: new Date(fixture.now.getTime() - 1) })
    .where(eq(agentsTable.id, fixture.agent.id));
  await db
    .update(tasksTable)
    .set({ leaseExpiresAt: new Date(fixture.now.getTime() - 1) })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(operationInvocationsTable)
    .set({ leaseExpiresAt: new Date(fixture.now.getTime() - 1) })
    .where(eq(operationInvocationsTable.id, fixture.invocation.id));
  return { expiredAt, staleHeartbeat };
}

test("receipt lifecycle emits only typed operations_changed invalidations", async () => {
  const fixture = await createTaskExecutionFixture("idempotent");
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  await completeOperation({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    resultData: { pathHash: `sha256:${"e".repeat(64)}`, byteCount: 1 },
    now: new Date(fixture.now.getTime() + 2_000),
  });

  const events = await db
    .select({ detail: activityEventsTable.detail })
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.type, "operations_changed"),
        eq(activityEventsTable.taskId, fixture.task.id),
      ),
    );
  assert.deepEqual(
    events.map((event) => event.detail),
    [
      {
        schemaVersion: 1,
        kind: "receipt_reserved",
        attemptId: fixture.attemptId,
        receiptId: fixture.receipt.id,
        state: "reserved",
      },
      {
        schemaVersion: 1,
        kind: "invocation_created",
        attemptId: fixture.attemptId,
        receiptId: fixture.receipt.id,
        invocationId: fixture.invocation.id,
        state: "claimed",
      },
      {
        schemaVersion: 1,
        kind: "invocation_state_changed",
        attemptId: fixture.attemptId,
        receiptId: fixture.receipt.id,
        invocationId: fixture.invocation.id,
        state: "running",
      },
      {
        schemaVersion: 1,
        kind: "receipt_state_changed",
        attemptId: fixture.attemptId,
        receiptId: fixture.receipt.id,
        state: "running",
      },
      {
        schemaVersion: 1,
        kind: "invocation_state_changed",
        attemptId: fixture.attemptId,
        receiptId: fixture.receipt.id,
        invocationId: fixture.invocation.id,
        state: "succeeded",
      },
      {
        schemaVersion: 1,
        kind: "receipt_state_changed",
        attemptId: fixture.attemptId,
        receiptId: fixture.receipt.id,
        state: "succeeded",
      },
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(events),
    /lease|result|argument|external/iu,
  );
});

test("unknown and reconciliation transitions emit durable typed invalidations", async () => {
  const fixture = await createTaskExecutionFixture("at_most_once");
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  await markOperationUnknown({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    failureKind: "effect_outcome_unknown",
    sanitizedError: "Outcome could not be observed.",
    now: new Date(fixture.now.getTime() + 2_000),
  });
  await reconcileOperation({
    receiptId: fixture.receipt.id,
    decision: "confirmed_not_applied",
    note: "Verified against the authoritative target.",
    actorId: "operations-test",
    now: new Date(fixture.now.getTime() + 3_000),
  });

  const events = await db
    .select({ detail: activityEventsTable.detail })
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.type, "operations_changed"),
        eq(activityEventsTable.taskId, fixture.task.id),
      ),
    );
  assert.deepEqual(
    events.slice(-3).map((event) => event.detail),
    [
      {
        schemaVersion: 1,
        kind: "invocation_state_changed",
        attemptId: fixture.attemptId,
        receiptId: fixture.receipt.id,
        invocationId: fixture.invocation.id,
        state: "unknown",
      },
      {
        schemaVersion: 1,
        kind: "receipt_state_changed",
        attemptId: fixture.attemptId,
        receiptId: fixture.receipt.id,
        state: "unknown",
      },
      {
        schemaVersion: 1,
        kind: "reconciliation_recorded",
        attemptId: fixture.attemptId,
        receiptId: fixture.receipt.id,
        invocationId: fixture.invocation.id,
        state: "unknown",
      },
    ],
  );
});

test("a crash before the effect boundary is reclaimable", async () => {
  const fixture = await createTaskExecutionFixture("at_most_once");
  const { expiredAt, staleHeartbeat } = await expireExecution(fixture);

  const recovery = await recoverInterruptedOperation({
    receiptId: fixture.receipt.id,
    now: expiredAt,
    runtimeStaleBefore: new Date(staleHeartbeat.getTime() + 1),
  });
  assert.equal(recovery.disposition, "reclaimable");

  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, fixture.receipt.id));
  const [invocation] = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.id, fixture.invocation.id));
  assert.equal(receipt.state, "reserved");
  assert.equal(invocation.state, "failed");
  assert.equal(invocation.failureKind, "pre_effect_owner_lost");
  const recoveryEvents = await db
    .select({ detail: activityEventsTable.detail })
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.type, "operations_changed"),
        eq(activityEventsTable.taskId, fixture.task.id),
      ),
    );
  assert.deepEqual(
    recoveryEvents.slice(-3).map((event) => event.detail),
    [
      {
        schemaVersion: 1,
        kind: "invocation_state_changed",
        attemptId: fixture.attemptId,
        receiptId: fixture.receipt.id,
        invocationId: fixture.invocation.id,
        state: "failed",
      },
      {
        schemaVersion: 1,
        kind: "receipt_state_changed",
        attemptId: fixture.attemptId,
        receiptId: fixture.receipt.id,
        state: "reserved",
      },
      {
        schemaVersion: 1,
        kind: "recovery_recorded",
        attemptId: fixture.attemptId,
        receiptId: fixture.receipt.id,
        invocationId: fixture.invocation.id,
        state: "reserved",
      },
    ],
  );
});

test("an invocation heartbeat renews the same owner and ignores a terminal completion race", async () => {
  const fixture = await createTaskExecutionFixture("idempotent");
  const renewedUntil = new Date(fixture.now.getTime() + 180_000);
  const renewed = await heartbeatOperationInvocation({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    leaseExpiresAt: renewedUntil,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  assert.equal(renewed.renewed, true);
  assert.equal(
    renewed.invocation.leaseExpiresAt.getTime(),
    renewedUntil.getTime(),
  );

  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 2_000),
  });
  await completeOperation({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    resultData: {
      pathHash: `sha256:${"e".repeat(64)}`,
      byteCount: 1,
    },
    now: new Date(fixture.now.getTime() + 3_000),
  });
  const terminalRace = await heartbeatOperationInvocation({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    leaseExpiresAt: new Date(fixture.now.getTime() + 240_000),
    now: new Date(fixture.now.getTime() + 4_000),
  });
  assert.equal(terminalRace.renewed, false);
  assert.equal(terminalRace.invocation.state, "succeeded");
});

test("SIGTERM after the effect boundary keeps the exact draining owner alive for heartbeat and completion", async () => {
  const fixture = await createTaskExecutionFixture("at_most_once");
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  const [runtime] = await db
    .update(runtimeInstancesTable)
    .set({ state: "draining", drainingAt: new Date() })
    .where(eq(runtimeInstancesTable.id, fixture.runtimeId))
    .returning({ startedAt: runtimeInstancesTable.startedAt });
  assert.ok(runtime);

  const heartbeat = await heartbeatOperationInvocation({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    leaseExpiresAt: new Date(fixture.now.getTime() + 180_000),
    now: new Date(fixture.now.getTime() + 2_000),
  });
  assert.equal(heartbeat.renewed, true);
  const completed = await completeOperation({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    resultData: { ok: true, exitCode: 0, durationMs: 1 },
    now: new Date(fixture.now.getTime() + 3_000),
  });
  assert.equal(completed.state, "succeeded");

  const preEffect = await createTaskExecutionFixture("at_most_once");
  await db
    .update(runtimeInstancesTable)
    .set({ state: "draining", drainingAt: new Date() })
    .where(eq(runtimeInstancesTable.id, preEffect.runtimeId));
  await assert.rejects(
    markOperationRunning({
      receiptId: preEffect.receipt.id,
      invocationId: preEffect.invocation.id,
      leaseOwner: preEffect.invocationLeaseOwner,
      now: new Date(preEffect.now.getTime() + 1_000),
    }),
    /not healthy at the effect boundary/iu,
  );
});

test("a drain deadline fences the exact runtime's still-running effect as unknown", async () => {
  const fixture = await createTaskExecutionFixture("at_most_once");
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  const [runtime] = await db
    .update(runtimeInstancesTable)
    .set({ state: "draining", drainingAt: new Date() })
    .where(eq(runtimeInstancesTable.id, fixture.runtimeId))
    .returning({ startedAt: runtimeInstancesTable.startedAt });
  assert.ok(runtime);

  assert.equal(
    await markRuntimeOperationsUnknownAfterDrainTimeout({
      id: fixture.runtimeId,
      startedAt: runtime.startedAt,
    }),
    1,
  );
  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, fixture.receipt.id));
  const [invocation] = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.id, fixture.invocation.id));
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  assert.equal(receipt?.state, "unknown");
  assert.equal(receipt?.failureKind, "shutdown_drain_timeout");
  assert.equal(invocation?.state, "unknown");
  assert.equal(task?.status, "blocked");
  assert.equal(task?.blockedReason, "operation_outcome_unknown");
});

test("transactional operation commits domain evidence with receipt success and rolls back together", async () => {
  const fixture = await createTaskExecutionFixture("transactional");
  const reservation = {
    canonicalVersion: 1 as const,
    executionKind: "task_step" as const,
    logicalExecutionId: fixture.logicalExecutionId,
    toolName: "log_note",
    args: { noteHash: `sha256:${"7".repeat(64)}` },
    physical: {
      attemptId: fixture.attemptId,
      workerInstanceId: fixture.runtimeId,
      modelToolCallId: "transactional-success-call",
      callSlot: "round:0:tool:1",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: fixture.attemptId,
    sideEffectClass: "transactional" as const,
  };
  const claim = {
    executionKind: "task_step" as const,
    attemptId: fixture.attemptId,
    workerInstanceId: fixture.runtimeId,
    modelToolCallId: "transactional-success-call",
    leaseOwner: `transactional-success-${fixture.suffix}`,
    leaseExpiresAt: new Date(fixture.now.getTime() + 60_000),
    taskLeaseOwner: fixture.leaseOwner,
    agentLeaseOwner: fixture.leaseOwner,
    now: fixture.now,
  };
  const succeeded = await runTransactionalOperation({
    reservation,
    claim,
    mutate: async (tx) => {
      const [event] = await tx
        .insert(activityEventsTable)
        .values({
          agentId: fixture.agent.id,
          taskId: fixture.task.id,
          type: "note",
          summary: "Transactional test evidence",
          detail: { testOnly: true },
          severity: "info",
        })
        .returning({ id: activityEventsTable.id });
      return { value: event.id, resultData: { eventId: event.id } };
    },
  });
  assert.equal(succeeded.disposition, "executed");
  assert.equal(succeeded.receipt.state, "succeeded");

  const failedReservation = {
    ...reservation,
    args: { noteHash: `sha256:${"8".repeat(64)}` },
    physical: {
      ...reservation.physical,
      modelToolCallId: "transactional-rollback-call",
      callSlot: "round:0:tool:2",
    },
  };
  await assert.rejects(
    runTransactionalOperation({
      reservation: failedReservation,
      claim: {
        ...claim,
        modelToolCallId: "transactional-rollback-call",
        leaseOwner: `transactional-rollback-${fixture.suffix}`,
      },
      mutate: async (tx) => {
        await tx.insert(activityEventsTable).values({
          agentId: fixture.agent.id,
          taskId: fixture.task.id,
          type: "note",
          summary: "Must roll back",
          detail: { rollback: true },
          severity: "info",
        });
        throw new Error("rollback transaction");
      },
    }),
    /rollback transaction/u,
  );
  const observed = await reserveOperation(failedReservation);
  assert.equal(observed.receipt.state, "reserved");
  const [activeInvocation] = await db
    .select()
    .from(operationInvocationsTable)
    .where(
      and(
        eq(operationInvocationsTable.receiptId, observed.receipt.id),
        eq(operationInvocationsTable.state, "claimed"),
      ),
    );
  assert.equal(activeInvocation, undefined);
  const [failedInvocation] = await db
    .select()
    .from(operationInvocationsTable)
    .where(
      and(
        eq(operationInvocationsTable.receiptId, observed.receipt.id),
        eq(operationInvocationsTable.state, "failed"),
      ),
    );
  assert.equal(failedInvocation?.failureKind, "transactional_mutation_failed");
  const reclaimed = await claimOperationInvocation({
    ...claim,
    receiptId: observed.receipt.id,
    modelToolCallId: "transactional-reclaim-call",
    leaseOwner: `transactional-reclaim-${fixture.suffix}`,
    now: new Date(),
  });
  assert.equal(reclaimed.claimed, true);
  const rolledBackEvents = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.summary, "Must roll back"));
  assert.equal(rolledBackEvents.length, 0);
});

test("a transactional callback-boundary failure retires its healthy-runtime claim", async () => {
  const fixture = await createTaskExecutionFixture("transactional");
  const reservation = {
    canonicalVersion: 1 as const,
    executionKind: "task_step" as const,
    logicalExecutionId: fixture.logicalExecutionId,
    toolName: "log_note",
    args: { noteHash: `sha256:${"9".repeat(64)}` },
    physical: {
      attemptId: fixture.attemptId,
      workerInstanceId: fixture.runtimeId,
      modelToolCallId: "transactional-boundary-failure-call",
      callSlot: "round:0:tool:3",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: fixture.attemptId,
    sideEffectClass: "transactional" as const,
  };
  await assert.rejects(
    runTransactionalOperation({
      reservation,
      claim: {
        executionKind: "task_step",
        attemptId: fixture.attemptId,
        workerInstanceId: fixture.runtimeId,
        modelToolCallId: "transactional-boundary-failure-call",
        leaseOwner: `transactional-boundary-${fixture.suffix}`,
        leaseExpiresAt: new Date(fixture.now.getTime() + 60_000),
        taskLeaseOwner: fixture.leaseOwner,
        agentLeaseOwner: fixture.leaseOwner,
        now: fixture.now,
      },
      mutate: async (tx) => {
        await tx
          .update(tasksTable)
          .set({ leaseExpiresAt: new Date(fixture.now.getTime() - 1) })
          .where(eq(tasksTable.id, fixture.task.id));
        return { value: null, resultData: { eventId: 1 } };
      },
    }),
    OperationInvocationStateError,
  );
  const observed = await reserveOperation(reservation);
  assert.equal(observed.receipt.state, "reserved");
  const invocations = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.receiptId, observed.receipt.id));
  assert.equal(
    invocations.some((invocation) => invocation.state === "claimed"),
    false,
  );
  assert.equal(
    invocations.some(
      (invocation) =>
        invocation.state === "failed" &&
        invocation.failureKind === "transactional_mutation_failed",
    ),
    true,
  );
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  assert.ok(task.leaseExpiresAt);
  assert.ok(task.leaseExpiresAt.getTime() > fixture.now.getTime());
});

test("a crash after an at-most-once effect becomes unknown and never replays", async () => {
  const fixture = await createTaskExecutionFixture("at_most_once");
  let irreversibleEffects = 0;
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  irreversibleEffects += 1;
  const { expiredAt, staleHeartbeat } = await expireExecution(fixture);

  const recovery = await recoverInterruptedOperation({
    receiptId: fixture.receipt.id,
    now: expiredAt,
    runtimeStaleBefore: new Date(staleHeartbeat.getTime() + 1),
  });
  assert.equal(recovery.disposition, "unknown");
  assert.equal(recovery.receipt.id, fixture.receipt.id);

  const replacementAttemptId = randomUUID();
  const replacementRuntimeId = `replacement-${fixture.runtimeId}`;
  await db.insert(runtimeInstancesTable).values({
    id: replacementRuntimeId,
    role: "worker",
    state: "healthy",
    hostname: "operation-replay-test",
    processId: 1903,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: new Date(),
  });
  await db.insert(taskAttemptsTable).values({
    id: replacementAttemptId,
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    workerInstanceId: replacementRuntimeId,
    leaseOwner: `replacement-${fixture.leaseOwner}`,
    attemptNumber: 2,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId: fixture.logicalExecutionId,
  });
  const replay = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId: fixture.logicalExecutionId,
    toolName: "vm_run_command",
    args: { targetHash: `target-${fixture.suffix}` },
    physical: {
      attemptId: replacementAttemptId,
      workerInstanceId: replacementRuntimeId,
      modelToolCallId: "replacement-call",
      callSlot: "provider:1:tool:0",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: replacementAttemptId,
    sideEffectClass: "at_most_once",
    externalIdempotencyKey: `external-${fixture.suffix}`,
  });
  if (replay.execute) irreversibleEffects += 1;
  assert.equal(replay.execute, false);
  assert.equal(replay.receipt.state, "unknown");
  assert.equal(irreversibleEffects, 1);
});

test("a finalization outage converges a crossed at-most-once effect even after its worker recovers", async () => {
  const fixture = await createTaskExecutionFixture("at_most_once");
  let irreversibleEffects = 0;
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  irreversibleEffects += 1;

  const databaseUnavailable = {
    select() {
      throw new Error("synthetic database unavailable during finalization");
    },
  } as unknown as typeof db;
  await assert.rejects(
    completeOperation(
      {
        receiptId: fixture.receipt.id,
        invocationId: fixture.invocation.id,
        leaseOwner: fixture.invocationLeaseOwner,
        resultData: { ok: true, exitCode: 0, durationMs: 1 },
        now: new Date(fixture.now.getTime() + 2_000),
      },
      databaseUnavailable,
    ),
    /database unavailable during finalization/iu,
  );

  const recoveredAt = new Date(fixture.now.getTime() + 120_000);
  const expiredAt = new Date(fixture.now.getTime() - 1);
  await db
    .update(operationInvocationsTable)
    .set({ leaseExpiresAt: expiredAt })
    .where(eq(operationInvocationsTable.id, fixture.invocation.id));
  await db
    .update(agentsTable)
    .set({ runLeaseExpiresAt: expiredAt })
    .where(eq(agentsTable.id, fixture.agent.id));
  await db
    .update(tasksTable)
    .set({ leaseExpiresAt: expiredAt })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(runtimeInstancesTable)
    .set({ state: "healthy", lastHeartbeatAt: recoveredAt })
    .where(eq(runtimeInstancesTable.id, fixture.runtimeId));

  const recovery = await recoverInterruptedOperation({
    receiptId: fixture.receipt.id,
    now: recoveredAt,
    runtimeStaleBefore: new Date(recoveredAt.getTime() - 60_000),
  });
  assert.equal(recovery.disposition, "unknown");
  assert.equal(recovery.receipt.state, "unknown");

  const replay = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId: fixture.logicalExecutionId,
    toolName: "vm_run_command",
    args: { targetHash: `target-${fixture.suffix}` },
    physical: {
      attemptId: fixture.attemptId,
      workerInstanceId: fixture.runtimeId,
      modelToolCallId: `call-${fixture.suffix}`,
      callSlot: "provider:0:tool:0",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: fixture.attemptId,
    sideEffectClass: "at_most_once",
    externalIdempotencyKey: `external-${fixture.suffix}`,
    now: new Date(recoveredAt.getTime() + 1),
  });
  if (replay.execute) irreversibleEffects += 1;
  assert.equal(replay.execute, false);
  assert.equal(replay.receipt.state, "unknown");
  assert.equal(irreversibleEffects, 1);
});

test("a stale running transactional receipt fails closed as unknown", async () => {
  const fixture = await createTaskExecutionFixture("transactional");
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  const { expiredAt, staleHeartbeat } = await expireExecution(fixture);
  const recovery = await recoverInterruptedOperation({
    receiptId: fixture.receipt.id,
    now: expiredAt,
    runtimeStaleBefore: new Date(staleHeartbeat.getTime() + 1),
  });
  assert.equal(recovery.disposition, "unknown");
  assert.equal(recovery.receipt.state, "unknown");
  const [blockedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  assert.equal(blockedTask.blockedReason, "operation_outcome_unknown");
});

test("unknown recovery fences a newer owner in the same logical execution", async () => {
  const fixture = await createTaskExecutionFixture("at_most_once");
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  const { expiredAt, staleHeartbeat } = await expireExecution(fixture);

  const replacementRuntimeId = `replacement-${fixture.runtimeId}`;
  const replacementLeaseOwner = `replacement-lease-${fixture.suffix}`;
  const replacementAttemptId = randomUUID();
  await db.insert(runtimeInstancesTable).values({
    id: replacementRuntimeId,
    role: "worker",
    state: "healthy",
    hostname: "replacement-receipt-test",
    processId: 1802,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: expiredAt,
  });
  await db
    .update(agentsTable)
    .set({
      currentTaskId: fixture.task.id,
      status: "working",
      runLeaseOwner: replacementLeaseOwner,
      runLeaseExpiresAt: new Date(expiredAt.getTime() + 90_000),
    })
    .where(eq(agentsTable.id, fixture.agent.id));
  await db
    .update(tasksTable)
    .set({
      status: "in_progress",
      leaseOwner: replacementLeaseOwner,
      leaseExpiresAt: new Date(expiredAt.getTime() + 90_000),
    })
    .where(eq(tasksTable.id, fixture.task.id));
  await db.insert(taskAttemptsTable).values({
    id: replacementAttemptId,
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    workerInstanceId: replacementRuntimeId,
    leaseOwner: replacementLeaseOwner,
    attemptNumber: 2,
    cycleNumber: 0,
    state: "running",
    recoveryOfAttemptId: fixture.attemptId,
    logicalExecutionId: fixture.logicalExecutionId,
  });

  const recovery = await recoverInterruptedOperation({
    receiptId: fixture.receipt.id,
    now: expiredAt,
    runtimeStaleBefore: new Date(staleHeartbeat.getTime() + 1),
  });
  assert.equal(recovery.disposition, "unknown");

  const [[blockedTask], [replacementAttempt], [replacementAgent]] =
    await Promise.all([
      db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
      db
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, replacementAttemptId)),
      db.select().from(agentsTable).where(eq(agentsTable.id, fixture.agent.id)),
    ]);
  assert.equal(blockedTask.status, "blocked");
  assert.equal(blockedTask.blockedReason, "operation_outcome_unknown");
  assert.equal(blockedTask.leaseOwner, null);
  assert.equal(replacementAttempt.state, "blocked");
  assert.equal(replacementAgent.runLeaseOwner, null);
});

test("a stale idempotent invocation reopens the same logical receipt and key", async () => {
  const fixture = await createTaskExecutionFixture("idempotent");
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  const { expiredAt, staleHeartbeat } = await expireExecution(fixture);

  const recovery = await recoverInterruptedOperation({
    receiptId: fixture.receipt.id,
    now: expiredAt,
    runtimeStaleBefore: new Date(staleHeartbeat.getTime() + 1),
  });
  assert.equal(recovery.disposition, "reclaimable_same_key");
  assert.equal(recovery.receipt.state, "reserved");
  assert.equal(
    recovery.receipt.externalIdempotencyKey,
    fixture.receipt.externalIdempotencyKey,
  );
});

test("a succeeded receipt replays only its bounded safe envelope", async () => {
  const fixture = await createTaskExecutionFixture("idempotent");
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  const completed = await completeOperation({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    resultData: {
      pathHash: `sha256:${"a".repeat(64)}`,
      byteCount: 42,
    },
    now: new Date(fixture.now.getTime() + 2_000),
  });
  assert.equal(completed.state, "succeeded");
  assert.deepEqual(completed.resultData, {
    pathHash: `sha256:${"a".repeat(64)}`,
    byteCount: 42,
  });

  const [active] = await db
    .select()
    .from(operationInvocationsTable)
    .where(
      and(
        eq(operationInvocationsTable.receiptId, fixture.receipt.id),
        eq(operationInvocationsTable.state, "running"),
      ),
    );
  assert.equal(active, undefined);
});

test("Terminal result locale is an optional bounded enum and cannot smuggle arbitrary evidence", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const fixture = await createTaskExecutionFixture("at_most_once");
    const owner = {
      receiptId: fixture.receipt.id,
      invocationId: fixture.invocation.id,
      leaseOwner: fixture.invocationLeaseOwner,
    };
    await markOperationRunning(owner);
    for (const executionLocale of [
      "constructor",
      "en-US",
      "en secret",
      { locale: "en" },
      null,
    ]) {
      await assert.rejects(
        completeOperation({
          ...owner,
          resultData: { ok: true, executionLocale },
        }),
        /Unsafe or non-allowlisted/,
      );
    }
    await assert.rejects(
      completeOperation({
        ...owner,
        resultData: { ok: true, executionLocale: locale, rawOutput: "source" },
      }),
      /Unsafe or non-allowlisted/,
    );
    const receipt = await completeOperation({
      ...owner,
      resultData: { ok: true, executionLocale: locale },
    });
    assert.deepEqual(receipt.resultData, { ok: true, executionLocale: locale });
    assert.equal(receipt.argumentHash, fixture.receipt.argumentHash);
  }
  const other = await createTaskExecutionFixture("at_most_once", {
    toolName: "synthetic_fixture_write",
  });
  const owner = {
    receiptId: other.receipt.id,
    invocationId: other.invocation.id,
    leaseOwner: other.invocationLeaseOwner,
  };
  await markOperationRunning(owner);
  await assert.rejects(
    completeOperation({ ...owner, resultData: { executionLocale: "en" } }),
    /Unsafe or non-allowlisted/,
  );
});

test("saved result envelopes reject free-form values even under innocent keys", async () => {
  const fixture = await createTaskExecutionFixture("idempotent");
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  await assert.rejects(
    completeOperation({
      receiptId: fixture.receipt.id,
      invocationId: fixture.invocation.id,
      leaseOwner: fixture.invocationLeaseOwner,
      resultData: { value: "raw page text and secret material" },
      now: new Date(fixture.now.getTime() + 2_000),
    }),
    /safe|allow|field|result/iu,
  );
});

test("multibyte failures still commit a bounded unknown state and block the task atomically", async () => {
  const fixture = await createTaskExecutionFixture("at_most_once");
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  const unknown = await markOperationUnknown({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    failureKind: `çokbaytlı-${"ğ".repeat(500)}`,
    sanitizedError: `belirsiz-${"🙂".repeat(5_000)}`,
    now: new Date(fixture.now.getTime() + 2_000),
  });
  assert.equal(unknown.state, "unknown");
  assert.ok(Buffer.byteLength(unknown.failureKind ?? "", "utf8") <= 256);
  assert.ok(Buffer.byteLength(unknown.sanitizedError ?? "", "utf8") <= 4_096);

  const [[blockedTask], [blockedAttempt]] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, fixture.attemptId)),
  ]);
  assert.equal(blockedTask.status, "blocked");
  assert.equal(blockedTask.blockedReason, "operation_outcome_unknown");
  assert.equal(blockedAttempt.state, "blocked");

  const reconciled = await reconcileOperation({
    receiptId: fixture.receipt.id,
    decision: "confirmed_applied",
    note: "Operator verified the external effect in the authoritative system.",
    actorId: "operator-test",
    now: new Date(fixture.now.getTime() + 3_000),
  });
  assert.equal(reconciled.reconciliationDecision, "confirmed_applied");
  assert.equal(reconciled.reconciliationActorId, "operator-test");
  const repeated = await reconcileOperation({
    receiptId: fixture.receipt.id,
    decision: "confirmed_applied",
    note: "Operator verified the external effect in the authoritative system.",
    actorId: "operator-test",
    now: new Date(fixture.now.getTime() + 4_000),
  });
  assert.equal(
    repeated.reconciledAt?.getTime(),
    reconciled.reconciledAt?.getTime(),
  );
  await assert.rejects(
    reconcileOperation({
      receiptId: fixture.receipt.id,
      decision: "confirmed_not_applied",
      note: "Contradictory decision must not overwrite immutable evidence.",
      actorId: "operator-test",
      now: new Date(fixture.now.getTime() + 5_000),
    }),
    OperationReconciliationConflictError,
  );
  const [resumedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  assert.equal(resumedTask.status, "in_progress");
  assert.equal(resumedTask.blockedReason, null);
});

test("a task resumes only after every unknown operation is reconciled", async () => {
  const fixture = await createTaskExecutionFixture("at_most_once");
  const secondReservation = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId: fixture.logicalExecutionId,
    toolName: "vm_run_command",
    args: { targetHash: `second-${fixture.suffix}` },
    physical: {
      attemptId: fixture.attemptId,
      workerInstanceId: fixture.runtimeId,
      modelToolCallId: `second-call-${fixture.suffix}`,
      callSlot: "provider:0:tool:1",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: fixture.attemptId,
    sideEffectClass: "at_most_once",
    externalIdempotencyKey: `second-external-${fixture.suffix}`,
    now: fixture.now,
  });
  const secondLeaseOwner = `second-invocation-${fixture.suffix}`;
  const secondClaim = await claimOperationInvocation({
    receiptId: secondReservation.receipt.id,
    executionKind: "task_step",
    attemptId: fixture.attemptId,
    workerInstanceId: fixture.runtimeId,
    modelToolCallId: `second-call-${fixture.suffix}`,
    leaseOwner: secondLeaseOwner,
    leaseExpiresAt: new Date(fixture.now.getTime() + 60_000),
    taskLeaseOwner: fixture.leaseOwner,
    agentLeaseOwner: fixture.leaseOwner,
    now: fixture.now,
  });
  assert.ok(secondClaim.claimed && secondClaim.invocation);

  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  await markOperationRunning({
    receiptId: secondReservation.receipt.id,
    invocationId: secondClaim.invocation.id,
    leaseOwner: secondLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  await markOperationUnknown({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    failureKind: "first_unknown",
    sanitizedError: "The first effect outcome is unknown.",
    now: new Date(fixture.now.getTime() + 2_000),
  });
  await markOperationUnknown({
    receiptId: secondReservation.receipt.id,
    invocationId: secondClaim.invocation.id,
    leaseOwner: secondLeaseOwner,
    failureKind: "second_unknown",
    sanitizedError: "The second effect outcome is unknown.",
    now: new Date(fixture.now.getTime() + 2_000),
  });

  await reconcileOperation({
    receiptId: fixture.receipt.id,
    decision: "confirmed_applied",
    note: "The first external effect is confirmed.",
    actorId: "operator-multiple-unknowns",
    now: new Date(fixture.now.getTime() + 3_000),
  });
  const [stillBlocked] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  assert.equal(stillBlocked.status, "blocked");
  assert.equal(stillBlocked.blockedReason, "operation_outcome_unknown");

  await reconcileOperation({
    receiptId: secondReservation.receipt.id,
    decision: "confirmed_not_applied",
    note: "The second external effect is confirmed not applied.",
    actorId: "operator-multiple-unknowns",
    now: new Date(fixture.now.getTime() + 4_000),
  });
  const [resumed] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  assert.equal(resumed.status, "in_progress");
  assert.equal(resumed.blockedReason, null);
});

async function createApprovedBrowserFixture(executionLocale?: WorkspaceLocale) {
  await dbReady;
  const suffix = randomUUID();
  const now = new Date();
  const agentLeaseOwner = `approval-agent-${suffix}`;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Approved action owner ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: agentLeaseOwner,
      runLeaseExpiresAt: new Date(now.getTime() + 90_000),
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Approved browser action ${suffix}`,
      brief: "The approval must remain live until the exact effect boundary.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      leaseOwner: agentLeaseOwner,
      leaseExpiresAt: new Date(now.getTime() + 90_000),
      createdByUser: true,
    })
    .returning();
  const runtimeId = `approval-runtime-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "approval-receipt-test",
    processId: 1901,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: now,
  });
  const args = { targetHash: `sha256:${"b".repeat(64)}` };
  const argsHash = createHash("sha256")
    .update(JSON.stringify(args))
    .digest("hex");
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "external_contact",
      title: "Approve exact browser click",
      description: "Test only",
      scope: { toolName: "browser_click", argsHash },
      actionPayload: { toolName: "browser_click", args },
      status: "approved",
      resolvedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      browserRuntimeInstanceId: runtimeId,
      browserSessionId: `session-${suffix}`,
      browserSessionEpoch: 1,
      browserSnapshotMarker: `snapshot-${suffix}`,
      browserBindingHash: `sha256:${"c".repeat(64)}`,
    })
    .returning();
  const browserBinding = {
    runtimeInstanceId: runtimeId,
    sessionId: `session-${suffix}`,
    sessionEpoch: 1,
    snapshotMarker: `snapshot-${suffix}`,
    bindingHash: `sha256:${"c".repeat(64)}`,
  };
  const reservation = await reserveOperation({
    executionLocale,
    canonicalVersion: 1,
    executionKind: "approved_action",
    logicalExecutionId: `approval:${approval.id}`,
    toolName: "browser_click",
    args,
    physical: {
      attemptId: null,
      workerInstanceId: runtimeId,
      modelToolCallId: null,
      callSlot: "approved-action:0",
    },
    taskId: task.id,
    agentId: agent.id,
    approvalId: approval.id,
    sourceMessageId: null,
    originAttemptId: null,
    sideEffectClass: "approval_at_most_once",
  });
  const invocationLeaseOwner = `approval-invocation-${suffix}`;
  const claim = await claimOperationInvocation({
    receiptId: reservation.receipt.id,
    executionKind: "approved_action",
    attemptId: null,
    workerInstanceId: runtimeId,
    modelToolCallId: null,
    leaseOwner: invocationLeaseOwner,
    leaseExpiresAt: new Date(now.getTime() + 45_000),
    taskLeaseOwner: null,
    agentLeaseOwner,
    browserBinding,
    now,
  });
  assert.ok(claim.claimed && claim.invocation);
  return {
    now,
    agent,
    task,
    approval,
    runtimeId,
    agentLeaseOwner,
    invocationLeaseOwner,
    receipt: reservation.receipt,
    invocation: claim.invocation,
    browserBinding,
  };
}

test("approved action authority is rechecked and consumed at the exact effect boundary", async () => {
  const fixture = await createApprovedBrowserFixture();
  await db
    .update(approvalRequestsTable)
    .set({ expiresAt: new Date(fixture.now.getTime() - 1) })
    .where(eq(approvalRequestsTable.id, fixture.approval.id));

  await assert.rejects(
    markOperationRunning({
      receiptId: fixture.receipt.id,
      invocationId: fixture.invocation!.id,
      leaseOwner: fixture.invocationLeaseOwner,
      browserBinding: fixture.browserBinding,
      now: new Date(fixture.now.getTime() + 1_000),
    }),
    OperationInvocationStateError,
  );
  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, fixture.receipt.id));
  assert.equal(receipt.state, "reserved");
});

test("missing approved browser affinity invalidates and scrubs without rewriting the decision", async () => {
  const fixture = await createApprovedBrowserFixture();
  const invalidated = await invalidateApprovalBinding({
    approvalId: fixture.approval.id,
    expectedRuntimeInstanceId: fixture.runtimeId,
    expectedBindingHash: fixture.browserBinding.bindingHash,
    reason: "binding_unavailable/reapproval_required",
    now: new Date(fixture.now.getTime() + 1_000),
  });
  assert.equal(invalidated.status, "approved");
  assert.equal(invalidated.consumedAt, null);
  assert.ok(invalidated.bindingInvalidatedAt);
  assert.equal(
    invalidated.bindingInvalidationReason,
    "binding_unavailable/reapproval_required",
  );
  assert.equal(invalidated.actionPayload, null);
  const [resumableTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  assert.equal(resumableTask.status, "in_progress");
  assert.equal(resumableTask.leaseOwner, null);
});

test("a live approved action consumes and scrubs its capability in the running transition", async () => {
  const fixture = await createApprovedBrowserFixture();
  const running = await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation!.id,
    leaseOwner: fixture.invocationLeaseOwner,
    browserBinding: fixture.browserBinding,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  assert.equal(running.receipt.state, "running");
  const [approval] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, fixture.approval.id));
  assert.ok(approval.consumedAt);
  assert.equal(approval.actionPayload, null);

  const heartbeat = await heartbeatOperationInvocation({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation!.id,
    leaseOwner: fixture.invocationLeaseOwner,
    browserBinding: fixture.browserBinding,
    leaseExpiresAt: new Date(fixture.now.getTime() + 120_000),
    now: new Date(fixture.now.getTime() + 2_000),
  });
  assert.equal(heartbeat.renewed, true);
  assert.equal(heartbeat.invocation.state, "running");
});

test("an unknown approved action blocks with approval-specific operator evidence", async () => {
  const fixture = await createApprovedBrowserFixture();
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation!.id,
    leaseOwner: fixture.invocationLeaseOwner,
    browserBinding: fixture.browserBinding,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  await markOperationUnknown({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation!.id,
    leaseOwner: fixture.invocationLeaseOwner,
    browserBinding: fixture.browserBinding,
    failureKind: "approved_effect_outcome_unknown",
    sanitizedError: "The approved external effect could not be confirmed.",
    now: new Date(fixture.now.getTime() + 2_000),
  });
  const [blockedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  assert.equal(blockedTask.status, "blocked");
  assert.equal(blockedTask.blockedReason, "approval_outcome_unknown");
});

test("a stale outer owner cannot finalize a known effect before recovery fences it", async () => {
  const fixture = await createTaskExecutionFixture("idempotent");
  await markOperationRunning({
    receiptId: fixture.receipt.id,
    invocationId: fixture.invocation.id,
    leaseOwner: fixture.invocationLeaseOwner,
    now: new Date(fixture.now.getTime() + 1_000),
  });
  await db
    .update(tasksTable)
    .set({ leaseExpiresAt: new Date(fixture.now.getTime() - 1) })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(agentsTable)
    .set({ runLeaseExpiresAt: new Date(fixture.now.getTime() - 1) })
    .where(eq(agentsTable.id, fixture.agent.id));

  await assert.rejects(
    completeOperation({
      receiptId: fixture.receipt.id,
      invocationId: fixture.invocation.id,
      leaseOwner: fixture.invocationLeaseOwner,
      resultData: {
        pathHash: `sha256:${"f".repeat(64)}`,
        byteCount: 2,
      },
      now: new Date(fixture.now.getTime() + 2_000),
    }),
    OperationInvocationStateError,
  );
  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, fixture.receipt.id));
  assert.equal(receipt.state, "running");
});

test("approved browser claims reject a different runtime than the immutable binding", async () => {
  const fixture = await createApprovedBrowserFixture();
  const otherRuntimeId = `other-${fixture.runtimeId}`;
  await db.insert(runtimeInstancesTable).values({
    id: otherRuntimeId,
    role: "worker",
    state: "healthy",
    hostname: "wrong-approval-runtime",
    processId: 1902,
    buildVersion: "test",
    schedulerEnabled: true,
  });
  const secondReservation = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "approved_action",
    logicalExecutionId: `approval:${fixture.approval.id}:wrong-runtime`,
    toolName: "browser_click",
    args: { targetHash: `sha256:${"d".repeat(64)}` },
    physical: {
      attemptId: null,
      workerInstanceId: otherRuntimeId,
      modelToolCallId: null,
      callSlot: "approved-action:wrong-runtime",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: fixture.approval.id,
    sourceMessageId: null,
    originAttemptId: null,
    sideEffectClass: "approval_at_most_once",
  });
  await assert.rejects(
    claimOperationInvocation({
      receiptId: secondReservation.receipt.id,
      executionKind: "approved_action",
      attemptId: null,
      workerInstanceId: otherRuntimeId,
      leaseOwner: `wrong-runtime-${randomUUID()}`,
      leaseExpiresAt: new Date(fixture.now.getTime() + 45_000),
      taskLeaseOwner: null,
      agentLeaseOwner: fixture.agentLeaseOwner,
      browserBinding: {
        ...fixture.browserBinding,
        runtimeInstanceId: otherRuntimeId,
      },
      now: fixture.now,
    }),
    OperationInvocationStateError,
  );
});

test("reservation presentation accepts only production locale enums and never alters a prior identity", async () => {
  const fixture = await createTaskExecutionFixture("at_most_once");
  const input: ReserveOperationInput = {
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId: fixture.logicalExecutionId,
    toolName: "vm_run_command",
    args: { commandHash: `sha256:${"e".repeat(64)}` },
    physical: {
      attemptId: fixture.attemptId,
      workerInstanceId: fixture.runtimeId,
      modelToolCallId: "presentation",
      callSlot: "presentation",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: fixture.attemptId,
    sideEffectClass: "at_most_once",
  };
  for (const invalid of [null, "constructor", "en-US", { locale: "en" }]) {
    await assert.rejects(
      reserveOperation({
        ...input,
        executionLocale: invalid as WorkspaceLocale,
      }),
      /Invalid .*execution locale/,
    );
  }
  await assert.rejects(
    reserveOperation({
      ...input,
      toolName: "synthetic_fixture_write",
      sideEffectClass: "idempotent",
      executionLocale: "en",
    }),
    /Invalid .*execution locale/,
  );
  const first = await reserveOperation({ ...input, executionLocale: "zh-TW" });
  assert.deepEqual(first.receipt.resultData, { executionLocale: "zh-TW" });
  const replay = await reserveOperation({ ...input, executionLocale: "ar" });
  assert.deepEqual(replay.receipt, first.receipt);
  assert.equal(replay.execute, false);
});

// Independent production inventory: removing locale support from any actual tool
// must fail before the invocation is allowed to start.
for (const [toolName, sideEffectClass] of [
  ["computer_observe", "read_only"],
  ["vm_list_files", "read_only"],
  ["vm_read_file", "read_only"],
  ["browser_snapshot", "read_only"],
  ["browser_extract_text", "read_only"],
  ["browser_wait", "read_only"],
  ["create_sub_agent", "transactional"],
  ["delegate_task", "transactional"],
  ["update_task_progress", "transactional"],
  ["complete_task", "transactional"],
  ["request_approval", "transactional"],
  ["request_user_input", "transactional"],
  ["log_note", "transactional"],
  ["post_company_message", "transactional"],
  ["vm_write_file", "idempotent"],
  ["browser_open", "at_most_once"],
  ["browser_scroll", "at_most_once"],
  ["browser_save_screenshot", "at_most_once"],
  ["browser_click", "at_most_once"],
  ["browser_type", "approval_at_most_once"],
  ["vm_run_command", "at_most_once"],
  ["vm_run_sudo_command", "approval_at_most_once"],
] as const) {
  test(`${toolName} retains its reserved language and rejects unbounded result evidence`, async () => {
    for (const executionLocale of WORKSPACE_LOCALES) {
      const fixture = await createTaskExecutionFixture(sideEffectClass, {
        toolName,
        executionLocale,
      });
      assert.deepEqual(fixture.receipt.resultData, { executionLocale });
      const owner = {
        receiptId: fixture.receipt.id,
        invocationId: fixture.invocation.id,
        leaseOwner: fixture.invocationLeaseOwner,
      };
      await markOperationRunning(owner);
      for (const resultData of [
        { executionLocale: "en-US" },
        { executionLocale: { locale: "en" } },
        { executionLocale, rawOutput: "must never be stored" },
      ]) {
        await assert.rejects(
          completeOperation({ ...owner, resultData }),
          /Unsafe or non-allowlisted/,
        );
      }
      const completed = await completeOperation({
        ...owner,
        resultData: { executionLocale: executionLocale === "en" ? "ar" : "en" },
      });
      assert.deepEqual(completed.resultData, { executionLocale });
      assert.equal(
        completed.resultSummary,
        toolMessage(executionLocale, "operationCompleted", { tool: toolName }),
      );
      assert.equal(completed.argumentHash, fixture.receipt.argumentHash);
      assert.equal(completed.operationKey, fixture.receipt.operationKey);
      const replay = await completeOperation({
        ...owner,
        resultData: { executionLocale: executionLocale === "ar" ? "en" : "ar" },
      });
      assert.equal(replay.resultSummary, completed.resultSummary);
      assert.deepEqual(replay.resultData, completed.resultData);
    }
  });
}

test("file receipt retains original locale through safe retry and stale-worker recovery", async () => {
  for (const executionLocale of WORKSPACE_LOCALES) {
    const fixture = await createTaskExecutionFixture("idempotent", {
      executionLocale,
    });
    const owner = {
      receiptId: fixture.receipt.id,
      invocationId: fixture.invocation.id,
      leaseOwner: fixture.invocationLeaseOwner,
    };
    await markOperationRunning(owner);
    const released = await releaseOperationForSafeRetry({
      ...owner,
      failureKind: "test_retry",
      sanitizedError: "test",
    });
    assert.equal(released.state, "reserved");
    assert.deepEqual(released.resultData, { executionLocale });

    const stale = await createTaskExecutionFixture("idempotent", {
      executionLocale,
    });
    await markOperationRunning({
      receiptId: stale.receipt.id,
      invocationId: stale.invocation.id,
      leaseOwner: stale.invocationLeaseOwner,
    });
    const { expiredAt, staleHeartbeat } = await expireExecution(stale);
    const recovered = await recoverInterruptedOperation({
      receiptId: stale.receipt.id,
      now: expiredAt,
      runtimeStaleBefore: staleHeartbeat,
    });
    assert.equal(recovered.disposition, "reclaimable_same_key");
    const [saved] = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, stale.receipt.id));
    assert.deepEqual(saved.resultData, { executionLocale });
  }
});

for (const locale of WORKSPACE_LOCALES) {
  test(`${locale}: authored recovery reconciliation keeps the receipt language and one audit event`, async () => {
    const fixture = await createTaskExecutionFixture("at_most_once", {
      toolName: "browser_scroll",
      executionLocale: locale,
    });
    await markOperationRunning({
      receiptId: fixture.receipt.id,
      invocationId: fixture.invocation.id,
      leaseOwner: fixture.invocationLeaseOwner,
    });
    await markOperationUnknown({
      receiptId: fixture.receipt.id,
      invocationId: fixture.invocation.id,
      leaseOwner: fixture.invocationLeaseOwner,
      failureKind: "fixture_interruption",
      sanitizedError: "source",
    });
    const input = {
      receiptId: fixture.receipt.id,
      decision: "confirmed_applied" as const,
      note: "Operator source {id} $& 原文",
      actorId: "operator-test",
    };
    const first = await reconcileOperation(input);
    const repeated = await reconcileOperation(input);
    assert.equal(
      repeated.reconciledAt?.getTime(),
      first.reconciledAt?.getTime(),
    );
    assert.equal(first.reconciliationNote, input.note);
    const events = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, fixture.task.id));
    const event = events.filter(
      (row) => row.detail?.runtimeEvent === "operation_reconciled",
    );
    assert.equal(event.length, 1);
    assert.equal(event[0].summary, toolMessage(locale, "operationReconciled"));
  });

  test(`${locale}: authored recovery invalidation keeps the receipt language and one audit event`, async () => {
    const fixture = await createApprovedBrowserFixture(locale);
    const input = {
      locale: locale === "ar" ? ("de" as const) : ("ar" as const),
      approvalId: fixture.approval.id,
      expectedRuntimeInstanceId: fixture.runtimeId,
      expectedBindingHash: fixture.browserBinding.bindingHash,
      reason: "binding_unavailable/reapproval_required",
    };
    const first = await invalidateApprovalBinding(input);
    const repeated = await invalidateApprovalBinding(input);
    assert.equal(
      repeated.bindingInvalidatedAt?.getTime(),
      first.bindingInvalidatedAt?.getTime(),
    );
    assert.equal(first.actionPayload, null);
    assert.equal(first.consumedAt, null);
    const events = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, fixture.task.id));
    const event = events.filter(
      (row) => row.detail?.runtimeEvent === "approval_binding_invalidated",
    );
    assert.equal(event.length, 1);
    assert.equal(
      event[0].summary,
      toolMessage(locale, "approvalBindingInvalidated"),
    );
  });
}
