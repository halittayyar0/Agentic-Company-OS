import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";

delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
process.env.NODE_ENV = "test";
process.env.RUNTIME_CONTROL_KEY = "operator-http-test-key-32-characters";
const sandbox = await fsp.mkdtemp(
  path.join(os.tmpdir(), "acos-operator-http-"),
);
process.env.AGENT_SANDBOX_ROOT = sandbox;
const {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  activityEventsTable,
  runtimeControlsTable,
} = await import("@workspace/db");
const { default: vmRouter } = await import("./vm");
const { createOperatorAuth } = await import("../lib/operator-auth");
const token = "operator-http-fixture-auth-token-32-characters";

test("terminal HTTP requires durable identity, dispatches once and recovers exact output after deletion", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: "Operator HTTP", role: "Test", systemPrompt: "Test" })
    .returning();
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createOperatorAuth({ token, secureCookies: false }).requireAuthentication,
    vmRouter,
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}/api/agents`;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase();
    await fsp.rm(sandbox, { recursive: true, force: true });
  });
  async function execute(body: unknown, agentId = agent.id) {
    const response = await fetch(`${origin}/${agentId}/vm/exec`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  }
  const command = "mkdir once";
  const rejected = await execute({ command, as: "sandbox" });
  assert.equal(
    rejected.status,
    400,
    "no identity cannot create a directory or activity",
  );
  assert.equal((await db.select().from(activityEventsTable)).length, 0);
  await assert.rejects(
    fsp.access(path.join(sandbox, String(agent.id), "once")),
  );
  const payload = { command, as: "sandbox", requestId: randomUUID() };
  const [first, second] = await Promise.all([
    execute(payload),
    execute(payload),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const done = [first, second].find(
    (r) => r.body.receipt?.state === "complete",
  );
  assert.ok(done);
  assert.equal(done.body.receipt.requestId, payload.requestId);
  assert.equal(done.body.result.ok, true);
  const replay = await execute(payload);
  assert.deepEqual(replay.body, done.body);
  assert.equal(
    (await db.select().from(activityEventsTable)).length,
    1,
    "one accepted identity has one activity and one execution",
  );
  assert.equal(
    (await execute({ ...payload, command: "mkdir second" })).status,
    409,
  );
  const receiptUrl = `${origin}/${agent.id}/operator-requests/${payload.requestId}`;
  assert.equal(
    (await fetch(receiptUrl)).status,
    401,
    "private output requires authentication",
  );
  const readReceipt = (url: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const read = await readReceipt(receiptUrl);
  assert.equal(read.status, 200);
  const receipt = (await read.json()) as Record<string, any>;
  assert.deepEqual(receipt, done.body.receipt);
  assert.equal("ownerId" in receipt, false);
  assert.equal("requestHash" in receipt, false);
  assert.equal((await readReceipt(`${receiptUrl}?replay=true`)).status, 400);
  assert.equal(
    (
      await readReceipt(
        `${origin}/0${agent.id}/operator-requests/${payload.requestId}`,
      )
    ).status,
    400,
  );
  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: true })
    .where(eq(runtimeControlsTable.id, 1));
  assert.equal(
    (
      await execute({
        ...payload,
        requestId: randomUUID(),
        command: "mkdir blocked",
      })
    ).status,
    423,
  );
  assert.equal((await readReceipt(receiptUrl)).status, 200);
  await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  assert.equal(
    (await readReceipt(receiptUrl)).status,
    200,
    "history survives deleted agent",
  );
  assert.equal(
    (await execute(payload)).status,
    200,
    "exact replay stays a read after deletion",
  );
});
