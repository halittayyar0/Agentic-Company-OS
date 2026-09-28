import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  approvalRequestsTable,
  db,
  dbReady,
  operationInvocationsTable,
  operationReceiptsTable,
  runtimeInstancesTable,
  tasksTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import {
  executeApprovedAction,
  finalizeSucceededApprovedActionReceipt,
  runDurableExternalEffect,
  persistApprovedActionOutcomeUnknown,
} from "./execute-tool";
import {
  canonicalArgumentHash,
  claimOperationInvocation,
  markOperationRunning,
  recoverInterruptedOperation,
  reserveOperation,
} from "./operation-receipts";
import { specialistPermissionsPreset } from "./permission-presets";
import { reviveAndReleaseStaleWork } from "./scheduler";
import { WORKSPACE_LOCALES } from "../workspace-locale";
import { terminalMessage } from "../vm/terminal-localization";

const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });

test("the approved-action production wrapper converges unknown after both finalization writes lose the database", async () => {
  await dbReady;
  const suffix = randomUUID();
  const runtimeId = `approved-wrapper-outage-${suffix}`;
  const initialNow = new Date();
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "approved-wrapper-outage-test",
    processId: 7_303,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: initialNow,
  });
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Approved wrapper outage ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: {
        ...specialistPermissionsPreset,
        canUseTerminal: true,
      },
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Approved wrapper outage ${suffix}`,
      brief: "Recover an unpersisted post-effect approved action.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const args = { command: `echo ${suffix}` };
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Approved wrapper outage",
      description: "Exercise the real durable wrapper failure chain.",
      status: "approved",
      resolvedAt: initialNow,
      expiresAt: new Date(initialNow.getTime() + 5 * 60_000),
      scope: {
        toolName: "vm_run_command",
        argsHash: canonicalArgumentHash(args),
        target: null,
      },
      actionPayload: {
        toolName: "vm_run_command",
        args,
        taskDisposition: "resume",
      },
    })
    .returning();

  let effects = 0;
  let completeAttempts = 0;
  let unknownAttempts = 0;
  const persistenceOutage = new Error(
    "synthetic approved-action PostgreSQL outage",
  );
  const first = await executeApprovedAction(approval.id, config, {
    runtimeInstanceId: runtimeId,
    executeAction: async (ctx) =>
      runDurableExternalEffect(
        ctx,
        {
          toolName: "vm_run_command",
          normalizedArgs: args,
          execute: async ({ startEffect }) => {
            await startEffect();
            effects += 1;
            return {
              result: {
                content: "approved effect completed",
                createdTasks: [],
                createdAgents: [],
                toolOutcome: "succeeded",
              },
              resultData: { ok: true, exitCode: 0, durationMs: 1 },
            };
          },
          onError: async () => ({
            content: "approved effect finalization failed",
            createdTasks: [],
            createdAgents: [],
            toolOutcome: "rejected",
          }),
        },
        {
          completeOperation: async () => {
            completeAttempts += 1;
            throw persistenceOutage;
          },
          markOperationUnknown: async () => {
            unknownAttempts += 1;
            throw persistenceOutage;
          },
        },
      ),
  });
  assert.equal(first.status, "approval_outcome_unknown");
  assert.equal(first.claimed, true);
  assert.equal(effects, 1);
  assert.equal(completeAttempts, 1);
  assert.equal(unknownAttempts, 1);

  const [runningReceipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.approvalId, approval.id));
  assert.equal(runningReceipt.state, "running");
  const [runningInvocation] = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.receiptId, runningReceipt.id));
  assert.equal(runningInvocation.state, "running");

  const recoveryNow = new Date(Date.now() + 1_000);
  const expiredAt = new Date(recoveryNow.getTime() - 1);
  await Promise.all([
    db
      .update(tasksTable)
      .set({ leaseExpiresAt: expiredAt })
      .where(eq(tasksTable.id, task.id)),
    db
      .update(agentsTable)
      .set({ runLeaseExpiresAt: expiredAt })
      .where(eq(agentsTable.id, agent.id)),
    db
      .update(operationInvocationsTable)
      .set({ leaseExpiresAt: expiredAt })
      .where(eq(operationInvocationsTable.id, runningInvocation.id)),
    db
      .update(runtimeInstancesTable)
      .set({ state: "healthy", lastHeartbeatAt: recoveryNow })
      .where(eq(runtimeInstancesTable.id, runtimeId)),
  ]);

  const recovered = await recoverInterruptedOperation({
    receiptId: runningReceipt.id,
    now: recoveryNow,
    runtimeStaleBefore: new Date(recoveryNow.getTime() - 15_000),
  });
  assert.equal(recovered.disposition, "unknown");
  assert.equal(recovered.receipt.state, "unknown");

  const replay = await executeApprovedAction(approval.id, config, {
    runtimeInstanceId: runtimeId,
    executeAction: async () => {
      effects += 1;
      throw new Error("replay must remain blocked");
    },
  });
  assert.equal(replay.status, "approval_outcome_unknown");
  assert.equal(replay.claimed, false);
  assert.equal(effects, 1);
});

async function createClaimedApprovedReceipt(started: boolean) {
  await dbReady;
  const suffix = randomUUID();
  const leaseOwner = `approval-recovery-${suffix}`;
  const now = new Date();
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Approval boundary ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(now.getTime() + 60_000),
      permissions: {
        ...specialistPermissionsPreset,
        canUseTerminal: true,
      },
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Approval boundary ${suffix}`,
      brief: "Exercise scheduler receipt recovery.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      createdByUser: true,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  const runtimeId = `approved-boundary-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "approved-boundary-test",
    processId: 7_302,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: now,
  });
  const args = { command: `echo ${suffix}` };
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Approval boundary",
      description: "Boundary recovery test.",
      status: "approved",
      resolvedAt: now,
      expiresAt: new Date(now.getTime() + 5 * 60_000),
      scope: {
        toolName: "vm_run_command",
        argsHash: canonicalArgumentHash(args),
        target: null,
      },
      actionPayload: {
        toolName: "vm_run_command",
        args,
        taskDisposition: "resume",
      },
    })
    .returning();
  const reservation = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "approved_action",
    logicalExecutionId: `approval:${approval.id}`,
    toolName: "vm_run_command",
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
    externalIdempotencyKey: null,
    now,
  });
  const invocationLeaseOwner = `operation-${suffix}`;
  const claim = await claimOperationInvocation({
    receiptId: reservation.receipt.id,
    executionKind: "approved_action",
    attemptId: null,
    workerInstanceId: runtimeId,
    modelToolCallId: null,
    leaseOwner: invocationLeaseOwner,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    taskLeaseOwner: null,
    agentLeaseOwner: leaseOwner,
    now,
  });
  assert.ok(claim.invocation);
  if (started) {
    await markOperationRunning({
      receiptId: reservation.receipt.id,
      invocationId: claim.invocation.id,
      leaseOwner: invocationLeaseOwner,
      now: new Date(now.getTime() + 1),
    });
  }
  const expiredAt = new Date(Date.now() - 60_000);
  await Promise.all([
    db
      .update(runtimeInstancesTable)
      .set({ state: "stale", lastHeartbeatAt: expiredAt })
      .where(eq(runtimeInstancesTable.id, runtimeId)),
    db
      .update(agentsTable)
      .set({ runLeaseExpiresAt: expiredAt })
      .where(eq(agentsTable.id, agent.id)),
    db
      .update(tasksTable)
      .set({ leaseExpiresAt: expiredAt })
      .where(eq(tasksTable.id, task.id)),
    db
      .update(operationInvocationsTable)
      .set({ leaseExpiresAt: expiredAt })
      .where(eq(operationInvocationsTable.id, claim.invocation.id)),
  ]);
  return {
    agent,
    task,
    approval,
    receipt: reservation.receipt,
    invocation: claim.invocation,
  };
}

