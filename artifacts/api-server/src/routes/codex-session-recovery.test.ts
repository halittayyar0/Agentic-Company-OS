import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import {
  GetCodexSessionRecoveryResponse,
  GetCodexSessionRecoveryReceiptResponse,
  RecoverCodexSessionResponse,
} from "@workspace/api-zod";
import { createOperatorAuth } from "../lib/operator-auth";
import { createCodexSessionRecoveryRouter } from "./codex-session-recovery";
import { CodexRecoveryScopeConflict } from "../lib/codex-session-recovery";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  codexSessionRecoveriesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

test.after(() => closeDatabase());
test("recovery HTTP requires operator authentication and explicit exact acknowledgement, supports lost-response receipts and hides backend failures", async (t) => {
  const input = {
    requestId: randomUUID(),
    expectedRevision: 4,
    acknowledgeUncertainEffects: true as const,
  };
  const receipt = {
    requestId: input.requestId,
    taskId: 51,
    expectedRevision: 4,
    outcome: "accepted" as const,
    reason: null,
    revision: 5,
    recordedAt: Date.now(),
    taskResumed: false as const,
    effectsReconciled: false as const,
  };
  let writes = 0,
    reads = 0,
    fail = false,
    conflict = false;
  const auth = createOperatorAuth({
    token: "fixture-recovery-operator",
    secureCookies: false,
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    auth.requireAuthentication,
    createCodexSessionRecoveryRouter({
      readStatus: async () => {
        reads++;
        if (fail) throw new Error("PRIVATE-fixture-host-account-token");
        return {
          taskId: 51,
          sessionState: "uncertain",
          revision: 4,
          cleanupState: "verified",
          canReset: true,
          reason: null,
          requiresRevalidation: true,
        };
      },
      recover: async (taskId, body) => {
        writes++;
        assert.equal(taskId, 51);
        assert.deepEqual(body, input);
        if (conflict) throw new CodexRecoveryScopeConflict();
        if (fail) throw new Error("PRIVATE-fixture-host-account-token");
        return receipt;
      },
      readReceipt: async (taskId, id) =>
        taskId === 51 && id === input.requestId ? receipt : null,
      readLocale: async () => "en",
    }),
  );
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
  const base = `http://127.0.0.1:${address.port}/api/tasks/51/coding-session`;
  const headers = {
    Authorization: "Bearer fixture-recovery-operator",
    "Content-Type": "application/json",
  };
  assert.equal((await fetch(base)).status, 401);
  assert.equal(
    (
      await fetch(base + "/recover", {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
      })
    ).status,
    401,
  );
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  const status = await fetch(base, { headers });
  assert.equal(status.status, 200);
  assert.equal(status.headers.get("cache-control"), "no-store");
  assert.ok(
    GetCodexSessionRecoveryResponse.safeParse(await status.json()).success,
  );
  for (const bad of [
    { ...input, acknowledgeUncertainEffects: false },
    { ...input, expectedRevision: 4.5 },
    { ...input, home: "/outside" },
    { ...input, expectedRevision: 9007199254740992 },
    { ...input, requestId: "bad" },
  ])
    assert.equal(
      (
        await fetch(base + "/recover", {
          method: "POST",
          headers,
          body: JSON.stringify(bad),
        })
      ).status,
      400,
    );
  assert.equal(writes, 0);
  const accepted = await fetch(base + "/recover", {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  assert.equal(accepted.status, 200);
  assert.ok(
    RecoverCodexSessionResponse.safeParse(await accepted.json()).success,
  );
  const recovered = await fetch(base + "/recover/" + input.requestId, {
    headers,
  });
  assert.ok(
    GetCodexSessionRecoveryReceiptResponse.safeParse(await recovered.json())
      .success,
  );
  assert.equal(
    (await fetch(base + "/recover/" + randomUUID(), { headers })).status,
    404,
  );
  conflict = true;
  assert.equal(
    (
      await fetch(base + "/recover", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      })
    ).status,
    409,
  );
  conflict = false;
  fail = true;
  for (const [url, options] of [
    [base, { headers }],
    [
      base + "/recover",
      { method: "POST", headers, body: JSON.stringify(input) },
    ],
  ] as const) {
    const response = await fetch(url, options);
    assert.equal(response.status, 503);
    assert.doesNotMatch(
      JSON.stringify(await response.json()),
      /PRIVATE|host|account|token/,
    );
  }
});

test("the real app mounts recovery behind authentication and blocks cross-site writes before committing a receipt", async (t) => {
  await dbReady;
  const token = "fixture-recovery-operator-" + randomUUID();
  const previous = process.env.OPERATOR_AUTH_TOKEN;
  process.env.OPERATOR_AUTH_TOKEN = token;
  t.after(() => {
    if (previous === undefined) delete process.env.OPERATOR_AUTH_TOKEN;
    else process.env.OPERATOR_AUTH_TOKEN = previous;
  });
  const { default: app } = await import("../app");
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: "HTTP fixture", role: "Fixture", systemPrompt: "Fixture" })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "HTTP fixture",
      brief: "Fixture",
      ownerAgentId: agent.id,
      status: "failed",
    })
    .returning();
  t.after(async () => {
    await db
      .delete(codexSessionRecoveriesTable)
      .where(eq(codexSessionRecoveriesTable.taskId, task.id));
    await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
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
  const base = `http://127.0.0.1:${address.port}/api/tasks/${task.id}/coding-session`;
  const input = {
    requestId: randomUUID(),
    expectedRevision: 1,
    acknowledgeUncertainEffects: true,
  };
  const headers = {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  };
  assert.equal((await fetch(base)).status, 401);
  const cross = await fetch(base + "/recover", {
    method: "POST",
    headers: {
      ...headers,
      Origin: "https://untrusted.invalid",
      "Sec-Fetch-Site": "cross-site",
    },
    body: JSON.stringify(input),
  });
  assert.equal(cross.status, 403);
  assert.equal(
    (
      await db
        .select()
        .from(codexSessionRecoveriesTable)
        .where(eq(codexSessionRecoveriesTable.taskId, task.id))
    ).length,
    0,
  );
  const status = await fetch(base, { headers });
  assert.equal(status.status, 200);
  const observed = GetCodexSessionRecoveryResponse.parse(await status.json());
  assert.equal(observed.sessionState, "none");
  assert.equal(observed.canReset, false);
  const response = await fetch(base + "/recover", {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 200);
  const rejected = RecoverCodexSessionResponse.parse(await response.json());
  assert.equal(rejected.outcome, "rejected");
  assert.equal(rejected.reason, "session_missing");
  const receipt = await fetch(base + "/recover/" + input.requestId, {
    headers,
  });
  assert.deepEqual(
    GetCodexSessionRecoveryReceiptResponse.parse(await receipt.json()),
    rejected,
  );
});
