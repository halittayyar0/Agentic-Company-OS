import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  approvalRequestsTable,
  db,
  dbReady,
  operationInvocationsTable,
  operationReceiptsTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import {
  canonicalArgumentHash,
  claimOperationInvocation,
  ConfirmedAppliedReplayError,
  markOperationRunning,
  markOperationUnknown,
  OperationReconciliationConflictError,
  OperationReceiptIntegrityError,
  reconcileOperation,
  reserveOperation,
} from "./operation-receipts";
import {
  runDurableExternalEffect,
  type ToolRuntimeContext,
} from "./execute-tool";
import { buildTaskStepSystemPrompt } from "./system-prompt";

async function createUnknownOperationFixture() {
  await dbReady;
  const suffix = randomUUID();
  const now = new Date();
  const leaseOwner = `reconciliation-task-${suffix}`;
  const runtimeId = `reconciliation-runtime-${suffix}`;
  const logicalExecutionId = randomUUID();
  const attemptId = randomUUID();
  const args = {
    command: `publish-once-${suffix}`,
    metadata: { label: "caf\u00e9", zero: 0 },
  };

  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Reconciliation owner ${suffix}`,
      role: "Test operator",
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
      title: `Reconciliation continuation ${suffix}`,
      brief: "Apply one externally visible effect exactly once.",
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
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "reconciliation-continuation-test",
    processId: 2201,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: now,
  });
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
    toolName: "vm_run_command",
    args,
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
    sideEffectClass: "at_most_once",
    externalIdempotencyKey: `effect-${suffix}`,
    now,
  });
  const invocationLeaseOwner = `operation-${suffix}`;
  const claimed = await claimOperationInvocation({
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
  assert.ok(claimed.claimed && claimed.invocation);
  await markOperationRunning({
    receiptId: reservation.receipt.id,
    invocationId: claimed.invocation.id,
    leaseOwner: invocationLeaseOwner,
    now: new Date(now.getTime() + 1_000),
  });
  await markOperationUnknown({
    receiptId: reservation.receipt.id,
    invocationId: claimed.invocation.id,
    leaseOwner: invocationLeaseOwner,
    failureKind: "test_outcome_unknown",
    sanitizedError:
      "The test effect crossed its boundary without an acknowledgement.",
    now: new Date(now.getTime() + 2_000),
  });

  return {
    agent,
    task,
    runtimeId,
    args,
    receipt: reservation.receipt,
    now,
    suffix,
  };
}

async function createUnknownApprovedActionFixture() {
  await dbReady;
  const suffix = randomUUID();
  const now = new Date();
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Approved reconciliation owner ${suffix}`,
      role: "Test operator",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "idle",
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Approved reconciliation continuation ${suffix}`,
      brief: "Apply one approved external effect exactly once.",
      ownerAgentId: agent.id,
      status: "blocked",
      blockedReason: "approval_outcome_unknown",
      createdByUser: true,
    })
    .returning();
  const runtimeId = `approved-reconciliation-runtime-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "approved-reconciliation-test",
    processId: 2202,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: now,
  });
  const args = { commandHash: `sha256:${"a".repeat(64)}` };
  const argumentHash = canonicalArgumentHash(args);
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Approved continuation fixture",
      description: "Test only",
      scope: { toolName: "vm_run_sudo_command", argsHash: argumentHash },
      actionPayload: null,
      status: "approved",
      resolvedAt: now,
      consumedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    })
    .returning();
  const receiptId = randomUUID();
  await db.insert(operationReceiptsTable).values({
    id: receiptId,
    canonicalVersion: 1,
    operationKey: `approved-reconciliation-op-${suffix}`,
    replayKey: `approved-reconciliation-replay-${suffix}`,
    executionKind: "approved_action",
    logicalExecutionId: `approval:${approval.id}`,
    taskId: task.id,
    agentId: agent.id,
    approvalId: approval.id,
    originAttemptId: null,
    sideEffectClass: "approval_at_most_once",
    state: "unknown",
    toolName: "vm_run_sudo_command",
    argumentHash,
    startedAt: now,
    finishedAt: new Date(now.getTime() + 1_000),
    failureKind: "approved_effect_outcome_unknown",
    sanitizedError: "The approved effect outcome is unknown.",
  });
  await db.insert(operationInvocationsTable).values({
    id: randomUUID(),
    receiptId,
    executionKind: "approved_action",
    state: "unknown",
    attemptId: null,
    workerInstanceId: runtimeId,
    modelToolCallId: null,
    leaseOwner: `approved-reconciliation-invocation-${suffix}`,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    taskLeaseOwner: null,
    agentLeaseOwner: `approved-reconciliation-agent-${suffix}`,
    claimedAt: now,
    lastHeartbeatAt: new Date(now.getTime() + 1_000),
    effectStartedAt: now,
    finishedAt: new Date(now.getTime() + 1_000),
    failureKind: "approved_effect_outcome_unknown",
    sanitizedError: "The approved effect outcome is unknown.",
  });
  return { agent, task, receiptId, now, suffix };
}

