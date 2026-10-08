import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  operationReceiptsTable,
  sourceChangesTable,
  runtimeInstancesTable,
} from "@workspace/db";
import { loadCompletionEvidence } from "./completion-evidence";

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
  return { agent, task, attemptId, logicalExecutionId };
}

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
