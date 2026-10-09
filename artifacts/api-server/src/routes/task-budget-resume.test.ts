import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  usageEventsTable,
  activityEventsTable,
  runtimeControlsTable,
  approvalRequestsTable,
  operationReceiptsTable,
  taskBudgetResumeRequestsTable,
} from "@workspace/db";
import app from "../app";
import {
  resumeBudgetWithinTransaction,
  parseBudgetResumeReceipt,
} from "../lib/resume-task-budget";

test.after(() => closeDatabase());
async function listen(t: test.TestContext) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}
function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          Host: `127.0.0.1:${port}`,
          Origin: `http://127.0.0.1:${port}`,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data });
          }
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}
async function fixture() {
  await dbReady;
  const [owner] = await db
    .insert(agentsTable)
    .values({ name: "Budget owner", role: "Test", systemPrompt: "Test" })
    .returning();
  const [root] = await db
    .insert(tasksTable)
    .values({
      ownerAgentId: owner.id,
      title: "Budget root",
      brief: "Test",
      status: "blocked",
      blockedReason: "budget",
      tokensUsed: 20,
      lastError: "Budget exhausted",
    })
    .returning();
  const [child] = await db
    .insert(tasksTable)
    .values({
      ownerAgentId: owner.id,
      parentTaskId: root.id,
      title: "Budget child",
      brief: "Test",
      status: "blocked",
      blockedReason: "budget",
      tokensUsed: 10,
    })
    .returning();
  await db.insert(usageEventsTable).values({
    agentId: owner.id,
    taskId: root.id,
    kind: "judge",
    modelId: "fixture",
    provider: "fixture",
    totalTokens: 20,
    usageReported: true,
    reportedCostUsd: "0.01",
  });
  await db.insert(usageEventsTable).values({
    agentId: owner.id,
    taskId: child.id,
    kind: "task_step",
    modelId: "fixture",
    provider: "fixture",
    totalTokens: 10,
    usageReported: true,
    reportedCostUsd: null,
  });
  return {
    owner,
    root,
    child,
    input: { requestId: randomUUID(), rootTaskId: root.id },
    path: `/api/tasks/${root.id}/budget-resume`,
  };
}

test("budget resume commits family transitions once and preserves recorded spend", async (t) => {
  const f = await fixture(),
    port = await listen(t);
  const snapshot = await request(port, "GET", f.path);
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.data.rootTaskId, f.root.id);
  const replies = await Promise.all([
    request(port, "POST", f.path, f.input),
    request(port, "POST", f.path, f.input),
  ]);
  for (const reply of replies) {
    assert.equal(reply.status, 200, JSON.stringify(reply.data));
    assert.equal(reply.data.outcome, "accepted");
    assert.equal(reply.data.queuedCount, 2);
    assert.deepEqual(reply.data.queuedTaskIds, [f.root.id, f.child.id]);
  }
  assert.deepEqual(replies[0].data, replies[1].data);
  for (const task of [f.root, f.child]) {
    const [after] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    assert.equal(after.status, "in_progress");
    assert.equal(after.tokensUsed, task.tokensUsed);
    assert.equal(after.lastCycleCompletedAt, task.lastCycleCompletedAt);
  }
  assert.equal(
    (
      await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.taskId, f.root.id))
    ).length,
    1,
  );
  assert.equal(
    (
      await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, f.root.id))
    ).length,
    1,
  );
  assert.deepEqual(
    (await request(port, "GET", `${f.path}/${f.input.requestId}`)).data,
    replies[0].data,
  );
  await db
    .update(tasksTable)
    .set({ status: "cancelled" })
    .where(eq(tasksTable.id, f.root.id));
  assert.deepEqual(
    (await request(port, "POST", f.path, f.input)).data,
    replies[0].data,
  );
  assert.equal(
    (await db.select().from(tasksTable).where(eq(tasksTable.id, f.root.id)))[0]
      .status,
    "cancelled",
  );
  assert.equal(
    (
      await request(
        port,
        "POST",
        `/api/tasks/${f.child.id}/budget-resume`,
        f.input,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        port,
        "GET",
        `/api/tasks/${f.child.id}/budget-resume/${f.input.requestId}`,
      )
    ).status,
    404,
  );
});

