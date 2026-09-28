import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
delete process.env.ALLOW_FOUNDER_SHELL;
process.env.NODE_ENV = "test";
process.env.RUNTIME_CONTROL_KEY = "terminal-locale-test-key-32-characters";
const sandbox = await fsp.mkdtemp(
  path.join(os.tmpdir(), "acos-terminal-http-"),
);
process.env.AGENT_SANDBOX_ROOT = sandbox;
const { db, dbReady, closeDatabase, agentsTable, activityEventsTable } =
  await import("@workspace/db");
const { default: vmRouter } = await import("./vm");
const { createOperatorAuth } = await import("../lib/operator-auth");
const { reserveOperatorRequest, completeOperatorRequest } =
  await import("../lib/operator-requests");
const { WORKSPACE_LOCALES } = await import("../lib/workspace-locale");
const { getTerminalCopy } = await import("../lib/vm/terminal-localization");
const token = "terminal-locale-fixture-auth-token-32-characters";
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
test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDatabase();
  await fsp.rm(sandbox, { recursive: true, force: true });
});
async function agent() {
  await dbReady;
  const [created] = await db
    .insert(agentsTable)
    .values({
      name: "Terminal locale fixture",
      role: "Test",
      systemPrompt: "Test",
    })
    .returning();
  return created;
}
async function execute(agentId: number, body: unknown) {
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

test("HTTP locale is validated before effects and included in immutable replay identity", async () => {
  const created = await agent();
  const before = (await db.select().from(activityEventsTable)).length;
  for (const locale of ["constructor", "fr", null, 1, {}, "EN"]) {
    const response = await execute(created.id, {
      requestId: randomUUID(),
      command: "mkdir invalid",
      as: "sandbox",
      locale,
    });
    assert.equal(response.status, 400);
  }
  assert.equal((await db.select().from(activityEventsTable)).length, before);
  await assert.rejects(fsp.access(path.join(sandbox, `agent-${created.id}`)));
  for (const locale of WORKSPACE_LOCALES) {
    const input = {
      requestId: randomUUID(),
      command: "help",
      as: "sandbox",
      locale,
    };
    const initial = await execute(created.id, input);
    assert.equal(initial.status, 200, `${locale} is accepted`);
    assert.equal(initial.body.receipt.state, "complete");
    assert.ok(
      initial.body.result.stdout.startsWith(
        getTerminalCopy(locale).helpBuiltins,
      ),
    );
    assert.deepEqual(
      await execute(created.id, input),
      initial,
      "replay retains original bytes and metadata",
    );
    assert.equal(
      (
        await execute(created.id, {
          ...input,
          locale: locale === "en" ? "de" : "en",
        })
      ).status,
      409,
    );
    const { locale: _locale, ...omitted } = input;
    assert.equal(
      (await execute(created.id, omitted)).status,
      409,
      "explicit and omitted locale are different reviewed requests",
    );
    const receipt = await fetch(
      `${origin}/${created.id}/operator-requests/${input.requestId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(receipt.status, 200);
    assert.deepEqual(await receipt.json(), initial.body.receipt);
  }
});

test("historical omitted-locale identities replay their original Turkish/source result", async () => {
  const created = await agent();
  const requestId = randomUUID();
  const command = "  echo 原文  ";
  const legacy = await reserveOperatorRequest({
    agentId: created.id,
    requestId,
    kind: "terminal_sandbox",
    input: { command, as: "sandbox" },
  });
  assert.ok(legacy.admitted);
  const original = {
    ok: true,
    exitCode: 0,
    stdout: "  eski kayıt\r\n原文\n",
    stderr: "",
    note: null,
    cwd: "/",
    durationMs: 7,
  };
  const receipt = await completeOperatorRequest(legacy.owner, original);
  const result = await execute(created.id, { requestId, command });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { receipt, result: original });
  assert.equal(
    (await execute(created.id, { requestId, command, locale: "tr" })).status,
    409,
  );
});

test("operator host execution uses the reviewed agent directory without invalid identity zero", async () => {
  const created = await agent();
  process.env.ALLOW_FOUNDER_SHELL = "true";
  try {
    const result = await execute(created.id, {
      requestId: randomUUID(),
      command: "echo controlled-terminal-fixture",
      as: "founder",
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.result.ok, true);
    assert.equal(
      result.body.result.cwd,
      path.join(sandbox, `agent-${created.id}`),
    );
    assert.match(result.body.result.stdout, /controlled-terminal-fixture/);
  } finally {
    delete process.env.ALLOW_FOUNDER_SHELL;
  }
});