async function reserveSameEffectInNextAttempt(
  fixture: Awaited<ReturnType<typeof createUnknownOperationFixture>>,
  options: { cycleNumber?: number; args?: Record<string, unknown> } = {},
) {
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  const leaseOwner = `reconciliation-next-${fixture.suffix}`;
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    workerInstanceId: fixture.runtimeId,
    leaseOwner,
    attemptNumber: 2,
    cycleNumber: options.cycleNumber ?? 0,
    state: "running",
    logicalExecutionId,
  });
  return reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId,
    toolName: "vm_run_command",
    args: options.args ?? fixture.args,
    physical: {
      attemptId,
      workerInstanceId: fixture.runtimeId,
      modelToolCallId: `retry-${fixture.suffix}`,
      callSlot: "provider:0:tool:0",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: attemptId,
    sideEffectClass: "at_most_once",
    externalIdempotencyKey: null,
    now: new Date(fixture.now.getTime() + 4_000),
  });
}

test("confirmed-applied evidence prevents the same effect from receiving a new receipt in the same task cycle", async () => {
  const fixture = await createUnknownOperationFixture();
  await reconcileOperation({
    receiptId: fixture.receipt.id,
    decision: "confirmed_applied",
    note: "Verified in the authoritative external system.",
    actorId: "operator-test",
    now: new Date(fixture.now.getTime() + 3_000),
  });

  const repeated = await reserveSameEffectInNextAttempt(fixture, {
    args: {
      metadata: { zero: -0, label: "cafe\u0301" },
      command: fixture.args.command,
    },
  });
  assert.equal(repeated.execute, false);
  assert.equal(repeated.disposition, "reconciled_applied");
  assert.equal(repeated.receipt.id, fixture.receipt.id);
  assert.equal(repeated.receipt.reconciliationDecision, "confirmed_applied");

  const exactRetry = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId: fixture.receipt.logicalExecutionId,
    toolName: fixture.receipt.toolName,
    args: fixture.args,
    physical: {
      attemptId: fixture.receipt.originAttemptId,
      workerInstanceId: fixture.runtimeId,
      modelToolCallId: `call-${fixture.suffix}`,
      callSlot: "provider:0:tool:0",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: fixture.receipt.originAttemptId,
    sideEffectClass: "at_most_once",
    externalIdempotencyKey: `effect-${fixture.suffix}`,
  });
  assert.equal(exactRetry.receipt.id, fixture.receipt.id);
  assert.equal(exactRetry.disposition, "reconciled_applied");
});

