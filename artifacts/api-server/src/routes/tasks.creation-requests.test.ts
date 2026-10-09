import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  tasksTable,
  activityEventsTable,
  runtimeControlsTable,
} from "@workspace/db";
import app from "../app";

// Losing the first HTTP response must not let a retry create a second job.
async function fixture(t: TestContext) {
  await dbReady;
  const marker = randomUUID();
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Creation receipt ${marker}`,
      role: "Test coordinator",
      systemPrompt: "Test only; no inference.",
      createdByUser: true,
    })
    .returning();
  const createdIds: number[] = [];
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (createdIds.length)
      await db.delete(tasksTable).where(inArray(tasksTable.id, createdIds));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent!.id));
  });
  const input = {
    requestId: randomUUID(),
    title: `Recover exact project ${marker}`,
    brief: "Retain this Unicode input: Türkçe 中文 العربية.",
    ownerAgentId: agent!.id,
  };
  const request = (url: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${address.port}/api${url}`, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const send = async (body: unknown = input) => {
    const response = await request("/tasks", body);
    const data = (await response.json()) as Record<string, unknown>;
    if (Number.isInteger(data.id)) createdIds.push(Number(data.id));
    return { response, data };
  };
  return { input, send, request, agent: agent! };
}

test("project creation replays the same request identity instead of duplicating work", async (t) => {
  const { input, send } = await fixture(t);
  const first = await send();
  assert.equal(first.response.status, 201);
  const retried = await send();
  assert.equal(
    retried.data.id,
    first.data.id,
    "The same accepted request must return its original project",
  );
  assert.equal(retried.response.status, 200);
  const matchingTasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.title, input.title));
  assert.equal(matchingTasks.length, 1);
  const activity = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.taskId, Number(first.data.id)));
  assert.equal(
    activity.filter((event) => event.type === "task_created").length,
    1,
  );
});

test("concurrent project request replay commits one project and rejects changed input", async (t) => {
  const { input, send } = await fixture(t);
  const results = await Promise.all([send(), send(), send()]);
  assert.equal(new Set(results.map((r) => r.data.id)).size, 1);
  assert.deepEqual(
    results.map((r) => r.response.status).sort(),
    [200, 200, 201],
  );
  for (const patch of [
    { brief: "A different job" },
    { priority: "high" },
    { autonomyMode: "continuous", cadenceSeconds: 900 },
    { ownerAgentId: 2147483647 },
  ]) {
    const changed = await send({ ...input, ...patch });
    assert.equal(changed.response.status, 409);
    assert.equal(changed.data.code, "TASK_CREATION_REQUEST_CONFLICT");
  }
  assert.equal(
    (
      await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.title, input.title))
    ).length,
    1,
  );
});

test("a capacity rejection stays rejected while accepted project replays bypass new admission", async (t) => {
  const { input, send } = await fixture(t);
  const previous = process.env.MAX_OUTSTANDING_TASKS;
  t.after(() => {
    if (previous === undefined) delete process.env.MAX_OUTSTANDING_TASKS;
    else process.env.MAX_OUTSTANDING_TASKS = previous;
  });
  process.env.MAX_OUTSTANDING_TASKS = "1";
  const first = await send();
  assert.equal(first.response.status, 201);
  const blockedInput = { ...input, requestId: randomUUID() };
  const blocked = await send(blockedInput);
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.data.code, "RUNTIME_CAPACITY_EXCEEDED");
  assert.equal((await send()).data.id, first.data.id);
  process.env.MAX_OUTSTANDING_TASKS = "100";
  assert.equal((await send(blockedInput)).response.status, 429);
  assert.equal(
    (await send({ ...input, requestId: randomUUID() })).response.status,
    201,
  );
});

test("failure to store a creation receipt rolls back the project and allows the same request to retry", async (t) => {
  const { input, send, request } = await fixture(t);
  const name = `fixture_receipt_${input.requestId.replaceAll("-", "")}`;
  const drop = async () => {
    await db.execute(
      sql`DROP TRIGGER IF EXISTS ${sql.identifier(name)} ON task_creation_requests`,
    );
    await db.execute(sql`DROP FUNCTION IF EXISTS ${sql.identifier(name)}()`);
  };
  t.after(drop);
  // This owned UUID is the only data in the generated DDL; no user input or
  // database mock replaces the actual transaction/constraint behavior.
  assert.match(input.requestId, /^[a-f0-9-]{36}$/);
  const functionBody = `$body$ BEGIN IF NEW.request_id = '${input.requestId}'::uuid THEN RAISE EXCEPTION 'fixture_receipt_write_failed'; END IF; RETURN NEW; END; $body$`;
  await db.execute(
    sql`CREATE FUNCTION ${sql.identifier(name)}() RETURNS trigger LANGUAGE plpgsql AS ${sql.raw(functionBody)}`,
  );
  await db.execute(
    sql`CREATE TRIGGER ${sql.identifier(name)} BEFORE INSERT ON task_creation_requests FOR EACH ROW EXECUTE FUNCTION ${sql.identifier(name)}()`,
  );
  const failed = await send();
  assert.equal(failed.response.status, 500);
  assert.equal(
    (
      await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.title, input.title))
    ).length,
    0,
  );
  assert.equal(
    (await request(`/task-creation-requests/${input.requestId}`)).status,
    404,
  );
  await drop();
  const accepted = await send();
  assert.equal(accepted.response.status, 201);
  assert.equal((await send()).data.id, accepted.data.id);
});

