import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import type { ToolRuntimeContext } from "./execute-tool";
import type { WorkspaceLocale } from "../workspace-locale";

delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
process.env.NODE_ENV = "test";
process.env.AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS = "true";
process.env.AGENT_BROWSER_HEADLESS = "true";
const root = await fsp.mkdtemp(path.join(os.tmpdir(), "acos-tool-recovery-"));
process.env.AGENT_SANDBOX_ROOT = root;
const {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  runtimeInstancesTable,
  operationReceiptsTable,
  operationInvocationsTable,
  activityEventsTable,
  messagesTable,
} = await import("@workspace/db");
const { executeTool, runDurableExternalEffect } =
  await import("./execute-tool");
const {
  reserveOperation,
  claimOperationInvocation,
  markOperationRunning,
  markOperationUnknown,
} = await import("./operation-receipts");
const { terminalMessage } = await import("../vm/terminal-localization");
const { getToolCopy, toolMessage } = await import("./tool-localization");
const { specialistPermissionsPreset } = await import("./permission-presets");
const { WORKSPACE_LOCALES } = await import("../workspace-locale");
const { readTextFile, writeTextFile } = await import("../vm/sandbox");
const browser = await import("../vm/browser");
const source = "  原文 {path} $&\n\n  العربية  \n";
let requests = 0;
const server = createServer((_request, response) => {
  requests++;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    `<!doctype html><title>Original {title}</title><pre>${source.replaceAll("&", "&amp;")}</pre>`,
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}/`;
test.after(async () => {
  await browser.closeAllSessions();
  await closeDatabase();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fsp.rm(root, { recursive: true, force: true });
});

async function context(locale: WorkspaceLocale): Promise<ToolRuntimeContext> {
  await dbReady;
  const id = randomUUID();
  const leaseOwner = `locale:${id}`;
  const expiresAt = new Date(Date.now() + 180_000);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Original {name} ${id}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: expiresAt,
      permissions: {
        ...specialistPermissionsPreset,
        canBrowse: true,
        canUseTerminal: true,
      },
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Original task",
      brief: "Local test only",
      ownerAgentId: agent.id,
      createdByUser: true,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt: expiresAt,
      stepAttempts: 1,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  const runtimeInstanceId = `locale-runtime:${id}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeInstanceId,
    role: "worker",
    state: "healthy",
    hostname: "locale-test",
    processId: 1381,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: new Date(),
  });
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task.id,
    agentId: agent.id,
    workerInstanceId: runtimeInstanceId,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
  });
  return {
    agent,
    taskId: task.id,
    taskLeaseOwner: leaseOwner,
    runtimeAttemptId: attemptId,
    locale,
    assertTaskLease: async () => undefined,
    operationIdentity: {
      executionKind: "task_step",
      logicalExecutionId,
      runtimeInstanceId,
      originAttemptId: attemptId,
      sourceMessageId: null,
      modelToolCallId: `call:${id}`,
      callSlot: "round:0:tool:0",
      agentLeaseOwner: leaseOwner,
    },
  };
}

async function reserve(
  ctx: ToolRuntimeContext,
  toolName: string,
  args: Record<string, unknown>,
) {
  const rejected = {
    content: "Fixture: interrupted before effect",
    toolOutcome: "rejected" as const,
    createdAgents: [],
    createdTasks: [],
  };
  const result = await runDurableExternalEffect(ctx, {
    toolName,
    normalizedArgs: args,
    execute: async () => ({ result: rejected }),
    onError: async () => rejected,
  });
  assert.equal(result.toolOutcome, "rejected");
  assert.ok(result.receiptId);
  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, result.receiptId));
  assert.equal(receipt.state, "reserved");
  return { receipt };
}

test("actual file write after a reserved interruption uses the original language and exact bytes", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale);
    const filename = "Original {path}.txt";
    const byteCount = Buffer.byteLength(source, "utf8");
    const reserved = await reserve(ctx, "vm_write_file", {
      path: filename,
      contentHash: `sha256:${createHash("sha256").update(source).digest("hex")}`,
      byteCount,
    });
    ctx.locale = locale === "en" ? "ar" : "en";
    const result = await executeTool(
      ctx,
      "vm_write_file",
      JSON.stringify({ path: filename, content: source }),
    );
    assert.equal(result.toolOutcome, "succeeded", result.content);
    assert.equal(result.receiptId, reserved.receipt.id);
    assert.ok(
      result.content.includes(
        toolMessage(locale, "fileWriteComplete", {
          path: filename,
          bytes: byteCount,
        }),
      ),
      result.content,
    );
    assert.equal((await readTextFile(ctx.agent.id, filename)).content, source);
    const [saved] = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, result.receiptId!));
    assert.equal(saved.resultData?.executionLocale, locale);
    const [event] = await db
      .select()
      .from(activityEventsTable)
      .where(
        and(
          eq(activityEventsTable.agentId, ctx.agent.id),
          eq(activityEventsTable.type, "vm_file"),
        ),
      );
    assert.equal(
      event.summary,
      toolMessage(locale, "fileWritten", {
        name: ctx.agent.name,
        path: filename,
        bytes: byteCount,
      }),
    );
  }
});