test("the durable external wrapper replays confirmed-applied evidence without crossing the effect boundary", async () => {
  const fixture = await createUnknownOperationFixture();
  await reconcileOperation({
    receiptId: fixture.receipt.id,
    decision: "confirmed_applied",
    note: "Verified in the authoritative external system.",
    actorId: "operator-test",
    now: new Date(fixture.now.getTime() + 3_000),
  });

  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  const leaseOwner = `reconciliation-wrapper-${fixture.suffix}`;
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    workerInstanceId: fixture.runtimeId,
    leaseOwner,
    attemptNumber: 2,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
  });
  const context: ToolRuntimeContext = {
    agent: fixture.agent,
    taskId: fixture.task.id,
    taskLeaseOwner: leaseOwner,
    runtimeAttemptId: attemptId,
    assertTaskLease: async () => undefined,
    operationIdentity: {
      executionKind: "task_step",
      logicalExecutionId,
      runtimeInstanceId: fixture.runtimeId,
      originAttemptId: attemptId,
      sourceMessageId: null,
      modelToolCallId: `reconciled-replay-${fixture.suffix}`,
      callSlot: "provider:0:tool:0",
      agentLeaseOwner: leaseOwner,
    },
  };
  let effects = 0;
  const replay = await runDurableExternalEffect(context, {
    toolName: "vm_run_command",
    normalizedArgs: fixture.args,
    execute: async ({ startEffect }) => {
      await startEffect();
      effects += 1;
      return {
        result: {
          content: "should not execute",
          createdTasks: [],
          createdAgents: [],
          toolOutcome: "succeeded",
        },
      };
    },
    onError: async () => ({
      content: "unexpected error",
      createdTasks: [],
      createdAgents: [],
      toolOutcome: "rejected",
    }),
  });

  assert.equal(effects, 0);
  assert.equal(replay.receiptId, fixture.receipt.id);
  assert.equal(replay.toolOutcome, "succeeded");
});

test("reconciliation after a successor reservation fences its future effect boundary and replays the confirmed receipt", async () => {
  const fixture = await createUnknownOperationFixture();
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  const leaseOwner = `reconciliation-boundary-${fixture.suffix}`;
  const leaseExpiresAt = new Date(Date.now() + 120_000);
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    workerInstanceId: fixture.runtimeId,
    leaseOwner,
    attemptNumber: 2,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
  });
  const modelToolCallId = `boundary-${fixture.suffix}`;
  const callSlot = "provider:0:tool:0";
  const successorReservation = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId,
    toolName: "vm_run_command",
    args: fixture.args,
    physical: {
      attemptId,
      workerInstanceId: fixture.runtimeId,
      modelToolCallId,
      callSlot,
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: attemptId,
    sideEffectClass: "at_most_once",
    externalIdempotencyKey: null,
  });
  assert.equal(successorReservation.execute, true);
  await reconcileOperation({
    receiptId: fixture.receipt.id,
    decision: "confirmed_applied",
    note: "Verified after the successor reserved but before its effect.",
    actorId: "operator-boundary-test",
  });
  await db
    .update(tasksTable)
    .set({
      status: "in_progress",
      blockedReason: null,
      leaseOwner,
      leaseExpiresAt,
    })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(agentsTable)
    .set({
      status: "working",
      currentTaskId: fixture.task.id,
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: leaseExpiresAt,
    })
    .where(eq(agentsTable.id, fixture.agent.id));
  const context: ToolRuntimeContext = {
    agent: fixture.agent,
    taskId: fixture.task.id,
    taskLeaseOwner: leaseOwner,
    runtimeAttemptId: attemptId,
    assertTaskLease: async () => undefined,
    operationIdentity: {
      executionKind: "task_step",
      logicalExecutionId,
      runtimeInstanceId: fixture.runtimeId,
      originAttemptId: attemptId,
      sourceMessageId: null,
      modelToolCallId,
      callSlot,
      agentLeaseOwner: leaseOwner,
    },
  };
  let effects = 0;
  const replay = await runDurableExternalEffect(context, {
    toolName: "vm_run_command",
    normalizedArgs: fixture.args,
    execute: async ({ startEffect }) => {
      await startEffect();
      effects += 1;
      return {
        result: {
          content: "should not execute",
          createdTasks: [],
          createdAgents: [],
          toolOutcome: "succeeded",
        },
      };
    },
    onError: async () => ({
      content: "unexpected error",
      createdTasks: [],
      createdAgents: [],
      toolOutcome: "rejected",
    }),
  });

  assert.equal(effects, 0);
  assert.equal(replay.receiptId, fixture.receipt.id);
  assert.equal(replay.toolOutcome, "succeeded");
  const receipts = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.taskId, fixture.task.id));
  const successor = receipts.find(
    (receipt) => receipt.id !== fixture.receipt.id,
  );
  assert.ok(successor);
  assert.equal(successor.id, successorReservation.receipt.id);
  assert.equal(successor.state, "reserved");
});