test("continuous requests compare effective cadence and normalized due timestamps", async (t) => {
  const { input, send } = await fixture(t);
  const original = {
    ...input,
    autonomyMode: "continuous",
    dueAt: "2026-10-10T12:00:00Z",
  };
  const first = await send(original);
  assert.equal(first.response.status, 201);
  const same = await send({
    ...original,
    cadenceSeconds: 3600,
    dueAt: "2026-10-10T15:00:00+03:00",
  });
  assert.equal(same.response.status, 200);
  assert.equal(same.data.id, first.data.id);
  for (const patch of [
    { cadenceSeconds: 900 },
    { dueAt: "2026-10-11T12:00:00Z" },
  ]) {
    assert.equal((await send({ ...original, ...patch })).response.status, 409);
  }
});

test("project creation normalizes UUID and effective defaults without normalizing the brief", async (t) => {
  const { input, send } = await fixture(t);
  const original = await send();
  const equivalent = await send({
    ...input,
    requestId: input.requestId.toUpperCase(),
    title: `  ${input.title}  `,
    priority: "normal",
    autonomyMode: "finite",
  });
  assert.equal(equivalent.response.status, 200);
  assert.equal(equivalent.data.id, original.data.id);
  const altered = await send({ ...input, brief: ` ${input.brief}` });
  assert.equal(altered.response.status, 409);
});

test("saved project receipts are token-free records and remain after project removal", async (t) => {
  const { input, send, request } = await fixture(t);
  const first = await send();
  const receiptResponse = await request(
    `/task-creation-requests/${input.requestId}`,
  );
  assert.equal(receiptResponse.status, 200);
  assert.equal(receiptResponse.headers.get("cache-control"), "no-store");
  const receipt = (await receiptResponse.json()) as Record<string, unknown>;
  assert.equal(receipt.requestId, input.requestId);
  assert.equal(receipt.state, "created");
  assert.equal(receipt.taskId, first.data.id);
  assert.equal(receipt.failureCode, null);
  assert.deepEqual(Object.keys(receipt).sort(), [
    "createdAt",
    "failureCode",
    "requestId",
    "state",
    "taskId",
  ]);
  await db.delete(tasksTable).where(eq(tasksTable.id, Number(first.data.id)));
  const replay = await send();
  assert.equal(replay.response.status, 410);
  assert.equal(replay.data.code, "TASK_CREATION_PROJECT_REMOVED");
  const retained = await request(`/task-creation-requests/${input.requestId}`);
  assert.equal(retained.status, 200);
  assert.deepEqual(await retained.json(), receipt);
});

test("a rejected request cannot turn into a project after its owner becomes active", async (t) => {
  const { input, send, request, agent } = await fixture(t);
  await db
    .update(agentsTable)
    .set({ isActive: false })
    .where(eq(agentsTable.id, agent.id));
  const rejected = await send();
  assert.equal(rejected.response.status, 400);
  await db
    .update(agentsTable)
    .set({ isActive: true })
    .where(eq(agentsTable.id, agent.id));
  const retry = await send();
  assert.equal(retry.response.status, 400);
  assert.equal(retry.data.code, "AGENT_UNAVAILABLE");
  const response = await request(`/task-creation-requests/${input.requestId}`);
  assert.equal(response.status, 200);
  const receipt = (await response.json()) as Record<string, unknown>;
  assert.equal(receipt.state, "rejected");
  assert.equal(receipt.taskId, null);
  assert.equal(receipt.failureCode, "AGENT_UNAVAILABLE");
  const fresh = await send({ ...input, requestId: randomUUID() });
  assert.equal(fresh.response.status, 201);
});

test("malformed request identities and ambiguous receipt reads cannot create or expose work", async (t) => {
  const { input, send, request } = await fixture(t);
  for (const requestId of [
    "",
    "bad",
    "00000000-0000-0000-0000-000000000000",
    12,
  ]) {
    assert.equal((await send({ ...input, requestId })).response.status, 400);
  }
  assert.equal(
    (
      await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.title, input.title))
    ).length,
    0,
  );
  assert.equal(
    (await request(`/task-creation-requests/${randomUUID()}`)).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/task-creation-requests/${input.requestId}?requestId=other`,
      )
    ).status,
    400,
  );
});

test("emergency stop preserves accepted reads and makes a new rejected identity terminal", async (t) => {
  const { input, send, request } = await fixture(t);
  const accepted = await send();
  const [control] = await db
    .select()
    .from(runtimeControlsTable)
    .where(eq(runtimeControlsTable.id, 1));
  assert.ok(control);
  const restore = () =>
    db
      .update(runtimeControlsTable)
      .set({
        emergencyStopEnabled: control.emergencyStopEnabled,
        emergencyStopReason: control.emergencyStopReason,
      })
      .where(eq(runtimeControlsTable.id, 1));
  t.after(restore);
  await db
    .update(runtimeControlsTable)
    .set({
      emergencyStopEnabled: true,
      emergencyStopReason: "Test start recovery",
    })
    .where(eq(runtimeControlsTable.id, 1));
  const replay = await send();
  assert.equal(replay.response.status, 200);
  assert.equal(replay.data.id, accepted.data.id);
  assert.equal(
    (await request(`/task-creation-requests/${input.requestId}`)).status,
    200,
  );
  const stoppedInput = { ...input, requestId: randomUUID() };
  assert.equal((await send(stoppedInput)).response.status, 423);
  await restore();
  const stillRejected = await send(stoppedInput);
  assert.equal(stillRejected.response.status, 423);
  assert.equal(stillRejected.data.code, "EMERGENCY_STOP_ACTIVE");
  assert.equal(
    (
      await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.title, input.title))
    ).length,
    1,
  );
});