test("spent allowance stays paused and renewed allowance requires a new explicit intent", async (t) => {
  const f = await fixture(),
    port = await listen(t);
  const previous = process.env.MAX_TASK_FAMILY_TOKENS;
  t.after(() => {
    if (previous === undefined) delete process.env.MAX_TASK_FAMILY_TOKENS;
    else process.env.MAX_TASK_FAMILY_TOKENS = previous;
  });
  process.env.MAX_TASK_FAMILY_TOKENS = "30";
  const denied = await request(port, "POST", f.path, f.input);
  assert.equal(denied.status, 200);
  assert.equal(denied.data.reason, "allowance_exhausted");
  assert.equal(denied.data.stillPausedCount, 2);
  assert.equal(
    (await db.select().from(tasksTable).where(eq(tasksTable.id, f.root.id)))[0]
      .status,
    "blocked",
  );
  process.env.MAX_TASK_FAMILY_TOKENS = "31";
  assert.deepEqual(
    (await request(port, "POST", f.path, f.input)).data,
    denied.data,
  );
  assert.equal(
    (
      await request(port, "POST", f.path, {
        ...f.input,
        requestId: randomUUID(),
      })
    ).data.outcome,
    "accepted",
  );
});

test("resuming a family skips inactive, leased, other-blocked and uncertain operation work", async (t) => {
  const f = await fixture(),
    port = await listen(t);
  const [inactive] = await db
    .insert(agentsTable)
    .values({
      name: "Inactive",
      role: "Test",
      systemPrompt: "Test",
      isActive: false,
    })
    .returning();
  const kinds = [
    "inactive",
    "lease",
    "question",
    "pending_approval",
    "unknown_operation",
  ];
  const ids: number[] = [];
  for (const kind of kinds) {
    const [task] = await db
      .insert(tasksTable)
      .values({
        ownerAgentId: kind === "inactive" ? inactive.id : f.owner.id,
        parentTaskId: f.root.id,
        title: kind,
        brief: "Test",
        status: "blocked",
        blockedReason: kind === "question" ? "user_input" : "budget",
        leaseOwner: kind === "lease" ? "in-flight" : null,
      })
      .returning();
    ids.push(task.id);
    if (kind === "pending_approval")
      await db.insert(approvalRequestsTable).values({
        agentId: f.owner.id,
        taskId: task.id,
        category: "other",
        title: "Pending",
        description: "Test",
        status: "pending",
      });
    if (kind === "unknown_operation") {
      const [approval] = await db
        .insert(approvalRequestsTable)
        .values({
          agentId: f.owner.id,
          taskId: task.id,
          category: "other",
          title: "Unknown",
          description: "Test",
          status: "approved",
          consumedAt: new Date(),
        })
        .returning();
      await db.insert(operationReceiptsTable).values({
        id: randomUUID(),
        operationKey: randomUUID(),
        replayKey: randomUUID(),
        logicalExecutionId: randomUUID(),
        taskId: task.id,
        agentId: f.owner.id,
        approvalId: approval.id,
        executionKind: "approved_action",
        sideEffectClass: "at_most_once",
        state: "unknown",
        finishedAt: new Date(),
        toolName: "fixture",
        argumentHash: "a".repeat(64),
      });
    }
  }
  const reply = await request(port, "POST", f.path, f.input);
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(reply.data.queuedCount, 2);
  assert.equal(reply.data.stillPausedCount, 4);
  for (const id of ids)
    assert.equal(
      (await db.select().from(tasksTable).where(eq(tasksTable.id, id)))[0]
        .status,
      "blocked",
    );
});

