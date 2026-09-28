import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:http";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import type { ToolRuntimeContext } from "./execute-tool";

delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
process.env.NODE_ENV = "test";
process.env.AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS = "true";
process.env.AGENT_BROWSER_HEADLESS = "true";
const root = await fsp.mkdtemp(
  path.join(os.tmpdir(), "acos-screenshot-recovery-"),
);
process.env.AGENT_SANDBOX_ROOT = root;
const {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  messagesTable,
  operationReceiptsTable,
  operationInvocationsTable,
} = await import("@workspace/db");
const { executeTool } = await import("./execute-tool");
const {
  reserveOperation,
  canonicalizeJson,
  recoverInterruptedOperation,
  claimOperationInvocation,
  releaseOperationForSafeRetry,
} = await import("./operation-receipts");
const { registerRuntimeInstance, markRuntimeStopped } =
  await import("./runtime-instance-registry");
const { readRuntimeOperationsConfig } =
  await import("../runtime-operations-config");
const { specialistPermissionsPreset } = await import("./permission-presets");
const browser = await import("../vm/browser");
const { safeResolve } = await import("../vm/sandbox");
await dbReady;
const runtime = await registerRuntimeInstance(
  {
    role: "combined",
    schedulerEnabled: true,
    capabilities: { http: true, scheduler: true },
  },
  readRuntimeOperationsConfig({ RUNTIME_ROLE: "combined" }),
);
const server = createServer((request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(
    `<!doctype html><title>Evidence ${request.url === "/a" ? "A" : "B"}</title><body style="background:${request.url === "/a" ? "red" : "blue"}"><h1>${request.url === "/a" ? "A" : "B"}</h1></body>`,
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
test.after(async () => {
  await browser.closeAllSessions();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await markRuntimeStopped(runtime);
  await closeDatabase();
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  await fsp.rm(root, { recursive: true, force: true });
});

for (const mode of [
  "completion-lost",
  "stale",
  "legacy-stale",
  "legacy-released-claim",
  "legacy-released-recover",
  "legacy-old-key",
  "legacy-succeeded",
  "legacy-before-effect",
] as const) {
  test(`${mode}: screenshot retry preserves original pixels and durable identity`, async (t) => {
    const owner = `screenshot-owner:${randomUUID()}`;
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: randomUUID(),
        role: "Test",
        systemPrompt: "Test only",
        createdByUser: true,
        status: "working",
        runLeaseOwner: owner,
        runLeaseExpiresAt: new Date(Date.now() + 180_000),
        permissions: {
          ...specialistPermissionsPreset,
          canBrowse: true,
          canUseTerminal: false,
        },
      })
      .returning();
    const [source] = await db
      .insert(messagesTable)
      .values({
        agentId: agent.id,
        role: "user",
        content: "Save evidence once",
      })
      .returning();
    const identity = {
      executionKind: "chat_turn" as const,
      logicalExecutionId: `chat:${source.id}`,
      runtimeInstanceId: runtime.id,
      originAttemptId: null,
      sourceMessageId: source.id,
      modelToolCallId: "capture-a",
      callSlot: "round:0:tool:0",
      agentLeaseOwner: owner,
    };
    const ctx: ToolRuntimeContext = {
      agent,
      locale: "en",
      taskId: null,
      operationIdentity: identity,
    };
    const args = { name: "evidence.png" };
    let legacyId: string | undefined;
    if (mode.startsWith("legacy")) {
      const externalIdempotencyKey = `effect:v1:${createHash("sha256")
        .update(
          canonicalizeJson({
            logicalExecutionId: identity.logicalExecutionId,
            toolName: "browser_save_screenshot",
            args,
          }),
        )
        .digest("hex")}`;
      const legacy = await reserveOperation({
        canonicalVersion: 1,
        executionKind: "chat_turn",
        logicalExecutionId: identity.logicalExecutionId,
        toolName: "browser_save_screenshot",
        args,
        physical: {
          attemptId: null,
          workerInstanceId: runtime.id,
          modelToolCallId: identity.modelToolCallId,
          callSlot: identity.callSlot,
        },
        taskId: null,
        agentId: agent.id,
        approvalId: null,
        sourceMessageId: source.id,
        originAttemptId: null,
        sideEffectClass: "idempotent",
        externalIdempotencyKey,
        executionLocale: "en",
      });
      legacyId = legacy.receipt.id;
      if (mode === "legacy-old-key") {
        // The pre-canonical-replay format used the external key as replay key.
        await db
          .update(operationReceiptsTable)
          .set({ replayKey: externalIdempotencyKey })
          .where(eq(operationReceiptsTable.id, legacyId));
      }
      if (mode === "legacy-before-effect") {
        const claim = await claimOperationInvocation({
          receiptId: legacyId,
          executionKind: "chat_turn",
          attemptId: null,
          workerInstanceId: runtime.id,
          modelToolCallId: "before-capture",
          leaseOwner: "before-capture",
          leaseExpiresAt: new Date(Date.now() + 60_000),
          taskLeaseOwner: null,
          agentLeaseOwner: owner,
        });
        assert.ok(claim.invocation);
        await releaseOperationForSafeRetry({
          receiptId: legacyId,
          invocationId: claim.invocation.id,
          leaseOwner: "before-capture",
          failureKind: "fixture_pre_effect",
          sanitizedError: "No image captured",
        });
      }
    }
    const succeeds =
      mode === "legacy-succeeded" || mode === "legacy-before-effect";
    const stale = mode === "stale" || mode === "legacy-stale";
    let triggerInstalled = false;
    const dropTrigger = async () => {
      if (!triggerInstalled) return;
      await db.execute(
        sql`DROP TRIGGER fixture_fail_screenshot_completion ON operation_receipts`,
      );
      await db.execute(sql`DROP FUNCTION fixture_fail_screenshot_completion()`);
      triggerInstalled = false;
    };
    t.after(async () => {
      await dropTrigger();
      await browser.closeSession(agent.id);
    });
    if (!succeeds) {
      await db.execute(
        sql`CREATE FUNCTION fixture_fail_screenshot_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture screenshot persistence unavailable'; END; $$`,
      );
      // The stale cases also lose the unknown/retry write, leaving the real
      // published image behind a running receipt, as with an outage.
      await db.execute(
        stale
          ? sql`CREATE TRIGGER fixture_fail_screenshot_completion BEFORE UPDATE ON operation_receipts FOR EACH ROW WHEN (OLD.state='running' AND NEW.state IN ('succeeded','unknown','reserved') AND NEW.tool_name='browser_save_screenshot') EXECUTE FUNCTION fixture_fail_screenshot_completion()`
          : sql`CREATE TRIGGER fixture_fail_screenshot_completion BEFORE UPDATE ON operation_receipts FOR EACH ROW WHEN (NEW.state='succeeded' AND NEW.tool_name='browser_save_screenshot') EXECUTE FUNCTION fixture_fail_screenshot_completion()`,
      );
      triggerInstalled = true;
    }
    await browser.navigateTo(agent.id, `${base}/a`);
    const first = await executeTool(
      ctx,
      "browser_save_screenshot",
      JSON.stringify(args),
    );
    assert.ok(first.receiptId);
    if (legacyId) assert.equal(first.receiptId, legacyId);
    const artifact = safeResolve(
      agent.id,
      "ekran-goruntuleri/evidence.png",
    ).abs;
    const original = await fsp.readFile(artifact);
    assert.ok(original.length > 100);
    await dropTrigger();
    const [before] = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, first.receiptId));
    const [invocation] = await db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.receiptId, first.receiptId))
      .orderBy(sql`${operationInvocationsTable.claimedAt} DESC`);
    assert.ok(invocation.effectStartedAt);
    if (mode.includes("released") || mode === "legacy-old-key") {
      // Reconstruct the persisted state left by the old unsafe retry policy,
      // using an actually published image, rather than invoking that policy.
      await db
        .update(operationInvocationsTable)
        .set({
          state: "failed",
          finishedAt: new Date(),
          failureKind: "idempotent_effect_failed",
        })
        .where(eq(operationInvocationsTable.id, invocation.id));
      await db
        .update(operationReceiptsTable)
        .set({
          state: "reserved",
          startedAt: null,
          finishedAt: null,
          failureKind: null,
          sanitizedError: null,
        })
        .where(eq(operationReceiptsTable.id, first.receiptId));
    }
    if (stale) {
      assert.equal(before.state, "running");
      await assert.rejects(
        releaseOperationForSafeRetry({
          receiptId: first.receiptId,
          invocationId: invocation.id,
          leaseOwner: invocation.leaseOwner,
          failureKind: "unsafe_retry_probe",
          sanitizedError: "A published screenshot must not be recaptured",
        }),
        /cannot be released for safe retry/,
      );
      await db
        .update(operationInvocationsTable)
        .set({ leaseExpiresAt: new Date(0) })
        .where(eq(operationInvocationsTable.id, invocation.id));
      await db
        .update(agentsTable)
        .set({ runLeaseExpiresAt: new Date(0) })
        .where(eq(agentsTable.id, agent.id));
    }
    if (stale || mode === "legacy-released-recover") {
      const recovered = await recoverInterruptedOperation({
        receiptId: first.receiptId,
        runtimeStaleBefore: new Date(0),
      });
      assert.equal(recovered.disposition, "unknown");
    }
    await db
      .update(agentsTable)
      .set({
        runLeaseOwner: owner,
        runLeaseExpiresAt: new Date(Date.now() + 180_000),
        status: "working",
      })
      .where(eq(agentsTable.id, agent.id));
    await browser.navigateTo(agent.id, `${base}/b`);
    const second = await executeTool(
      {
        ...ctx,
        operationIdentity: {
          ...identity,
          modelToolCallId: "retry-on-page-b",
          callSlot: "round:1:tool:0",
        },
      },
      "browser_save_screenshot",
      JSON.stringify(args),
    );
    assert.equal(
      second.receiptId,
      first.receiptId,
      "class upgrade must not create a second logical operation",
    );
    assert.deepEqual(
      await fsp.readFile(artifact),
      original,
      "retry must not replace page A with page B",
    );
    const invocations = await db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.receiptId, first.receiptId));
    assert.equal(
      invocations.filter((item) => item.effectStartedAt !== null).length,
      1,
    );
    const [after] = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, first.receiptId));
    assert.equal(after.operationKey, before.operationKey);
    assert.equal(after.replayKey, before.replayKey);
    assert.equal(after.externalIdempotencyKey, before.externalIdempotencyKey);
    assert.equal(after.state, succeeds ? "succeeded" : "unknown");
    assert.equal(second.toolOutcome, succeeds ? "succeeded" : "unknown");
    if (!mode.startsWith("legacy"))
      assert.equal(after.sideEffectClass, "at_most_once");
  });
}
