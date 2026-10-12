import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  operationReceiptsTable,
  runtimeInstancesTable,
  approvalRequestsTable,
  messagesTable,
} from "@workspace/db";
import { loadCompletionRequirementResults } from "./completion-requirements";

test.after(() => closeDatabase());
async function fixture(t: TestContext, tool = "calculate") {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Completion condition fixture",
      role: "Test",
      systemPrompt: "No inference",
    })
    .returning();
  t.after(async () => {
    await db
      .update(tasksTable)
      .set({ status: "cancelled" })
      .where(eq(tasksTable.ownerAgentId, agent.id));
    await db
      .update(agentsTable)
      .set({ isActive: false, status: "archived" })
      .where(eq(agentsTable.id, agent.id));
  });
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Owner operation condition",
      brief: "No inference",
      ownerAgentId: agent.id,
      completionRequirements: [{ kind: "tool_succeeded", tool }],
    })
    .returning();
  const workerInstanceId = randomUUID(),
    attemptId = randomUUID(),
    logicalExecutionId = randomUUID();
  await db.insert(runtimeInstancesTable).values({
    id: workerInstanceId,
    role: "worker",
    state: "healthy",
    hostname: "fixture",
    processId: process.pid,
    buildVersion: "fixture",
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
  const receipt = async (
    extra: Partial<typeof operationReceiptsTable.$inferInsert> = {},
  ) => {
    const id = randomUUID();
    await db.insert(operationReceiptsTable).values({
      id,
      operationKey: id,
      replayKey: null,
      executionKind: "task_step",
      logicalExecutionId,
      taskId: task.id,
      agentId: agent.id,
      originAttemptId: attemptId,
      sideEffectClass: "read_only",
      state: "succeeded",
      toolName: tool,
      argumentHash: "0".repeat(64),
      resultData: null,
      reservedAt: new Date(),
      finishedAt: new Date(),
      ...extra,
    });
    return id;
  };
  const satisfied = async (input = task) => {
    const result = await loadCompletionRequirementResults(input);
    assert.equal(JSON.stringify(result).includes("PRIVATE_"), false);
    assert.equal(result.requirements.length, 1);
    return result.requirements[0]!.satisfied;
  };
  return {
    agent,
    task,
    workerInstanceId,
    attemptId,
    logicalExecutionId,
    receipt,
    satisfied,
  };
}

test("completion requirements use exact success beyond receipt and tool aggregate sampling limits", async (t) => {
  const f = await fixture(t);
  await f.receipt({ resultData: { privateOutput: "PRIVATE_original_result" } });
  for (let i = 0; i < 140; i++)
    await f.receipt({ toolName: "aaa_unrelated_" + i });
  assert.equal(await f.satisfied(), true);
});

test("completion requirements reject incomplete failed uncertain reconciled and future observations", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.satisfied(), false);
  for (const extra of [
    { state: "reserved", finishedAt: null },
    { state: "running", startedAt: new Date(), finishedAt: null },
    { state: "failed" },
    {
      state: "unknown",
      reconciliationDecision: "confirmed_applied",
      reconciliationNote: "PRIVATE_note",
      reconciledAt: new Date(),
      reconciliationActorId: "PRIVATE_actor",
    },
    { state: "succeeded", resultData: { ok: false } },
    {
      state: "succeeded",
      reservedAt: new Date(Date.now() + 60_000),
      finishedAt: new Date(Date.now() + 61_000),
    },
  ] as const) {
    await f.receipt(extra);
    assert.equal(await f.satisfied(), false);
  }
  await assert.rejects(
    f.receipt({ finishedAt: null }),
    (error: unknown) =>
      error instanceof Error &&
      typeof error.cause === "object" &&
      error.cause !== null &&
      Reflect.get(error.cause, "constraint") ===
        "operation_receipts_state_timestamps_check",
  );
  await f.receipt();
  assert.equal(await f.satisfied(), true);
});

test("completion requirements isolate chat foreign tasks mismatched executions and previous or future cycles", async (t) => {
  const f = await fixture(t),
    other = await fixture(t);
  await f.receipt({
    taskId: other.task.id,
    originAttemptId: other.attemptId,
    logicalExecutionId: other.logicalExecutionId,
    agentId: other.agent.id,
  });
  await f.receipt({ logicalExecutionId: randomUUID() });
  assert.equal(await f.satisfied(), false);
  // A valid same-cycle result cannot be borrowed by either adjacent cycle.
  await f.receipt();
  assert.equal(await f.satisfied({ ...f.task, cycleCount: 1 }), false);
  assert.equal(await f.satisfied({ ...f.task, cycleCount: 2 }), false);
  assert.equal(await f.satisfied(), true);
  const [chatTask] = await db
    .insert(tasksTable)
    .values({
      title: "Chat receipt exclusion",
      brief: "No inference",
      ownerAgentId: f.agent.id,
      completionRequirements: f.task.completionRequirements,
    })
    .returning();
  const [message] = await db
    .insert(messagesTable)
    .values({ agentId: f.agent.id, role: "user", content: "PRIVATE_chat" })
    .returning();
  await f.receipt({
    taskId: chatTask.id,
    executionKind: "chat_turn",
    originAttemptId: null,
    sourceMessageId: message.id,
  });
  assert.equal(await f.satisfied(chatTask), false);
});

test("completion requirements require verified zero command exits and fresh approved actions", async (t) => {
  const f = await fixture(t, "vm_run_command");
  for (const resultData of [
    null,
    {},
    { ok: true },
    { ok: true, exitCode: 7 },
    { ok: false, exitCode: 0 },
    { ok: true, exitCode: "0" },
  ]) {
    await f.receipt({ resultData });
    assert.equal(await f.satisfied(), false);
  }
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
  const boundary = new Date(Date.now() - 60_000);
  await f.receipt({
    executionKind: "approved_action",
    approvalId: approval.id,
    originAttemptId: null,
    reservedAt: new Date(boundary.getTime() - 1),
    finishedAt: boundary,
    resultData: { ok: true, exitCode: 0 },
  });
  assert.equal(
    await f.satisfied({
      ...f.task,
      cycleCount: 1,
      lastCycleCompletedAt: boundary,
    }),
    false,
  );
  await f.receipt({
    executionKind: "approved_action",
    approvalId: approval.id,
    originAttemptId: null,
    resultData: { ok: true, exitCode: 0, output: "PRIVATE_terminal_output" },
  });
  assert.equal(
    await f.satisfied({
      ...f.task,
      cycleCount: 1,
      lastCycleCompletedAt: boundary,
    }),
    true,
  );
});