test("emergency stop and mismatched root never queue budget work", async (t) => {
  const f = await fixture(),
    port = await listen(t);
  const wrong = await request(port, "POST", f.path, {
    ...f.input,
    rootTaskId: f.child.id,
  });
  assert.equal(wrong.data.reason, "task_changed");
  // A request ID remains bound even after rejection.
  assert.equal((await request(port, "POST", f.path, f.input)).status, 409);
  await db
    .insert(runtimeControlsTable)
    .values({ id: 1, emergencyStopEnabled: true })
    .onConflictDoUpdate({
      target: runtimeControlsTable.id,
      set: { emergencyStopEnabled: true },
    });
  t.after(async () => {
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: false })
      .where(eq(runtimeControlsTable.id, 1));
  });
  assert.equal(
    (
      await request(port, "POST", f.path, {
        ...f.input,
        requestId: randomUUID(),
      })
    ).data.reason,
    "emergency_stop",
  );
  assert.equal(
    (await db.select().from(tasksTable).where(eq(tasksTable.id, f.root.id)))[0]
      .status,
    "blocked",
  );
});

test("individual allowance stays authoritative when the shared allowance is available", async (t) => {
  const f = await fixture(),
    port = await listen(t);
  await db
    .update(tasksTable)
    .set({ tokensUsed: 100_000 })
    .where(eq(tasksTable.id, f.child.id));
  await db
    .update(usageEventsTable)
    .set({ totalTokens: 100_000 })
    .where(eq(usageEventsTable.taskId, f.child.id));
  const reply = await request(port, "POST", f.path, f.input);
  assert.equal(reply.data.outcome, "accepted");
  assert.deepEqual(reply.data.queuedTaskIds, [f.root.id]);
  assert.equal(reply.data.stillPausedCount, 1);
  assert.equal(
    (await db.select().from(tasksTable).where(eq(tasksTable.id, f.child.id)))[0]
      .tokensUsed,
    100_000,
  );
});

test("allowance checks cannot resume unreported usage or erase its receipts", async (t) => {
  const f = await fixture(),
    port = await listen(t);
  await db
    .update(usageEventsTable)
    .set({ usageReported: false })
    .where(eq(usageEventsTable.taskId, f.root.id));
  const reply = await request(port, "POST", f.path, f.input);
  assert.equal(reply.status, 200);
  assert.equal(reply.data.outcome, "rejected");
  assert.equal(reply.data.reason, "allowance_exhausted");
  assert.equal(reply.data.stillPausedCount, 2);
  for (const task of [f.root, f.child]) {
    const [saved] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, task.id));
    assert.equal(saved.status, "blocked");
    assert.equal(saved.tokensUsed, task.tokensUsed);
  }
  const [receipt] = await db
    .select()
    .from(usageEventsTable)
    .where(eq(usageEventsTable.taskId, f.root.id));
  assert.equal(receipt.usageReported, false);
  assert.equal(receipt.totalTokens, 20);
});

test("rolling-day renewal admits work without resetting its lifetime counters", async (t) => {
  const f = await fixture(),
    port = await listen(t);
  const previous = process.env.MAX_RECURRING_FAMILY_DAILY_TOKENS;
  t.after(() => {
    if (previous === undefined)
      delete process.env.MAX_RECURRING_FAMILY_DAILY_TOKENS;
    else process.env.MAX_RECURRING_FAMILY_DAILY_TOKENS = previous;
  });
  process.env.MAX_RECURRING_FAMILY_DAILY_TOKENS = "20";
  await db
    .update(tasksTable)
    .set({
      autonomyMode: "continuous",
      lastCycleCompletedAt: new Date(Date.now() - 3_600_000),
    })
    .where(eq(tasksTable.id, f.root.id));
  await db
    .update(usageEventsTable)
    .set({ createdAt: new Date(Date.now() - 7_200_000) })
    .where(eq(usageEventsTable.taskId, f.root.id));
  assert.equal(
    (await request(port, "POST", f.path, f.input)).data.reason,
    "allowance_exhausted",
  );
  // Advancing the fixture's receipt age represents the rolling window expiring.
  await db
    .update(usageEventsTable)
    .set({ createdAt: new Date(Date.now() - 90_000_000) })
    .where(eq(usageEventsTable.taskId, f.root.id));
  const reply = await request(port, "POST", f.path, {
    ...f.input,
    requestId: randomUUID(),
  });
  assert.equal(reply.data.outcome, "accepted");
  assert.equal(reply.data.queuedCount, 2);
  assert.equal(
    (await db.select().from(tasksTable).where(eq(tasksTable.id, f.root.id)))[0]
      .tokensUsed,
    20,
  );
  assert.equal(
    (
      await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.taskId, f.root.id))
    ).length,
    1,
  );
});

