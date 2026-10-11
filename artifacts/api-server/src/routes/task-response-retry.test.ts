import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  activityEventsTable,
  runtimeControlsTable,
  usageEventsTable,
  approvalRequestsTable,
  operationReceiptsTable,
  inferenceAttemptsTable,
} from "@workspace/db";
import app from "../app";
import {
  recoveryParentForTask,
  createTaskAttempt,
} from "../lib/orchestrator/task-attempt-store";

test.after(() => closeDatabase());

test("accounting-blocked work requires settled usage and explicit retry before preserving its logical execution", async (t) => {
  const f = await fixture(t);
  await db
    .update(taskAttemptsTable)
    .set({ failureKind: "inference_accounting" })
    .where(eq(taskAttemptsTable.id, f.attemptId));
  const id = randomUUID(),
    now = new Date();
  await db.insert(inferenceAttemptsTable).values({
    id,
    agentId: f.owner.id,
    taskId: f.task.id,
    scopeKey: `task:${f.task.id}`,
    modelId: "ollama:fixture-model",
    provider: "ollama",
    kind: "task_step",
    state: "uncertain",
    dispatchedAt: now,
    settledAt: now,
    requestDeadlineAt: now,
  });
  assert.equal((await f.request()).data.canRetry, false);
  assert.equal((await f.request("POST", f.body)).status, 409);
  const [usage] = await db
    .insert(usageEventsTable)
    .values({
      ordinaryInferenceId: id,
      agentId: f.owner.id,
      taskId: f.task.id,
      modelId: "ollama:fixture-model",
      provider: "ollama",
      kind: "task_step",
      totalTokens: 7,
      promptTokens: 4,
      completionTokens: 3,
      usageReported: true,
    })
    .returning();
  await db
    .update(inferenceAttemptsTable)
    .set({ state: "accounted", settledAt: now })
    .where(eq(inferenceAttemptsTable.id, id));
  const next = { ...f.task, stepAttempts: 2, leaseOwner: "fresh-recovery" };
  assert.equal(await recoveryParentForTask(next), null);
  assert.equal((await f.request()).data.canRetry, true);
  assert.equal((await f.read()).status, "blocked");
  assert.equal((await f.request("POST", f.body)).status, 200);
  assert.equal(await recoveryParentForTask(next), f.attemptId);
  const [before] = await db
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.id, f.attemptId));
  const recovered = await createTaskAttempt({
    task: next,
    workerInstanceId: before.workerInstanceId,
    recoveryOfAttemptId: f.attemptId,
  });
  assert.equal(recovered.logicalExecutionId, before.logicalExecutionId);
  assert.deepEqual(
    (
      await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.id, usage.id))
    )[0],
    usage,
  );
});
async function fixture(t: test.TestContext, continuous = false) {
  await dbReady;
  const [owner] = await db
    .insert(agentsTable)
    .values({
      name: "Response retry fixture",
      role: "Test",
      systemPrompt: "Test",
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      ownerAgentId: owner!.id,
      title: "Original work",
      brief: "Retain exact original work.",
      status: "blocked",
      blockedReason: "runtime_failure",
      lastError: "Response cut short",
      stepAttempts: 1,
      cycleCount: 2,
      tokensUsed: 42,
      executionModelId: "ollama:fixture-model",
      autonomyMode: continuous ? "continuous" : "finite",
      cadenceSeconds: continuous ? 3600 : null,
    })
    .returning();
  const worker = randomUUID(),
    attemptId = randomUUID();
  await db.insert(runtimeInstancesTable).values({
    id: worker,
    role: "worker",
    state: "stopped",
    hostname: "owned",
    processId: 1,
    buildVersion: "fixture",
  });
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task!.id,
    agentId: owner!.id,
    workerInstanceId: worker,
    leaseOwner: "ended",
    attemptNumber: 1,
    cycleNumber: 2,
    state: "blocked",
    finishedAt: new Date(),
    failureKind: "model_response_incomplete",
  });
  await db.insert(usageEventsTable).values({
    agentId: owner!.id,
    taskId: task!.id,
    kind: "task_step",
    modelId: "ollama:fixture-model",
    provider: "ollama",
    totalTokens: 42,
    usageReported: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const request = async (
    method = "GET",
    body?: unknown,
    id = task!.id,
    suffix = "",
  ) => {
    const response = await fetch(
      `${origin}/api/tasks/${id}/response-retry${suffix}`,
      {
        method,
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    const raw = await response.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    return { status: response.status, data };
  };
  const receipts = () =>
    db
      .select()
      .from(activityEventsTable)
      .where(
        and(
          eq(activityEventsTable.taskId, task!.id),
          eq(activityEventsTable.type, "task_status_changed"),
        ),
      );
  const read = async () =>
    (await db.select().from(tasksTable).where(eq(tasksTable.id, task!.id)))[0]!;
  return {
    owner: owner!,
    task: task!,
    attemptId,
    request,
    receipts,
    read,
    body: { blockedAttemptId: attemptId, acknowledge: true },
  };
}

for (const continuous of [false, true]) {
  test(`${continuous ? "continuous" : "finite"} response retry is read-only until explicit acknowledgement and preserves scope`, async (t) => {
    const f = await fixture(t, continuous);
    const snapshot = await f.request();
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.data.canRetry, true);
    assert.equal(snapshot.data.blockedAttemptId, f.attemptId);
    assert.deepEqual(await f.read(), f.task);
    assert.equal((await f.receipts()).length, 0);
    const accepted = await f.request("POST", f.body);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.outcome, "accepted");
    assert.equal(accepted.data.blockedAttemptId, f.attemptId);
    const resumed = await f.read();
    assert.equal(resumed.status, "in_progress");
    assert.equal(resumed.blockedReason, null);
    assert.ok(resumed.nextAttemptAt);
    for (const key of [
      "brief",
      "ownerAgentId",
      "executionModelId",
      "tokensUsed",
      "cycleCount",
      "stepAttempts",
      "cadenceSeconds",
      "autonomyMode",
      "completionRequirements",
    ] as const)
      assert.deepEqual(resumed[key], f.task[key], key);
    const usages = await db
      .select()
      .from(usageEventsTable)
      .where(eq(usageEventsTable.taskId, f.task.id));
    assert.equal(usages.length, 1);
    assert.equal(usages[0]!.totalTokens, 42);
    assert.equal((await f.receipts()).length, 1);
  });
}
test("parallel duplicate recovery returns one historical receipt and cannot requeue a later cancelled task", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([
    f.request("POST", f.body),
    f.request("POST", f.body),
  ]);
  assert.equal(results[0]!.status, 200);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await f.receipts()).length, 1);
  await db
    .update(tasksTable)
    .set({ status: "cancelled", blockedReason: null, nextAttemptAt: null })
    .where(eq(tasksTable.id, f.task.id));
  const replay = await f.request("POST", f.body);
  assert.deepEqual(replay, results[0]);
  assert.deepEqual(
    await f.request("GET", undefined, f.task.id, `/${f.attemptId}`),
    replay,
  );
  assert.equal((await f.read()).status, "cancelled");
  assert.equal((await f.receipts()).length, 1);
});
test("recovery identity is scoped to one task and receipt lookup never queues work", async (t) => {
  const f = await fixture(t),
    other = await fixture(t);
  assert.equal(
    (await f.request("GET", undefined, f.task.id, `/${f.attemptId}`)).status,
    404,
  );
  assert.deepEqual(await f.read(), f.task);
  assert.equal((await f.request("POST", f.body, other.task.id)).status, 409);
  assert.equal((await f.request("POST", f.body)).status, 200);
  assert.equal(
    (await f.request("GET", undefined, other.task.id, `/${f.attemptId}`))
      .status,
    404,
  );
  assert.deepEqual(await other.read(), other.task);
});
for (const kind of [
  "pending_approval",
  "unknown_operation",
  "cancelled_ancestor",
] as const) {
  test(`response retry cannot bypass ${kind}`, async (t) => {
    const f = await fixture(t);
    if (kind === "cancelled_ancestor") {
      const [parent] = await db
        .insert(tasksTable)
        .values({
          title: "Cancelled parent",
          brief: "Test",
          ownerAgentId: f.owner.id,
          status: "cancelled",
        })
        .returning();
      await db
        .update(tasksTable)
        .set({ parentTaskId: parent!.id })
        .where(eq(tasksTable.id, f.task.id));
    } else {
      const [approval] = await db
        .insert(approvalRequestsTable)
        .values({
          taskId: f.task.id,
          agentId: f.owner.id,
          category: "other",
          title: "Protected action",
          description: "Test",
          status: kind === "pending_approval" ? "pending" : "approved",
          consumedAt: kind === "unknown_operation" ? new Date() : null,
        })
        .returning();
      if (kind === "unknown_operation")
        await db.insert(operationReceiptsTable).values({
          id: randomUUID(),
          operationKey: randomUUID(),
          replayKey: randomUUID(),
          logicalExecutionId: randomUUID(),
          taskId: f.task.id,
          agentId: f.owner.id,
          approvalId: approval!.id,
          executionKind: "approved_action",
          sideEffectClass: "at_most_once",
          state: "unknown",
          finishedAt: new Date(),
          toolName: "fixture",
          argumentHash: "a".repeat(64),
        });
    }
    const before = await f.read();
    assert.equal((await f.request("POST", f.body)).status, 409);
    assert.deepEqual(await f.read(), before);
    assert.equal((await f.receipts()).length, 0);
  });
}
for (const change of [
  "stale_attempt",
  "owner_inactive",
  "live_lease",
  "different_reason",
  "different_failure",
  "later_cycle",
  "emergency_stop",
] as const) {
  test(`response retry rejects ${change} without changing task or creating usage`, async (t) => {
    const f = await fixture(t);
    if (change === "owner_inactive")
      await db
        .update(agentsTable)
        .set({ isActive: false })
        .where(eq(agentsTable.id, f.owner.id));
    if (change === "live_lease")
      await db
        .update(tasksTable)
        .set({
          leaseOwner: "owned-live",
          leaseExpiresAt: new Date(Date.now() + 60000),
        })
        .where(eq(tasksTable.id, f.task.id));
    if (change === "different_reason")
      await db
        .update(tasksTable)
        .set({ blockedReason: "approval_outcome_unknown" })
        .where(eq(tasksTable.id, f.task.id));
    if (change === "different_failure")
      await db
        .update(taskAttemptsTable)
        .set({ failureKind: "runtime" })
        .where(eq(taskAttemptsTable.id, f.attemptId));
    if (change === "later_cycle")
      await db
        .update(tasksTable)
        .set({ cycleCount: 3 })
        .where(eq(tasksTable.id, f.task.id));
    if (change === "emergency_stop") {
      await db
        .update(runtimeControlsTable)
        .set({ emergencyStopEnabled: true })
        .where(eq(runtimeControlsTable.id, 1));
      t.after(() =>
        db
          .update(runtimeControlsTable)
          .set({ emergencyStopEnabled: false })
          .where(eq(runtimeControlsTable.id, 1)),
      );
    }
    const before = await f.read();
    const result = await f.request(
      "POST",
      change === "stale_attempt"
        ? { ...f.body, blockedAttemptId: randomUUID() }
        : f.body,
    );
    assert.equal(result.status, 409);
    assert.deepEqual(await f.read(), before);
    assert.equal((await f.receipts()).length, 0);
    const usages = await db
      .select()
      .from(usageEventsTable)
      .where(eq(usageEventsTable.taskId, f.task.id));
    assert.equal(usages.length, 1);
  });
}
test("response retry requires an exact attempt identity and explicit acknowledgement", async (t) => {
  const f = await fixture(t);
  for (const body of [
    {},
    { blockedAttemptId: f.attemptId },
    { ...f.body, acknowledge: false },
    { ...f.body, executionModelId: "other" },
  ])
    assert.equal((await f.request("POST", body)).status, 400);
  assert.deepEqual(await f.read(), f.task);
});

