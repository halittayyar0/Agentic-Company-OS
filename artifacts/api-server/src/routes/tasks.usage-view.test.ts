import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  closeDatabase,
  db,
  dbReady,
  tasksTable,
  usageEventsTable,
} from "@workspace/db";
import app from "../app";

test.after(() => closeDatabase());

async function fixture(t: test.TestContext, cachedTokens = 11161) {
  await dbReady;
  const [owner] = await db
    .insert(agentsTable)
    .values({
      name: `Usage view ${randomUUID()}`,
      role: "Test owner",
      systemPrompt: "Test only.",
      createdByUser: true,
    })
    .returning();
  const [parent] = await db
    .insert(tasksTable)
    .values({
      title: "Parent",
      brief: "Test only.",
      ownerAgentId: owner!.id,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Calculated result",
      brief: "Test only.",
      ownerAgentId: owner!.id,
      parentTaskId: parent!.id,
      tokensUsed: cachedTokens,
      status: "completed",
      resultSummary: "391",
      progressPercent: 100,
    })
    .returning();
  const append = (
    taskId: number,
    tokens: number,
    kind: "task_step" | "judge" | "chat" = "task_step",
    extra: Partial<typeof usageEventsTable.$inferInsert> = {},
  ) =>
    db.insert(usageEventsTable).values({
      agentId: owner!.id,
      taskId,
      kind,
      modelId: "local-test-model",
      provider: "ollama",
      promptTokens: tokens,
      completionTokens: 0,
      totalTokens: tokens,
      usageReported: true,
      ...extra,
    });
  for (const tokens of [3619, 3700, 3842]) await append(task!.id, tokens);
  await append(task!.id, 280, "judge");
  await append(parent!.id, 99000, "judge");

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: { Origin: origin, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert.ok([200, 201].includes(response.status), JSON.stringify(data));
    return { data: data as any, response };
  };
  return { owner: owner!, task: task!, parent: parent!, append, request };
}

test("task detail includes actual judge usage without rewriting execution counters or receipts", async (t) => {
  const { task, request } = await fixture(t);
  const receipts = await db
    .select()
    .from(usageEventsTable)
    .where(eq(usageEventsTable.taskId, task.id));
  const { data } = await request(`/tasks/${task.id}`);
  assert.equal(data.tokensUsed, 11441);
  assert.equal(data.resultSummary, "391");
  assert.equal(
    data.estimatedCostUsd,
    null,
    "unknown local cost must remain unknown",
  );
  const [stored] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.deepEqual(stored, task, "read projection must not alter the task");
  assert.deepEqual(
    await db
      .select()
      .from(usageEventsTable)
      .where(eq(usageEventsTable.taskId, task.id)),
    receipts,
  );
});

test("paginated task list includes judge usage only for each returned task", async (t) => {
  const { owner, task, request } = await fixture(t);
  const { data, response } = await request(
    `/tasks?ownerAgentId=${owner.id}&limit=1`,
  );
  assert.equal(data.length, 1);
  assert.equal(data[0].id, task.id);
  assert.equal(data[0].tokensUsed, 11441);
  assert.equal(
    response.headers.get("x-next-before-id"),
    String(task.id),
    "usage projection preserves pagination",
  );
});

test("subtask list and a fresh detail read include late receipts and reported failed calls across cycles", async (t) => {
  const { parent, task, append, request } = await fixture(t);
  await append(task.id, 13, "chat", {
    outcome: "failed",
    failureKind: "provider_error",
  });
  await append(task.id, 7, "task_step", {
    createdAt: new Date("2025-01-01T00:00:00Z"),
  });
  await append(task.id, 0, "judge", {
    usageReported: false,
    outcome: "failed",
    failureKind: "usage_missing",
  });
  const { data } = await request(`/tasks/${parent.id}/subtasks`);
  assert.equal(data.length, 1);
  assert.equal(data[0].tokensUsed, 11461);
  assert.equal((await request(`/tasks/${task.id}`)).data.tokensUsed, 11461);
});

test("task usage preserves higher historical counters and tasks with no receipts", async (t) => {
  const { owner, task, request } = await fixture(t, 15000);
  assert.equal((await request(`/tasks/${task.id}`)).data.tokensUsed, 15000);
  const [legacy] = await db
    .insert(tasksTable)
    .values({
      title: "Legacy",
      brief: "Test only.",
      ownerAgentId: owner.id,
      tokensUsed: 987,
    })
    .returning();
  assert.equal((await request(`/tasks/${legacy!.id}`)).data.tokensUsed, 987);
});

test("autonomy changes return the same complete recorded usage as subsequent task reads", async (t) => {
  const { task, request } = await fixture(t);
  const { data } = await request(`/tasks/${task.id}/autonomy`, "PUT", {
    autonomyMode: "continuous",
    cadenceSeconds: 600,
  });
  assert.equal(data.tokensUsed, 11441);
  assert.equal(data.autonomyMode, "continuous");
  assert.equal(
    (await request(`/tasks/${task.id}`)).data.tokensUsed,
    data.tokensUsed,
  );
});

test("replaying project creation returns its current recorded usage without creating another task", async (t) => {
  const { owner, append, request } = await fixture(t);
  const input = {
    title: "Saved start",
    brief: "Test only.",
    ownerAgentId: owner.id,
    requestId: randomUUID(),
  };
  const first = await request("/tasks", "POST", input);
  assert.equal(first.response.status, 201);
  await append(first.data.id, 100);
  await append(first.data.id, 5, "judge");
  const replay = await request("/tasks", "POST", input);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.data.id, first.data.id);
  assert.equal(replay.data.tokensUsed, 105);
});

test("cancel responses retain reported failed and judge calls without changing accounting rows", async (t) => {
  const { task, append, request } = await fixture(t);
  await append(task.id, 13, "chat", {
    outcome: "failed",
    failureKind: "provider_error",
  });
  await db
    .update(tasksTable)
    .set({ status: "pending" })
    .where(eq(tasksTable.id, task.id));
  const { data } = await request(`/tasks/${task.id}/cancel`, "POST");
  assert.equal(data.status, "cancelled");
  assert.equal(data.tokensUsed, 11454);
  const [stored] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.equal(stored!.tokensUsed, 11161);
});

test("lifetime task projection does not overflow the 32 bit execution counter", async (t) => {
  const { task, append, request } = await fixture(t);
  await append(task.id, 2147483647);
  await append(task.id, 2147483647, "judge");
  assert.equal(
    (await request(`/tasks/${task.id}`)).data.tokensUsed,
    4294978735,
  );
});
