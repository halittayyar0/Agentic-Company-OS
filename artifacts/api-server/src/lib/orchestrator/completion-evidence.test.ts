import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  operationReceiptsTable,
  approvalRequestsTable,
  sourceChangesTable,
  runtimeInstancesTable,
} from "@workspace/db";
import { loadCompletionEvidence } from "./completion-evidence";
import { canonicalArgumentHash } from "./operation-receipts";

test.after(() => closeDatabase());
async function fixture() {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Delivery evidence fixture",
      role: "Engineer",
      systemPrompt: "Fixture",
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Delivery fixture",
      brief: "Fixture",
      ownerAgentId: agent.id,
    })
    .returning();
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  const workerInstanceId = randomUUID();
  await db.insert(runtimeInstancesTable).values({
    id: workerInstanceId,
    role: "worker",
    state: "healthy",
    hostname: "fixture",
    processId: process.pid,
    buildVersion: "fixture",
    lastHeartbeatAt: new Date(),
  });
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId,
    leaseOwner: randomUUID(),
    attemptNumber: 1,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
  });
  return { agent, task, attemptId, logicalExecutionId, workerInstanceId };
}

test("completion tool counts include earlier actions beyond the sample and isolate task, cycle and approval scope", async () => {
  const f = await fixture();
  const other = await fixture();
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      agentId: f.agent.id,
      taskId: f.task.id,
      category: "other",
      title: "PRIVATE_title",
      description: "PRIVATE_description",
    })
    .returning();
  const nextAttempt = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: nextAttempt,
    taskId: f.task.id,
    agentId: f.agent.id,
    workerInstanceId: f.workerInstanceId,
    leaseOwner: randomUUID(),
    attemptNumber: 2,
    cycleNumber: 1,
    state: "running",
    logicalExecutionId: randomUUID(),
  });
  const insert = async (
    toolName: string,
    extra: Partial<typeof operationReceiptsTable.$inferInsert> = {},
  ) => {
    const id = randomUUID();
    await db.insert(operationReceiptsTable).values({
      id,
      operationKey: id,
      replayKey: null,
      executionKind: "task_step",
      logicalExecutionId: f.logicalExecutionId,
      taskId: f.task.id,
      agentId: f.agent.id,
      originAttemptId: f.attemptId,
      sideEffectClass: "read_only",
      state: "succeeded",
      toolName,
      argumentHash: "0".repeat(64),
      resultData: { output: "PRIVATE_output", ok: true },
      reservedAt: new Date(Date.now() - 60_000),
      finishedAt: new Date(),
      ...extra,
    });
  };
  await insert("calculate");
  await insert("calculate", { state: "failed" });
  await insert("calculate", {
    state: "unknown",
    reconciliationDecision: "confirmed_applied",
    reconciliationNote: "PRIVATE_reconciliation",
    reconciliationActorId: "PRIVATE_operator",
    reconciledAt: new Date(),
  });
  for (let index = 0; index < 16; index++)
    await insert("log_note", { reservedAt: new Date(Date.now() + index) });
  await insert("request_approval", {
    executionKind: "approved_action",
    originAttemptId: null,
    approvalId: approval.id,
    reservedAt: new Date(Date.now() + 100),
  });
  await insert("web_search", {
    executionKind: "approved_action",
    originAttemptId: null,
    approvalId: approval.id,
    reservedAt: new Date(f.task.createdAt.getTime() - 1000),
  });
  await insert("calculate", { originAttemptId: nextAttempt });
  await insert("calculate", {
    taskId: other.task.id,
    agentId: other.agent.id,
    originAttemptId: other.attemptId,
  });
  await insert("complete_task");
  const evidence = await loadCompletionEvidence(f.task);
  assert.equal(evidence.receiptTotal, 20);
  assert.equal(evidence.receipts.length, 12);
  assert.equal(evidence.receiptsTruncated, true);
  assert.ok(evidence.receipts.every((row) => row.tool !== "calculate"));
  assert.equal(evidence.toolCountsTruncated, false);
  assert.deepEqual(evidence.toolCounts, [
    {
      tool: "calculate",
      state: "failed",
      reconciliationDecision: null,
      count: 1,
    },
    {
      tool: "calculate",
      state: "succeeded",
      reconciliationDecision: null,
      count: 1,
    },
    {
      tool: "calculate",
      state: "unknown",
      reconciliationDecision: "confirmed_applied",
      count: 1,
    },
    {
      tool: "log_note",
      state: "succeeded",
      reconciliationDecision: null,
      count: 16,
    },
    {
      tool: "request_approval",
      state: "succeeded",
      reconciliationDecision: null,
      count: 1,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_/);
});