test("claim rechecks task-cycle reconciliation after an earlier reservation", async () => {
  const fixture = await createUnknownOperationFixture();
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  const leaseOwner = `reconciliation-claim-${fixture.suffix}`;
  const modelToolCallId = `claim-${fixture.suffix}`;
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    workerInstanceId: fixture.runtimeId,
    leaseOwner,
    attemptNumber: 2,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
  });
  const successor = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId,
    toolName: "vm_run_command",
    args: fixture.args,
    physical: {
      attemptId,
      workerInstanceId: fixture.runtimeId,
      modelToolCallId,
      callSlot: "provider:0:tool:claim",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: attemptId,
    sideEffectClass: "at_most_once",
    externalIdempotencyKey: null,
  });
  await reconcileOperation({
    receiptId: fixture.receipt.id,
    decision: "confirmed_applied",
    note: "Verified after reservation and before claim.",
    actorId: "operator-claim-test",
  });
  const leaseExpiresAt = new Date(Date.now() + 120_000);
  await db
    .update(tasksTable)
    .set({
      status: "in_progress",
      blockedReason: null,
      leaseOwner,
      leaseExpiresAt,
    })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(agentsTable)
    .set({
      status: "working",
      currentTaskId: fixture.task.id,
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: leaseExpiresAt,
    })
    .where(eq(agentsTable.id, fixture.agent.id));

  const claimed = await claimOperationInvocation({
    receiptId: successor.receipt.id,
    executionKind: "task_step",
    attemptId,
    workerInstanceId: fixture.runtimeId,
    modelToolCallId,
    leaseOwner: `operation-claim-${fixture.suffix}`,
    leaseExpiresAt,
    taskLeaseOwner: leaseOwner,
    agentLeaseOwner: leaseOwner,
  });
  assert.equal(claimed.claimed, false);
  assert.equal(claimed.invocation, null);
  assert.equal(claimed.receipt.id, fixture.receipt.id);
  assert.equal(claimed.receipt.reconciliationDecision, "confirmed_applied");
});