test("Terminal finalization uses each saved execution locale and leaves original receipt evidence unchanged", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    for (const ok of [true, false]) {
      const fixture = await createClaimedApprovedReceipt(true);
      const data = {
        ok,
        exitCode: ok ? 0 : 2,
        durationMs: 7,
        taskDisposition: "complete",
        executionLocale: locale,
      };
      const [before] = await db
        .update(operationReceiptsTable)
        .set({ state: "succeeded", resultData: data, finishedAt: new Date() })
        .where(eq(operationReceiptsTable.id, fixture.receipt.id))
        .returning();
      const result = await finalizeSucceededApprovedActionReceipt({
        receiptId: fixture.receipt.id,
        recovery: true,
      });
      assert.equal(result.disposition, "finalized");
      assert.equal(result.status, ok ? "succeeded" : "failed");
      const expected = terminalMessage(
        locale,
        ok ? "approvedCompleted" : "approvedFailed",
        { tool: "vm_run_command", exitCode: data.exitCode },
      );
      assert.equal(result.summary, expected);
      const [task] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, fixture.task.id));
      assert.equal(ok ? task.resultSummary : task.lastError, expected);
      assert.equal(task.status, ok ? "completed" : "blocked");
      assert.equal(
        (
          await finalizeSucceededApprovedActionReceipt({
            receiptId: fixture.receipt.id,
            recovery: true,
          })
        ).disposition,
        "already_finalized",
      );
      const [after] = await db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.id, fixture.receipt.id));
      assert.deepEqual(after, before);
      const events = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, fixture.task.id));
      assert.equal(
        events.filter((event) => event.summary === expected).length,
        1,
      );
    }
  }
});