test("completion tool counts stay bounded and disclose omitted or malformed names", async () => {
  const f = await fixture();
  for (let index = 0; index < 130; index++) {
    const id = randomUUID();
    await db.insert(operationReceiptsTable).values({
      id,
      operationKey: id,
      replayKey: null,
      executionKind: "task_step",
      logicalExecutionId: f.logicalExecutionId,
      taskId: f.task.id,
      agentId: f.agent.id,
      originAttemptId: f.attemptId,
      sideEffectClass: "read_only",
      state: "succeeded",
      toolName:
        index === 0
          ? "../../PRIVATE_invalid_tool"
          : `custom_${String(index).padStart(3, "0")}`,
      argumentHash: "0".repeat(64),
      resultData: { text: "PRIVATE_output" },
      finishedAt: new Date(),
    });
  }
  const evidence = await loadCompletionEvidence(f.task);
  assert.equal(evidence.receiptTotal, 130);
  assert.equal(evidence.toolCountsTruncated, true);
  assert.ok(evidence.toolCounts.length <= 128);
  assert.ok(
    evidence.toolCounts.every((row) =>
      /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/u.test(row.tool),
    ),
  );
  assert.doesNotMatch(JSON.stringify(evidence.toolCounts), /PRIVATE_/);
});

async function calculationReceipt(
  f: Awaited<ReturnType<typeof fixture>>,
  extra: Partial<typeof operationReceiptsTable.$inferInsert> = {},
) {
  const id = randomUUID();
  const now = new Date();
  await db.insert(operationReceiptsTable).values({
    id,
    operationKey: id,
    replayKey: null,
    executionKind: "task_step",
    logicalExecutionId: f.logicalExecutionId,
    taskId: f.task.id,
    agentId: f.agent.id,
    originAttemptId: f.attemptId,
    sideEffectClass: "read_only",
    state: "succeeded",
    toolName: "calculate",
    argumentHash: canonicalArgumentHash({
      operation: "multiply",
      values: [3, 19.5],
    }),
    resultData: {
      calculation: {
        schemaVersion: 1,
        operation: "multiply",
        values: [3, 19.5],
        value: 58.5,
        arithmetic: "IEEE-754",
      },
    },
    reservedAt: new Date(now.getTime() - 1),
    finishedAt: now,
    ...extra,
  });
}