test("queue transitions, activity and receipt all roll back together", async () => {
  const f = await fixture();
  await assert.rejects(
    db.transaction(async (tx) => {
      const result = await resumeBudgetWithinTransaction(
        tx,
        f.root.id,
        f.input,
        "en",
      );
      assert.ok(result.receipt);
      assert.equal(result.receipt.outcome, "accepted");
      throw new Error("fixture rollback");
    }),
    /fixture rollback/,
  );
  assert.equal(
    (await db.select().from(tasksTable).where(eq(tasksTable.id, f.root.id)))[0]
      .status,
    "blocked",
  );
  assert.equal(
    (await db.select().from(tasksTable).where(eq(tasksTable.id, f.child.id)))[0]
      .status,
    "blocked",
  );
  assert.equal(
    (
      await db
        .select()
        .from(taskBudgetResumeRequestsTable)
        .where(eq(taskBudgetResumeRequestsTable.requestId, f.input.requestId))
    ).length,
    0,
  );
  assert.equal(
    (
      await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, f.root.id))
    ).length,
    0,
  );
});

test("corrupt parent cycles and oversized families fail closed before queueing", async (t) => {
  const f = await fixture(),
    port = await listen(t);
  await db
    .update(tasksTable)
    .set({ parentTaskId: f.child.id })
    .where(eq(tasksTable.id, f.root.id));
  assert.equal(
    (await request(port, "POST", f.path, f.input)).data.reason,
    "family_invalid",
  );
  const large = await fixture();
  await db.insert(tasksTable).values(
    Array.from({ length: 999 }, (_, i) => ({
      ownerAgentId: large.owner.id,
      parentTaskId: large.root.id,
      title: `Member ${i}`,
      brief: "Test",
      status: "blocked",
      blockedReason: "budget",
    })),
  );
  const reply = await request(port, "POST", large.path, large.input);
  assert.equal(reply.data.reason, "family_too_large");
  assert.equal(reply.data.queuedCount, 0);
  assert.equal(
    (
      await db.select().from(tasksTable).where(eq(tasksTable.id, large.root.id))
    )[0].status,
    "blocked",
  );
});

test("malformed receipts cannot invent accepted work or contradict their bounded counts", () => {
  const receipt = {
    requestId: randomUUID(),
    taskId: 1,
    rootTaskId: 1,
    outcome: "accepted",
    reason: null,
    queuedTaskIds: [1],
    queuedCount: 1,
    stillPausedCount: 0,
    recordedAt: new Date(),
  };
  assert.equal(parseBudgetResumeReceipt(receipt).queuedCount, 1);
  for (const changed of [
    { queuedCount: 2 },
    { queuedTaskIds: [1, 1], queuedCount: 2 },
    { queuedCount: 0, queuedTaskIds: [] },
    { reason: "nothing_eligible" },
    { stillPausedCount: 1000 },
    { outcome: "rejected" },
    { queuedTaskIds: [-1] },
  ])
    assert.throws(() => parseBudgetResumeReceipt({ ...receipt, ...changed }));
});

test("cancellation racing budget resume leaves the entire family cancelled", async (t) => {
  const f = await fixture(),
    port = await listen(t);
  const responses = await Promise.all([
    request(port, "POST", f.path, f.input),
    request(port, "POST", `/api/tasks/${f.root.id}/cancel`),
  ]);
  assert.equal(responses[1].status, 200, JSON.stringify(responses[1].data));
  for (const member of [f.root, f.child])
    assert.equal(
      (
        await db.select().from(tasksTable).where(eq(tasksTable.id, member.id))
      )[0].status,
      "cancelled",
    );
  const replay = await request(port, "POST", f.path, f.input);
  assert.deepEqual(replay.data, responses[0].data);
  assert.equal(
    (await db.select().from(tasksTable).where(eq(tasksTable.id, f.root.id)))[0]
      .status,
    "cancelled",
  );
});