test("localized uncertain approved Terminal recovery writes once and preserves prior user text", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const fixture = await createClaimedApprovedReceipt(true);
    const source = "  Original 原文 {tool} $&\n\t";
    await db
      .update(approvalRequestsTable)
      .set({ decisionNote: source })
      .where(eq(approvalRequestsTable.id, fixture.approval.id));
    const input = {
      approvalId: fixture.approval.id,
      taskId: fixture.task.id,
      agentId: fixture.agent.id,
      leaseOwner: fixture.task.leaseOwner,
      locale,
      error: null,
    };
    await persistApprovedActionOutcomeUnknown(input);
    const [approval] = await db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, fixture.approval.id));
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, fixture.task.id));
    const expected = terminalMessage(locale, "approvedUnknown");
    assert.equal(task.lastError, expected);
    assert.equal(task.blockedReason, "approval_outcome_unknown");
    assert.equal(
      approval.decisionNote,
      `${source}\n[APPROVAL_OUTCOME_UNKNOWN] ${expected}`,
    );
    await persistApprovedActionOutcomeUnknown({
      ...input,
      locale: locale === "ar" ? "en" : "ar",
    });
    const [after] = await db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, fixture.approval.id));
    const events = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, fixture.task.id));
    assert.equal(after.decisionNote, approval.decisionNote);
    const unknownEvents = events.filter(
      (event) =>
        event.type === "error" &&
        event.detail?.approvalId === fixture.approval.id &&
        event.detail?.outcome === "unknown",
    );
    assert.equal(unknownEvents.length, 1);
    assert.equal(unknownEvents[0].summary, expected);
    assert.equal(
      unknownEvents[0].detail?.error,
      terminalMessage(locale, "unknownFinalization"),
    );
  }
});

