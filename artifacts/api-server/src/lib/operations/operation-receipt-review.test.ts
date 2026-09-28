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
  runtimeInstancesTable,
  operationReceiptsTable,
  activityEventsTable,
} from "@workspace/db";

test.after(() => closeDatabase());
test("exact receipt review survives the history cap, binds the root subtree and never writes or leaks raw evidence", async () => {
  const modulePath = "./operations-read-model";
  const model = await import(modulePath);
  assert.equal(typeof model.getProjectOperationReceipt, "function");
  await dbReady;
  const suffix = randomUUID();
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: suffix, role: "review", systemPrompt: "PRIVATE-PROMPT" })
    .returning();
  const [root, other] = await db
    .insert(tasksTable)
    .values([
      { title: "Root", brief: "PRIVATE-BRIEF", ownerAgentId: agent.id },
      { title: "Other", brief: "PRIVATE-OTHER", ownerAgentId: agent.id },
    ])
    .returning();
  const [child] = await db
    .insert(tasksTable)
    .values({
      title: "Child",
      brief: "child",
      parentTaskId: root.id,
      ownerAgentId: agent.id,
    })
    .returning();
  const runtimeId = `receipt-review-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "PRIVATE-HOST",
    processId: 1,
    buildVersion: "test",
    schedulerEnabled: true,
  });
  const attemptId = randomUUID(),
    logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: child.id,
    agentId: agent.id,
    workerInstanceId: runtimeId,
    leaseOwner: "PRIVATE-LEASE",
    attemptNumber: 1,
    cycleNumber: 0,
    state: "lost",
    logicalExecutionId,
  });
  const receiptId = randomUUID();
  const base = {
    canonicalVersion: 1,
    executionKind: "task_step" as const,
    logicalExecutionId,
    taskId: child.id,
    agentId: agent.id,
    originAttemptId: attemptId,
    sideEffectClass: "at_most_once" as const,
    state: "unknown" as const,
    reservedAt: new Date("2026-09-27T00:00:00Z"),
    finishedAt: new Date("2026-09-27T00:00:00Z"),
    toolName: "vm_run_command",
    argumentHash: "PRIVATE-ARGUMENT-HASH",
  };
  await db.insert(operationReceiptsTable).values({
    ...base,
    id: receiptId,
    replayKey: randomUUID(),
    operationKey: `op:v1:${randomUUID().replaceAll("-", "").padEnd(64, "a")}`,
    reservedAt: new Date("2020-01-01T00:00:00Z"),
  });
  await db.insert(operationReceiptsTable).values(
    Array.from({ length: 201 }, () => ({
      ...base,
      id: randomUUID(),
      replayKey: randomUUID(),
      operationKey: `op:v1:${randomUUID().replaceAll("-", "").padEnd(64, "b")}`,
    })),
  );
  const snapshot = await model.getProjectOperations({ rootTaskId: root.id });
  assert.equal(snapshot.truncation.receipts, true);
  assert.equal(
    snapshot.receipts.some((r: { id: string }) => r.id === receiptId),
    false,
  );
  const read = () =>
    model.getProjectOperationReceipt({ rootTaskId: root.id, receiptId });
  const initial = await read();
  assert.equal(initial.projectId, root.id);
  assert.equal(initial.receipt.id, receiptId);
  assert.equal(initial.receipt.reconciliation.eligible, true);
  assert.equal(initial.audit, null);
  assert.equal(JSON.stringify(initial).includes("PRIVATE-"), false);
  const auditAt = new Date("2026-09-27T00:00:00Z");
  await db
    .update(operationReceiptsTable)
    .set({
      reconciliationDecision: "confirmed_not_applied",
      reconciliationNote: "External record checked — 外部記錄",
      reconciliationActorId: "operator-public-id",
      reconciledAt: auditAt,
    })
    .where(eq(operationReceiptsTable.id, receiptId));
  const rowsBefore = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, receiptId));
  const eventsBefore = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.taskId, child.id));
  const reviewed = await read();
  assert.equal(reviewed.receipt.reconciliation.eligible, false);
  assert.deepEqual(reviewed.audit, {
    receiptId,
    state: "unknown",
    decision: "confirmed_not_applied",
    note: "External record checked — 外部記錄",
    actorId: "operator-public-id",
    reconciledAt: auditAt.toISOString(),
  });
  assert.equal(JSON.stringify(reviewed).includes("PRIVATE-"), false);
  await assert.rejects(
    model.getProjectOperationReceipt({ rootTaskId: other.id, receiptId }),
    model.OperationsReceiptNotFoundError,
  );
  await assert.rejects(
    model.getProjectOperationReceipt({
      rootTaskId: root.id,
      receiptId: "missing",
    }),
    model.OperationsReceiptNotFoundError,
  );
  await assert.rejects(
    model.getProjectOperationReceipt({ rootTaskId: child.id, receiptId }),
    model.OperationsRootRequiredError,
  );
  await assert.rejects(
    model.getProjectOperationReceipt({ rootTaskId: 2147483647, receiptId }),
    model.OperationsProjectNotFoundError,
  );
  assert.deepEqual(
    await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, receiptId)),
    rowsBefore,
  );
  assert.deepEqual(
    await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, child.id)),
    eventsBefore,
  );
});
