import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { createOperatorAuth } from "../lib/operator-auth";
import { createRateLimiter } from "../lib/rate-limit";
import { createInferenceAccountingRouter } from "./inference-accounting";
import { GetInferenceAccountingStatusResponse } from "@workspace/api-zod";

test.after(() => closeDatabase());
async function listen(t: test.TestContext, app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}/api/inference-accounting`;
}
test("accounting inspection authenticates before reading, rejects ambiguous scopes, hides backend details and has no reset endpoint", async (t) => {
  let reads = 0;
  const app = express(),
    auth = createOperatorAuth({
      token: "fixture-accounting-operator",
      secureCookies: false,
    });
  app.use(
    "/api",
    createRateLimiter({
      namespace: "test-accounting",
      max: 7,
      windowMs: 60_000,
      now: () => 0,
    }),
    auth.requireAuthentication,
    createInferenceAccountingRouter({
      readStatus: async () => {
        reads++;
        throw new Error("PRIVATE-provider-token-path");
      },
    }),
  );
  const base = await listen(t, app),
    headers = { Authorization: "Bearer fixture-accounting-operator" };
  assert.equal((await fetch(base + "?scopeType=task&scopeId=1")).status, 401);
  assert.equal(reads, 0);
  for (const query of [
    "scopeType=task&scopeId=0",
    "scopeType=other&scopeId=1",
    "scopeType=task&scopeId=2147483648",
    "scopeType=task&scopeId=1&scopeId=2",
  ])
    assert.equal((await fetch(base + "?" + query, { headers })).status, 400);
  assert.equal(reads, 0);
  const failure = await fetch(base + "?scopeType=task&scopeId=1", { headers });
  assert.equal(failure.status, 503);
  assert.equal(failure.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failure.json(), {
    error: "accounting_status_unavailable",
  });
  assert.equal(reads, 1);
  assert.equal(
    (
      await fetch(base + "?scopeType=task&scopeId=1", {
        method: "POST",
        headers,
      })
    ).status,
    404,
  );
  assert.equal(reads, 1);
  const limited = await fetch(base + "?scopeType=task&scopeId=1", { headers });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal(reads, 1);
});
test("the real app mounts the read-only accounting scope behind operator authentication", async (t) => {
  await dbReady;
  const previous = process.env.OPERATOR_AUTH_TOKEN,
    token = "fixture-accounting-" + randomUUID();
  process.env.OPERATOR_AUTH_TOKEN = token;
  t.after(() => {
    if (previous === undefined) delete process.env.OPERATOR_AUTH_TOKEN;
    else process.env.OPERATOR_AUTH_TOKEN = previous;
  });
  const { default: app } = await import("../app");
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Mounted accounting",
      role: "Fixture",
      systemPrompt: "PRIVATE",
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({ title: "Mounted task", brief: "PRIVATE", ownerAgentId: agent.id })
    .returning();
  t.after(async () => {
    await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  const base = await listen(t, app),
    url = base + `?scopeType=task&scopeId=${task.id}`;
  assert.equal((await fetch(url)).status, 401);
  const result = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  const body = GetInferenceAccountingStatusResponse.parse(await result.json());
  assert.equal(body.scopeId, task.id);
  assert.equal(body.status, "clear");
  assert.deepEqual(body.attempts, []);
  const [unchanged] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.equal(unchanged.status, task.status);
  assert.equal(unchanged.tokensUsed, 0);
});