test("a succeeded approved receipt remains retryable until recovery finalizes without replay", async () => {
  await dbReady;
  const suffix = randomUUID();
  const runtimeId = `approved-finalization-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "approved-finalization-test",
    processId: 7_301,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: new Date(),
  });
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Approved recovery agent ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: {
        ...specialistPermissionsPreset,
        canUseTerminal: true,
      },
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Approved finalization ${suffix}`,
      brief: "Recover the task transition without repeating its effect.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const args = { command: `echo ${suffix}` };
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Durable approved effect",
      description: "Execute exactly once and complete the task.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60_000),
      scope: {
        toolName: "vm_run_command",
        argsHash: canonicalArgumentHash(args),
        target: null,
      },
      actionPayload: {
        toolName: "vm_run_command",
        args,
        taskDisposition: "complete",
      },
    })
    .returning();

  let effectCount = 0;
  const injectedCrash = new Error("synthetic post-effect finalization crash");
  const first = await executeApprovedAction(approval.id, config, {
    locale: "tr",
    runtimeInstanceId: runtimeId,
    executeAction: async (ctx) =>
      runDurableExternalEffect(ctx, {
        toolName: "vm_run_command",
        normalizedArgs: args,
        execute: async ({ startEffect }) => {
          await startEffect();
          effectCount += 1;
          return {
            result: {
              content: "effect completed",
              createdTasks: [],
              createdAgents: [],
              toolOutcome: "succeeded",
            },
            resultData: { ok: true, exitCode: 0, durationMs: 1 },
          };
        },
        onError: async () => ({
          content: "effect failed",
          createdTasks: [],
          createdAgents: [],
          toolOutcome: "rejected",
        }),
      }),
    afterEffectBeforeFinalization: async () => {
      throw injectedCrash;
    },
  });
  assert.equal(first.status, "queued");
  assert.equal(effectCount, 1);

  const [[receiptAfterCrash], [approvalAfterCrash], [taskAfterCrash]] =
    await Promise.all([
      db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.approvalId, approval.id)),
      db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, approval.id)),
      db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    ]);
  assert.equal(receiptAfterCrash.state, "succeeded");
  assert.deepEqual(receiptAfterCrash.resultData, {
    executionLocale: "tr",
    ok: true,
    exitCode: 0,
    durationMs: 1,
    taskDisposition: "complete",
  });
  assert.ok(approvalAfterCrash.consumedAt);
  assert.equal(approvalAfterCrash.actionPayload, null);
  assert.equal(taskAfterCrash.status, "awaiting_approval");

  const expiredAt = new Date(Date.now() - 1_000);
  await Promise.all([
    db
      .update(tasksTable)
      .set({ leaseExpiresAt: expiredAt })
      .where(eq(tasksTable.id, task.id)),
    db
      .update(agentsTable)
      .set({ runLeaseExpiresAt: expiredAt })
      .where(eq(agentsTable.id, agent.id)),
  ]);

  await reviveAndReleaseStaleWork(config.workerStaleAfterMs, {
    finalizeApprovedActionReceipt: async () => {
      throw new Error("synthetic transient finalizer outage");
    },
  });
  const [[stillPendingTask], [stillRecoverableApproval]] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approval.id)),
  ]);
  assert.equal(
    stillPendingTask.status,
    "awaiting_approval",
    "a transient finalizer failure must leave definitive succeeded evidence retryable",
  );
  assert.doesNotMatch(
    stillRecoverableApproval.decisionNote ?? "",
    /APPROVAL_OUTCOME_UNKNOWN/u,
  );

  await reviveAndReleaseStaleWork(config.workerStaleAfterMs, {
    finalizeApprovedActionReceipt: async () => ({
      disposition: "conflict",
      approvalId: approval.id,
      taskId: task.id,
      toolName: "vm_run_command",
      status: "succeeded",
      summary: "synthetic finalization conflict",
    }),
  });
  const [[taskAfterConflict], [approvalAfterConflict]] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approval.id)),
  ]);
  assert.equal(
    taskAfterConflict.status,
    "awaiting_approval",
    "a finalization conflict must preserve the definitive succeeded receipt for a later tick",
  );
  assert.doesNotMatch(
    approvalAfterConflict.decisionNote ?? "",
    /APPROVAL_OUTCOME_UNKNOWN/u,
  );

  await reviveAndReleaseStaleWork(config.workerStaleAfterMs);
  const [recoveredTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.equal(recoveredTask.status, "completed");
  assert.equal(recoveredTask.progressPercent, 100);
  assert.equal(effectCount, 1);

  const directReplay = await finalizeSucceededApprovedActionReceipt({
    receiptId: receiptAfterCrash.id,
    recovery: true,
  });
  assert.equal(directReplay.disposition, "already_finalized");
  await reviveAndReleaseStaleWork(config.workerStaleAfterMs);
  assert.equal(effectCount, 1);

  const resolvedEvents = await db
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.taskId, task.id),
        eq(activityEventsTable.type, "approval_resolved"),
      ),
    );
  assert.equal(
    resolvedEvents.filter(
      (event) => event.detail?.receiptId === receiptAfterCrash.id,
    ).length,
    1,
  );
  assert.equal(resolvedEvents[0]?.detail?.recoveredFinalization, true);
});