test("the effect boundary rechecks reconciliation that committed after claim", async () => {
  const fixture = await createUnknownOperationFixture();
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  const leaseOwner = `reconciliation-mark-${fixture.suffix}`;
  const leaseExpiresAt = new Date(Date.now() + 120_000);
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    workerInstanceId: fixture.runtimeId,
    leaseOwner,
    attemptNumber: 2,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
  });
  const successor = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId,
    toolName: "vm_run_command",
    args: fixture.args,
    physical: {
      attemptId,
      workerInstanceId: fixture.runtimeId,
      modelToolCallId: `mark-${fixture.suffix}`,
      callSlot: "provider:0:tool:mark",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: attemptId,
    sideEffectClass: "at_most_once",
  });
  await db
    .update(tasksTable)
    .set({
      status: "in_progress",
      blockedReason: null,
      leaseOwner,
      leaseExpiresAt,
    })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(agentsTable)
    .set({
      status: "working",
      currentTaskId: fixture.task.id,
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: leaseExpiresAt,
    })
    .where(eq(agentsTable.id, fixture.agent.id));
  const invocationLeaseOwner = `operation-mark-${fixture.suffix}`;
  const claimed = await claimOperationInvocation({
    receiptId: successor.receipt.id,
    executionKind: "task_step",
    attemptId,
    workerInstanceId: fixture.runtimeId,
    modelToolCallId: `mark-${fixture.suffix}`,
    leaseOwner: invocationLeaseOwner,
    leaseExpiresAt,
    taskLeaseOwner: leaseOwner,
    agentLeaseOwner: leaseOwner,
  });
  assert.ok(claimed.claimed && claimed.invocation);

  await db
    .update(tasksTable)
    .set({
      status: "blocked",
      blockedReason: "operation_outcome_unknown",
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(agentsTable)
    .set({
      status: "idle",
      currentTaskId: null,
      runLeaseOwner: null,
      runLeaseExpiresAt: null,
    })
    .where(eq(agentsTable.id, fixture.agent.id));
  await reconcileOperation({
    receiptId: fixture.receipt.id,
    decision: "confirmed_applied",
    note: "Confirmed after the successor claimed but before its effect.",
    actorId: "operator-mark-test",
  });
  await db
    .update(tasksTable)
    .set({ leaseOwner, leaseExpiresAt })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(agentsTable)
    .set({
      status: "working",
      currentTaskId: fixture.task.id,
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: leaseExpiresAt,
    })
    .where(eq(agentsTable.id, fixture.agent.id));

  await assert.rejects(
    markOperationRunning({
      receiptId: successor.receipt.id,
      invocationId: claimed.invocation.id,
      leaseOwner: invocationLeaseOwner,
    }),
    (error: unknown) =>
      error instanceof ConfirmedAppliedReplayError &&
      error.confirmedReceipt.id === fixture.receipt.id,
  );
  const [unchangedSuccessor] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, successor.receipt.id));
  assert.equal(unchangedSuccessor.state, "reserved");
});

test("confirmed-applied reconciliation rejects a same-cycle effect that already started", async () => {
  const fixture = await createUnknownOperationFixture();
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  const leaseOwner = `reconciliation-running-${fixture.suffix}`;
  const leaseExpiresAt = new Date(Date.now() + 120_000);
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    workerInstanceId: fixture.runtimeId,
    leaseOwner,
    attemptNumber: 2,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
  });
  const successor = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId,
    toolName: "vm_run_command",
    args: fixture.args,
    physical: {
      attemptId,
      workerInstanceId: fixture.runtimeId,
      modelToolCallId: `running-${fixture.suffix}`,
      callSlot: "provider:0:tool:running",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: attemptId,
    sideEffectClass: "at_most_once",
  });
  await db
    .update(tasksTable)
    .set({
      status: "in_progress",
      blockedReason: null,
      leaseOwner,
      leaseExpiresAt,
    })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(agentsTable)
    .set({
      status: "working",
      currentTaskId: fixture.task.id,
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: leaseExpiresAt,
    })
    .where(eq(agentsTable.id, fixture.agent.id));
  const invocationLeaseOwner = `operation-running-${fixture.suffix}`;
  const claimed = await claimOperationInvocation({
    receiptId: successor.receipt.id,
    executionKind: "task_step",
    attemptId,
    workerInstanceId: fixture.runtimeId,
    modelToolCallId: `running-${fixture.suffix}`,
    leaseOwner: invocationLeaseOwner,
    leaseExpiresAt,
    taskLeaseOwner: leaseOwner,
    agentLeaseOwner: leaseOwner,
  });
  assert.ok(claimed.claimed && claimed.invocation);
  await markOperationRunning({
    receiptId: successor.receipt.id,
    invocationId: claimed.invocation.id,
    leaseOwner: invocationLeaseOwner,
  });

  await assert.rejects(
    reconcileOperation({
      receiptId: fixture.receipt.id,
      decision: "confirmed_applied",
      note: "Must not overwrite an already-running same-cycle effect.",
      actorId: "operator-running-test",
    }),
    OperationReconciliationConflictError,
  );
});

test("confirmed-not-applied evidence permits a new responsibility to reserve the effect", async () => {
  const fixture = await createUnknownOperationFixture();
  await reconcileOperation({
    receiptId: fixture.receipt.id,
    decision: "confirmed_not_applied",
    note: "Verified absent in the authoritative external system.",
    actorId: "operator-test",
    now: new Date(fixture.now.getTime() + 3_000),
  });

  const repeated = await reserveSameEffectInNextAttempt(fixture);
  assert.equal(repeated.execute, true);
  assert.notEqual(repeated.receipt.id, fixture.receipt.id);
});