test("numeric completion evidence requires exact successful task-cycle binding and rejects unsafe saved data", async () => {
  const f = await fixture();
  await calculationReceipt(f, {
    resultData: {
      executionLocale: "en",
      privateOutput: "PRIVATE_output",
      calculation: {
        schemaVersion: 1,
        operation: "multiply",
        values: [3, 19.5],
        value: 58.5,
        arithmetic: "IEEE-754",
      },
    },
  });
  const accepted = await loadCompletionEvidence(f.task);
  assert.deepEqual(
    (accepted.receipts[0] as unknown as { calculation: unknown }).calculation,
    {
      proofScope: "bounded_calculation",
      schemaVersion: 1,
      operation: "multiply",
      values: [3, 19.5],
      value: 58.5,
      arithmetic: "IEEE-754",
    },
  );
  assert.doesNotMatch(JSON.stringify(accepted), /PRIVATE_/u);
  const other = await fixture();
  const invalid: Array<Partial<typeof operationReceiptsTable.$inferInsert>> = [
    {
      resultData: {
        ok: false,
        calculation: {
          schemaVersion: 1,
          operation: "multiply",
          values: [3, 19.5],
          value: 58.5,
          arithmetic: "IEEE-754",
        },
      },
    },
    { state: "failed" },
    { state: "unknown" },
    {
      state: "unknown",
      reconciliationDecision: "confirmed_applied",
      reconciliationNote: "PRIVATE_reconciliation",
      reconciliationActorId: "PRIVATE_actor",
      reconciledAt: new Date(),
    },
    { sideEffectClass: "transactional", replayKey: randomUUID() },
    { state: "running", startedAt: new Date(), finishedAt: null },
    { finishedAt: new Date(Date.now() + 60000) },
    { reservedAt: new Date(Date.now() + 60000) },
    { logicalExecutionId: randomUUID() },
    { agentId: other.agent.id },
    { originAttemptId: other.attemptId },
    { toolName: "vm_read_file" },
    { argumentHash: "0".repeat(64) },
    ...[
      null,
      42,
      [],
      { values: "PRIVATE_values" },
      {
        schemaVersion: 1,
        operation: "multiply",
        values: [3, 19.5],
        value: "PRIVATE_value",
        arithmetic: "IEEE-754",
      },
      {
        schemaVersion: 1,
        operation: "multiply",
        values: [3, "PRIVATE_operand"],
        value: 58.5,
        arithmetic: "IEEE-754",
      },
      {
        schemaVersion: 1,
        operation: "multiply",
        values: Array(9).fill(1),
        value: 1,
        arithmetic: "IEEE-754",
      },
      {
        schemaVersion: 1,
        operation: "multiply",
        values: [3, 19.5],
        value: 59,
        arithmetic: "IEEE-754",
      },
      {
        schemaVersion: 1,
        operation: "multiply",
        values: [3, 19.5],
        value: 58.5,
        arithmetic: "IEEE-754",
        private: "PRIVATE_metadata",
      },
    ].map((calculation) => ({ resultData: { calculation } })),
  ];
  for (const extra of invalid) {
    const isolated = await fixture();
    await calculationReceipt(isolated, extra);
    const evidence = await loadCompletionEvidence(isolated.task);
    assert.ok(
      evidence.receipts.every((row) => !("calculation" in row)),
      JSON.stringify(extra),
    );
    assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_/u);
  }
  const later = await fixture();
  await db
    .update(taskAttemptsTable)
    .set({ cycleNumber: 1 })
    .where(eq(taskAttemptsTable.id, later.attemptId));
  await calculationReceipt(later);
  assert.equal((await loadCompletionEvidence(later.task)).receiptTotal, 0);
});

test("numeric completion evidence retains the original twelve-receipt sample and truncation disclosure", async () => {
  const f = await fixture();
  for (let index = 0; index < 13; index++)
    await calculationReceipt(f, {
      reservedAt: new Date(Date.now() - 1000 + index),
      finishedAt: new Date(),
    });
  const evidence = await loadCompletionEvidence(f.task);
  assert.equal(evidence.receiptTotal, 13);
  assert.equal(evidence.receipts.length, 12);
  assert.equal(evidence.receiptsTruncated, true);
  assert.ok(evidence.receipts.every((row) => "calculation" in row));
  assert.deepEqual(evidence.toolCounts, [
    {
      tool: "calculate",
      state: "succeeded",
      reconciliationDecision: null,
      count: 13,
    },
  ]);
});

test("native turn receipts cannot advertise deliverable proof or copy private native transcripts into completion review", async () => {
  const f = await fixture();
  const id = randomUUID();
  await db.insert(operationReceiptsTable).values({
    id,
    operationKey: id,
    replayKey: id,
    executionKind: "task_step",
    logicalExecutionId: f.logicalExecutionId,
    taskId: f.task.id,
    agentId: f.agent.id,
    originAttemptId: f.attemptId,
    sideEffectClass: "at_most_once",
    state: "succeeded",
    toolName: "vm_codex_task",
    argumentHash: "0".repeat(64),
    startedAt: new Date(),
    finishedAt: new Date(),
    resultData: {
      proofScope: "PRIVATE_forged_deliverable",
      deliverableVerified: true,
      nativeItemCount: 3,
      ok: true,
      exitCode: 0,
      byteCount: 12,
      artifactId: randomUUID(),
      text: "PRIVATE_transcript",
      threadId: "PRIVATE_thread",
      actions: [{ command: "PRIVATE_command" }],
    },
  });
  const evidence = await loadCompletionEvidence(f.task);
  assert.equal(evidence.receipts[0].proofScope, "codex_turn");
  assert.equal(evidence.receipts[0].deliverableVerified, false);
  assert.equal(evidence.receipts[0].nativeItemCount, 3);
  for (const field of ["ok", "exitCode", "byteCount", "artifactId"])
    assert.ok(!(field in evidence.receipts[0]), field);
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_/);
});