test("acknowledged response recovery retains the original logical execution for effect deduplication", async (t) => {
  const f = await fixture(t);
  const [before] = await db
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.id, f.attemptId));
  const next = { ...f.task, stepAttempts: 2, leaseOwner: "new-owned-lease" };
  assert.equal(
    await recoveryParentForTask(next),
    null,
    "unacknowledged blocked work cannot become a recovery parent",
  );
  await assert.rejects(() =>
    createTaskAttempt({
      task: next,
      workerInstanceId: before!.workerInstanceId,
      recoveryOfAttemptId: f.attemptId,
    }),
  );
  assert.equal((await f.request("POST", f.body)).status, 200);
  assert.equal(await recoveryParentForTask(next), f.attemptId);
  const recovered = await createTaskAttempt({
    task: next,
    workerInstanceId: before!.workerInstanceId,
    recoveryOfAttemptId: f.attemptId,
  });
  assert.equal(recovered.logicalExecutionId, before!.logicalExecutionId);
  assert.equal(recovered.recoveryOfAttemptId, before!.id);
  assert.deepEqual(
    (
      await db
        .select()
        .from(taskAttemptsTable)
        .where(eq(taskAttemptsTable.id, f.attemptId))
    )[0],
    before,
    "original blocked attempt remains an immutable historical outcome",
  );
});

test("retry preserves automatic routing without secretly pinning the last attempted model", async (t) => {
  const f = await fixture(t);
  await db
    .update(tasksTable)
    .set({
      executionModelId: null,
      lastModelId: "ollama:old-model",
      lastModelProvider: "ollama",
    })
    .where(eq(tasksTable.id, f.task.id));
  const before = await f.read();
  assert.equal((await f.request("POST", f.body)).status, 200);
  const after = await f.read();
  assert.equal(after.executionModelId, null);
  assert.equal(after.lastModelId, before.lastModelId);
  assert.equal(after.lastModelProvider, before.lastModelProvider);
  assert.equal(after.tokensUsed, before.tokensUsed);
});