test("a duplicate approved-action receipt never downgrades definitive succeeded evidence", async () => {
  await dbReady;
  const suffix = randomUUID();
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Duplicate receipt recovery ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: {
        ...specialistPermissionsPreset,
        canUseTerminal: true,
      },
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Duplicate approved receipt ${suffix}`,
      brief: "Keep definitive success even when receipt integrity is invalid.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const args = { command: `echo ${suffix}` };
  const argsHash = canonicalArgumentHash(args);
  const now = new Date();
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Duplicate durable evidence",
      description: "A duplicate receipt must not erase known success.",
      status: "approved",
      resolvedAt: now,
      consumedAt: now,
      expiresAt: new Date(now.getTime() + 5 * 60_000),
      scope: {
        toolName: "vm_run_command",
        argsHash,
        target: null,
      },
      actionPayload: null,
    })
    .returning();
  const succeededReceiptId = `approved-success-${suffix}`;
  await db.insert(operationReceiptsTable).values([
    {
      id: succeededReceiptId,
      canonicalVersion: 1,
      operationKey: `approved-success-operation-${suffix}`,
      replayKey: `approved-success-replay-${suffix}`,
      executionKind: "approved_action",
      logicalExecutionId: `approval:${approval.id}`,
      taskId: task.id,
      agentId: agent.id,
      approvalId: approval.id,
      sourceMessageId: null,
      originAttemptId: null,
      sideEffectClass: "approval_at_most_once",
      state: "succeeded",
      toolName: "vm_run_command",
      argumentHash: argsHash,
      externalIdempotencyKey: `approved-success-external-${suffix}`,
      startedAt: now,
      finishedAt: now,
      resultSummary: "safe duplicate receipt fixture",
      resultData: {
        ok: true,
        exitCode: 0,
        durationMs: 1,
        taskDisposition: "complete",
      },
    },
    {
      id: `approved-extra-${suffix}`,
      canonicalVersion: 1,
      operationKey: `approved-extra-operation-${suffix}`,
      replayKey: `approved-extra-replay-${suffix}`,
      executionKind: "approved_action",
      logicalExecutionId: `approval:${approval.id}`,
      taskId: task.id,
      agentId: agent.id,
      approvalId: approval.id,
      sourceMessageId: null,
      originAttemptId: null,
      sideEffectClass: "approval_at_most_once",
      state: "failed",
      toolName: "vm_run_command",
      argumentHash: argsHash,
      externalIdempotencyKey: `approved-extra-external-${suffix}`,
      finishedAt: now,
      failureKind: "duplicate_integrity_fixture",
      sanitizedError: "Synthetic duplicate receipt.",
    },
  ]);

  let finalizerCalls = 0;
  await reviveAndReleaseStaleWork(config.workerStaleAfterMs, {
    finalizeApprovedActionReceipt: async (input) => {
      finalizerCalls += 1;
      return finalizeSucceededApprovedActionReceipt(input);
    },
  });

  const [[recoveredTask], [recoveredApproval], [succeededReceipt], events] =
    await Promise.all([
      db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
      db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, approval.id)),
      db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.id, succeededReceiptId)),
      db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, task.id)),
    ]);
  assert.equal(finalizerCalls, 1);
  assert.equal(succeededReceipt.state, "succeeded");
  assert.equal(recoveredTask.status, "completed");
  assert.equal(recoveredTask.progressPercent, 100);
  assert.doesNotMatch(
    recoveredApproval.decisionNote ?? "",
    /APPROVAL_OUTCOME_UNKNOWN/u,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "approval_resolved" &&
        event.detail?.receiptId === succeededReceiptId &&
        event.detail?.recoveredFinalization === true,
    ),
    true,
  );
});

test("a stale pre-effect approved claim is reclaimed and remains queued", async () => {
  const fixture = await createClaimedApprovedReceipt(false);
  await reviveAndReleaseStaleWork(config.workerStaleAfterMs);

  const [[receipt], [invocation], [approval], [task]] = await Promise.all([
    db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, fixture.receipt.id)),
    db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.id, fixture.invocation.id)),
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, fixture.approval.id)),
    db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
  ]);
  assert.equal(receipt.state, "reserved");
  assert.equal(invocation.state, "failed");
  assert.equal(invocation.failureKind, "pre_effect_owner_lost");
  assert.equal(approval.consumedAt, null);
  assert.ok(approval.actionPayload);
  assert.equal(task.status, "awaiting_approval");
  assert.equal(task.leaseOwner, null);
});

test("a stale approved at-most-once effect becomes unknown and blocks replay", async () => {
  const fixture = await createClaimedApprovedReceipt(true);
  await reviveAndReleaseStaleWork(config.workerStaleAfterMs);

  const [[receipt], [invocation], [approval], [task], events] =
    await Promise.all([
      db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.id, fixture.receipt.id)),
      db
        .select()
        .from(operationInvocationsTable)
        .where(eq(operationInvocationsTable.id, fixture.invocation.id)),
      db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, fixture.approval.id)),
      db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
      db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, fixture.task.id)),
    ]);
  assert.equal(receipt.state, "unknown");
  assert.equal(invocation.state, "unknown");
  assert.ok(approval.consumedAt);
  assert.equal(approval.actionPayload, null);
  assert.equal(task.status, "blocked");
  assert.equal(task.blockedReason, "approval_outcome_unknown");
  assert.equal(
    events.some(
      (event) =>
        event.detail?.receiptId === receipt.id &&
        event.detail?.replayBlocked === true,
    ),
    true,
  );
});