test("confirmed-applied evidence is scoped to one task cycle", async () => {
  const fixture = await createUnknownOperationFixture();
  await reconcileOperation({
    receiptId: fixture.receipt.id,
    decision: "confirmed_applied",
    note: "Verified in the authoritative external system.",
    actorId: "operator-test",
    now: new Date(fixture.now.getTime() + 3_000),
  });
  await db
    .update(tasksTable)
    .set({ cycleCount: 1 })
    .where(eq(tasksTable.id, fixture.task.id));

  const nextCycle = await reserveSameEffectInNextAttempt(fixture, {
    cycleNumber: 1,
  });
  assert.equal(nextCycle.execute, true);
  assert.equal(nextCycle.disposition, "execute");
  assert.notEqual(nextCycle.receipt.id, fixture.receipt.id);

  const [updatedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  const prompt = await buildTaskStepSystemPrompt(fixture.agent, updatedTask);
  assert.doesNotMatch(prompt, new RegExp(fixture.receipt.id, "u"));
});

test("multiple confirmed-applied matches fail closed as integrity corruption", async () => {
  const fixture = await createUnknownOperationFixture();
  await reconcileOperation({
    receiptId: fixture.receipt.id,
    decision: "confirmed_applied",
    note: "Verified in the authoritative external system.",
    actorId: "operator-test",
    now: new Date(fixture.now.getTime() + 3_000),
  });
  const corruptReceiptId = randomUUID();
  await db.insert(operationReceiptsTable).values({
    id: corruptReceiptId,
    canonicalVersion: 1,
    operationKey: `corrupt-op-${fixture.suffix}`,
    replayKey: `corrupt-replay-${fixture.suffix}`,
    executionKind: "task_step",
    logicalExecutionId: fixture.receipt.logicalExecutionId,
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    originAttemptId: fixture.receipt.originAttemptId,
    sideEffectClass: "at_most_once",
    state: "unknown",
    toolName: "vm_run_command",
    argumentHash: canonicalArgumentHash(fixture.args),
    finishedAt: new Date(fixture.now.getTime() + 3_500),
    reconciliationDecision: "confirmed_applied",
    reconciliationNote: "Synthetic corruption fixture.",
    reconciliationActorId: "operator-corruption-test",
    reconciledAt: new Date(fixture.now.getTime() + 3_500),
  });

  await assert.rejects(
    reserveSameEffectInNextAttempt(fixture),
    OperationReceiptIntegrityError,
  );
});

test("the next task prompt carries bounded authoritative reconciliation evidence without operator notes", async () => {
  const fixture = await createUnknownOperationFixture();
  const secretNote = `operator-private-note-${fixture.suffix}`;
  await reconcileOperation({
    receiptId: fixture.receipt.id,
    decision: "confirmed_applied",
    note: secretNote,
    actorId: "operator-test",
    now: new Date(fixture.now.getTime() + 3_000),
  });
  const secretResult = `private-result-${fixture.suffix}`;
  await db
    .update(operationReceiptsTable)
    .set({
      resultSummary: secretResult,
      resultData: { raw: secretResult },
    })
    .where(eq(operationReceiptsTable.id, fixture.receipt.id));
  const olderReceiptIds: string[] = [];
  for (let index = 0; index < 9; index += 1) {
    const receiptId = randomUUID();
    olderReceiptIds.push(receiptId);
    await db.insert(operationReceiptsTable).values({
      id: receiptId,
      canonicalVersion: 1,
      operationKey: `bounded-op-${fixture.suffix}-${index}`,
      replayKey: `bounded-replay-${fixture.suffix}-${index}`,
      executionKind: "task_step",
      logicalExecutionId: fixture.receipt.logicalExecutionId,
      taskId: fixture.task.id,
      agentId: fixture.agent.id,
      originAttemptId: fixture.receipt.originAttemptId,
      sideEffectClass: "at_most_once",
      state: "unknown",
      toolName: `bounded_tool_${index}`,
      argumentHash: String(index).padStart(64, "0"),
      finishedAt: new Date(fixture.now.getTime() - index * 1_000),
      resultSummary: `hidden-result-${fixture.suffix}-${index}`,
      resultData: { hidden: `hidden-payload-${fixture.suffix}-${index}` },
      reconciliationDecision:
        index % 2 === 0 ? "confirmed_applied" : "confirmed_not_applied",
      reconciliationNote: `hidden-note-${fixture.suffix}-${index}`,
      reconciliationActorId: `hidden-actor-${fixture.suffix}-${index}`,
      reconciledAt: new Date(fixture.now.getTime() - index * 1_000),
    });
  }
  const [resumedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));

  const prompt = await buildTaskStepSystemPrompt(fixture.agent, resumedTask);
  assert.match(prompt, /operation_reconciliation_directives/u);
  assert.match(prompt, new RegExp(fixture.receipt.id, "u"));
  assert.match(prompt, /confirmed_applied/u);
  assert.match(prompt, /vm_run_command/u);
  assert.match(prompt, /yeniden (?:önerme|çalıştırma)/iu);
  assert.equal((prompt.match(/<directive>/gu) ?? []).length, 8);
  assert.doesNotMatch(prompt, new RegExp(olderReceiptIds.at(-1)!, "u"));
  assert.doesNotMatch(prompt, new RegExp(secretNote, "u"));
  assert.doesNotMatch(prompt, /operator-test/u);
  assert.doesNotMatch(prompt, new RegExp(secretResult, "u"));
  assert.doesNotMatch(prompt, new RegExp(fixture.args.command, "u"));
  assert.doesNotMatch(prompt, new RegExp(`hidden-note-${fixture.suffix}`, "u"));
  assert.doesNotMatch(
    prompt,
    new RegExp(`hidden-actor-${fixture.suffix}`, "u"),
  );
  assert.doesNotMatch(
    prompt,
    new RegExp(`hidden-result-${fixture.suffix}`, "u"),
  );
  assert.doesNotMatch(
    prompt,
    new RegExp(`hidden-payload-${fixture.suffix}`, "u"),
  );
});