test("actual read-only retry retains language and replay does not return stale file content", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale);
    const args = JSON.stringify({ path: "read.txt" });
    const failed = await executeTool(ctx, "vm_read_file", args);
    assert.equal(failed.toolOutcome, "rejected");
    assert.ok(failed.receiptId);
    await writeTextFile(ctx.agent.id, "read.txt", source);
    ctx.locale = locale === "en" ? "ar" : "en";
    const retried = await executeTool(ctx, "vm_read_file", args);
    assert.equal(retried.toolOutcome, "succeeded");
    assert.equal(retried.receiptId, failed.receiptId);
    const readEvents = await db
      .select()
      .from(activityEventsTable)
      .where(
        and(
          eq(activityEventsTable.agentId, ctx.agent.id),
          eq(activityEventsTable.type, "vm_file"),
        ),
      );
    assert.ok(
      readEvents.some(
        (event) =>
          event.summary ===
          toolMessage(locale, "fileRead", {
            name: ctx.agent.name,
            path: "read.txt",
          }),
      ),
      JSON.stringify(readEvents.map((event) => event.summary)),
    );
    assert.ok(retried.content.includes(source));
    await writeTextFile(ctx.agent.id, "read.txt", "changed after completion");
    ctx.locale = "en";
    const replay = await executeTool(ctx, "vm_read_file", args);
    assert.equal(replay.toolOutcome, "deferred");
    assert.match(replay.content, /read.*already completed/i);
    assert.ok(!replay.content.includes(source));
    assert.ok(!replay.content.includes("changed after completion"));
    const [saved] = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, replay.receiptId!));
    assert.deepEqual(saved.resultData, { executionLocale: locale });
  }
});

test("actual browser navigation after reservation retains its first language and is not replayed", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale);
    const reserved = await reserve(ctx, "browser_open", { url });
    ctx.locale = locale === "en" ? "ar" : "en";
    const opened = await executeTool(
      ctx,
      "browser_open",
      JSON.stringify({ url }),
    );
    assert.equal(opened.toolOutcome, "succeeded", opened.content);
    assert.equal(opened.receiptId, reserved.receipt.id);
    assert.ok(
      opened.content.includes(getToolCopy(locale).browserVisibleText),
      opened.content,
    );
    assert.ok(opened.content.includes(source));
    const before = requests;
    const replay = await executeTool(
      ctx,
      "browser_open",
      JSON.stringify({ url }),
    );
    assert.equal(replay.toolOutcome, "succeeded");
    assert.equal(requests, before);
    const [saved] = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, opened.receiptId!));
    assert.equal(saved.resultData?.executionLocale, locale);
    await browser.closeSession(ctx.agent.id);
  }
});

for (const toolName of ["vm_read_file", "log_note"] as const) {
  test(`${toolName} busy and unknown receipts use the display language without dispatching again`, async () => {
    const ctx = await context("tr");
    const [sourceMessage] = await db
      .insert(messagesTable)
      .values({
        agentId: ctx.agent.id,
        role: "user",
        content: "Fixture original request",
      })
      .returning();
    const identity = {
      ...ctx.operationIdentity!,
      executionKind: "chat_turn" as const,
      logicalExecutionId: `chat:${sourceMessage.id}`,
      originAttemptId: null,
      sourceMessageId: sourceMessage.id,
      runtimeInstanceId: null,
    };
    const chatCtx: ToolRuntimeContext = {
      ...ctx,
      taskId: null,
      operationIdentity: identity,
    };
    const args =
      toolName === "vm_read_file"
        ? { path: "unread.txt" }
        : { summary: "Must not be inserted" };
    const reservation = await reserveOperation({
      canonicalVersion: 1,
      executionKind: "chat_turn",
      logicalExecutionId: identity.logicalExecutionId,
      toolName,
      args,
      executionLocale: "tr",
      physical: {
        attemptId: null,
        workerInstanceId: null,
        modelToolCallId: identity.modelToolCallId,
        callSlot: identity.callSlot,
      },
      taskId: null,
      agentId: ctx.agent.id,
      approvalId: null,
      sourceMessageId: sourceMessage.id,
      originAttemptId: null,
      sideEffectClass: toolName === "log_note" ? "transactional" : "read_only",
    });
    const claim = await claimOperationInvocation({
      receiptId: reservation.receipt.id,
      executionKind: "chat_turn",
      attemptId: null,
      workerInstanceId: null,
      modelToolCallId: identity.modelToolCallId,
      leaseOwner: `held:${randomUUID()}`,
      leaseExpiresAt: new Date(Date.now() + 120_000),
      taskLeaseOwner: null,
      agentLeaseOwner: identity.agentLeaseOwner,
    });
    assert.ok(claim.invocation);
    for (const locale of WORKSPACE_LOCALES) {
      const busy = await executeTool(
        { ...chatCtx, locale },
        toolName,
        JSON.stringify(args),
      );
      assert.equal(busy.toolOutcome, "deferred");
      assert.equal(
        busy.content,
        terminalMessage(locale, "receiptBusy", { id: reservation.receipt.id }),
      );
    }
    const owner = {
      receiptId: reservation.receipt.id,
      invocationId: claim.invocation.id,
      leaseOwner: claim.invocation.leaseOwner,
    };
    await markOperationRunning(owner);
    await markOperationUnknown({
      ...owner,
      failureKind: "fixture_unknown",
      sanitizedError: "Fixture only",
    });
    for (const locale of WORKSPACE_LOCALES) {
      const unknown = await executeTool(
        { ...chatCtx, locale },
        toolName,
        JSON.stringify(args),
      );
      assert.equal(unknown.toolOutcome, "unknown");
      assert.equal(
        unknown.content,
        terminalMessage(locale, "receiptUnknown", {
          id: reservation.receipt.id,
        }),
      );
    }
    const invocations = await db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.receiptId, reservation.receipt.id));
    assert.equal(invocations.length, 1);
    assert.equal(invocations[0].state, "unknown");
    const inserted = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.summary, "Must not be inserted"));
    assert.equal(inserted.length, 0);
  });
}