test("source review carries bounded frozen snapshot checks separately from application, rollback and stale cycles", async () => {
  const f = await fixture();
  const baseCommit = "1".repeat(40),
    candidateCommit = "2".repeat(40);
  const insert = async (state: string, extra: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await db.insert(sourceChangesTable).values({
      id,
      agentId: f.agent.id,
      taskId: f.task.id,
      sourcePath: "/PRIVATE_original",
      candidatePath: "/PRIVATE_candidate",
      request: "PRIVATE_request",
      baseCommit,
      candidateCommit,
      state,
      check: {
        command: ["PRIVATE_command"],
        exitCode: 0,
        output: "PRIVATE_output",
        passed: true,
      },
      ...extra,
    });
    return id;
  };
  const verified = await insert("verified");
  const applied = await insert("applied", { appliedCommit: candidateCommit });
  const rolledBack = await insert("rolled_back", {
    appliedCommit: candidateCommit,
  });
  const unknown = await insert("unknown", { appliedCommit: candidateCommit });
  const malformed = await insert("verified", {
    candidateCommit: "PRIVATE_invalid_oid",
  });
  await insert("verified", { taskId: f.task.id + 1000 });
  const evidence = await loadCompletionEvidence(f.task);
  assert.equal(evidence.sourceChangeTotal, 5);
  const rows = evidence.sourceChanges;
  assert.equal(
    rows.find((row) => row.id === verified)?.snapshotChecksPassed,
    true,
  );
  assert.equal(
    rows.find((row) => row.id === verified)?.applicationRecorded,
    false,
  );
  assert.equal(
    rows.find((row) => row.id === applied)?.applicationRecorded,
    true,
  );
  assert.equal(
    rows.find((row) => row.id === rolledBack)?.applicationRecorded,
    false,
  );
  assert.equal(
    rows.find((row) => row.id === unknown)?.snapshotChecksPassed,
    false,
  );
  assert.equal(
    rows.find((row) => row.id === malformed)?.snapshotChecksPassed,
    false,
  );
  assert.ok(rows.every((row) => row.proofScope === "frozen_source_snapshot"));
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_/);
  const nextCycle = await loadCompletionEvidence({
    ...f.task,
    cycleCount: 1,
    lastCycleCompletedAt: new Date(Date.now() + 1000),
  });
  assert.equal(nextCycle.sourceChangeTotal, 0);
});

test("source delivery evidence reports full counts while truncating samples and rejects incomplete checks", async () => {
  const f = await fixture();
  for (let index = 0; index < 11; index++)
    await db.insert(sourceChangesTable).values({
      id: randomUUID(),
      agentId: f.agent.id,
      taskId: f.task.id,
      sourcePath: "/PRIVATE_original",
      request: "PRIVATE_request",
      state: "verified",
      baseCommit: "1".repeat(40),
      candidateCommit: "2".repeat(40),
      check: {
        command: [],
        exitCode: 0,
        output: "PRIVATE_output",
        passed: true,
      },
    });
  const evidence = await loadCompletionEvidence(f.task);
  assert.equal(evidence.sourceChangeTotal, 11);
  assert.equal(evidence.sourceChanges.length, 8);
  assert.equal(evidence.sourceChangesTruncated, true);
  assert.ok(evidence.sourceChanges.every((row) => !row.snapshotChecksPassed));
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_/);
});