test("approved-action reconciliation reaches the resumed task prompt only for the current cycle", async () => {
  const fixture = await createUnknownApprovedActionFixture();
  const secretNote = `approved-private-note-${fixture.suffix}`;
  const secretActor = `approved-private-actor-${fixture.suffix}`;
  const reconciledAt = new Date(fixture.now.getTime() + 2_000);
  await reconcileOperation({
    receiptId: fixture.receiptId,
    decision: "confirmed_applied",
    note: secretNote,
    actorId: secretActor,
    now: reconciledAt,
  });
  const [resumedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  assert.equal(resumedTask.status, "in_progress");

  const currentPrompt = await buildTaskStepSystemPrompt(
    fixture.agent,
    resumedTask,
  );
  assert.match(currentPrompt, new RegExp(fixture.receiptId, "u"));
  assert.match(currentPrompt, /vm_run_sudo_command/u);
  assert.match(currentPrompt, /confirmed_applied/u);
  assert.doesNotMatch(currentPrompt, new RegExp(secretNote, "u"));
  assert.doesNotMatch(currentPrompt, new RegExp(secretActor, "u"));

  const [nextCycleTask] = await db
    .update(tasksTable)
    .set({
      cycleCount: 1,
      lastCycleCompletedAt: new Date(reconciledAt.getTime() + 1),
    })
    .where(eq(tasksTable.id, fixture.task.id))
    .returning();
  const nextCyclePrompt = await buildTaskStepSystemPrompt(
    fixture.agent,
    nextCycleTask,
  );
  assert.doesNotMatch(nextCyclePrompt, new RegExp(fixture.receiptId, "u"));
});
