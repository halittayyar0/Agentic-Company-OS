import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq, sql } from "drizzle-orm";
import type { createChatCompletion } from "@workspace/ai-server";
import { SendAgentRequestResponse } from "@workspace/api-zod";

delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
process.env.NODE_ENV = "test";
process.env.AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS = "true";
process.env.AGENT_BROWSER_HEADLESS = "true";
const {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  operationReceiptsTable,
  operationInvocationsTable,
  messagesTable,
} = await import("@workspace/db");
const { createAgentRequestsRouter } = await import("./agent-requests");
const { runAgentTurn } = await import("../lib/orchestrator/run-agent-turn");
const { executeTool } = await import("../lib/orchestrator/execute-tool");
const { registerRuntimeInstance, markRuntimeStopped } =
  await import("../lib/orchestrator/runtime-instance-registry");
const { bindHttpRuntimeHandle, releaseHttpRuntimeHandle } =
  await import("../lib/http-runtime-context");
const { readRuntimeOperationsConfig } =
  await import("../lib/runtime-operations-config");
const { specialistPermissionsPreset } =
  await import("../lib/orchestrator/permission-presets");
const { agentConfigVersion } = await import("../lib/agent-config-version");
const { WORKSPACE_LOCALES } = await import("../lib/workspace-locale");
const { toolMessage } = await import("../lib/orchestrator/tool-localization");
const browser = await import("../lib/vm/browser");
await dbReady;
const runtime = await registerRuntimeInstance(
  {
    role: "combined",
    schedulerEnabled: true,
    capabilities: { http: true, scheduler: true },
  },
  readRuntimeOperationsConfig({ RUNTIME_ROLE: "combined" }),
);
bindHttpRuntimeHandle(runtime);
// Fail the real receipt completion write after the real browser effect. The
// unknown-state write is permitted, including its atomic lease fence.
await db.execute(
  sql`CREATE FUNCTION fixture_fail_chat_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture receipt completion unavailable'; END; $$`,
);
await db.execute(
  sql`CREATE TRIGGER fixture_fail_chat_completion BEFORE UPDATE ON operation_receipts FOR EACH ROW WHEN (NEW.state = 'succeeded' AND NEW.tool_name = 'browser_scroll') EXECUTE FUNCTION fixture_fail_chat_completion()`,
);
test.after(async () => {
  await browser.closeAllSessions();
  await db.execute(
    sql`DROP TRIGGER fixture_fail_chat_completion ON operation_receipts`,
  );
  await db.execute(sql`DROP FUNCTION fixture_fail_chat_completion()`);
  releaseHttpRuntimeHandle(runtime);
  await markRuntimeStopped(runtime);
  await closeDatabase();
});

const scenarios = [
  ...WORKSPACE_LOCALES.map((locale) => ({ locale, mode: "normal" as const })),
  ...(
    [
      "replacement",
      "missing-receipt",
      "wrong-source",
      "wrong-lease",
      "wrong-worker",
      "wrong-call",
      "inactive",
    ] as const
  ).map((mode) => ({ locale: "en" as const, mode })),
];
for (const { locale, mode } of scenarios) {
  test(`${locale}/${mode}: real unknown chat effect finalizes only its exact fenced request`, async (t) => {
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: randomUUID(),
        role: "Test",
        systemPrompt: "Test only",
        modelMode: "manual",
        modelId: "minimax/minimax-m3:free",
        createdByUser: true,
        permissions: { ...specialistPermissionsPreset, canBrowse: true },
      })
      .returning();
    let providers = 0,
      dispatches = 0;
    const createCompletion: typeof createChatCompletion = async () => {
      providers++;
      return {
        provider: "ollama",
        completion: {
          id: randomUUID(),
          object: "chat.completion",
          created: 1,
          model: "fixture",
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              logprobs: null,
              message: {
                role: "assistant",
                content: null,
                refusal: null,
                tool_calls: [
                  {
                    type: "function",
                    id: "one-scroll",
                    function: {
                      name: "browser_scroll",
                      arguments: '{"direction":"down","pixels":320}',
                    },
                  },
                ],
              },
            },
          ],
        },
      };
    };
    const app = express();
    app.use(express.json());
    app.get("/fixture-page", (_req, res) =>
      res.send(
        '<!doctype html><title>Original page</title><body style="height:4000px"><h1>Original page</h1></body>',
      ),
    );
    const replacementOwner = `replacement:${randomUUID()}`;
    app.use(
      "/api",
      createAgentRequestsRouter({
        runTurn: (owner, content, model, task, deps) =>
          runAgentTurn(owner, content, model, task, {
            ...deps!,
            createCompletion,
            runTool: async (...args) => {
              dispatches++;
              const result = await executeTool(...args);
              assert.equal(result.toolOutcome, "unknown");
              assert.ok(result.receiptId);
              if (mode === "replacement") {
                await db
                  .update(agentsTable)
                  .set({
                    runLeaseOwner: replacementOwner,
                    runLeaseExpiresAt: new Date(Date.now() + 60_000),
                    status: "working",
                    currentAction: "Replacement work",
                  })
                  .where(eq(agentsTable.id, agent.id));
              } else if (mode === "missing-receipt") {
                return { ...result, receiptId: randomUUID() };
              } else if (mode === "wrong-source") {
                const [otherMessage] = await db
                  .insert(messagesTable)
                  .values({
                    agentId: agent.id,
                    role: "user",
                    content: "Another request",
                  })
                  .returning();
                await db
                  .update(operationReceiptsTable)
                  .set({
                    sourceMessageId: otherMessage.id,
                    logicalExecutionId: `chat:${otherMessage.id}`,
                  })
                  .where(eq(operationReceiptsTable.id, result.receiptId));
              } else if (mode === "wrong-lease") {
                await db
                  .update(operationInvocationsTable)
                  .set({ agentLeaseOwner: "another-original-owner" })
                  .where(
                    eq(operationInvocationsTable.receiptId, result.receiptId),
                  );
              } else if (mode === "wrong-worker") {
                await db
                  .update(operationInvocationsTable)
                  .set({ workerInstanceId: null })
                  .where(
                    eq(operationInvocationsTable.receiptId, result.receiptId),
                  );
              } else if (mode === "wrong-call") {
                await db
                  .update(operationInvocationsTable)
                  .set({ modelToolCallId: "another-call" })
                  .where(
                    eq(operationInvocationsTable.receiptId, result.receiptId),
                  );
              } else if (mode === "inactive") {
                await db
                  .update(agentsTable)
                  .set({ isActive: false })
                  .where(eq(agentsTable.id, agent.id));
              }
              return result;
            },
          }),
      }),
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    t.after(async () => {
      await browser.closeSession(agent.id);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const base = `http://127.0.0.1:${address.port}`;
    await browser.navigateTo(agent.id, `${base}/fixture-page`);
    const input = {
      requestId: randomUUID(),
      kind: "ask",
      locale,
      content: "Scroll the page once.",
      expectedConfig: agentConfigVersion(agent),
    };
    const endpoint = `${base}/api/agents/${agent.id}/requests`;
    const send = async () => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      return SendAgentRequestResponse.parse(await response.json());
    };
    const first = await send();
    const replay = await send();
    const recovered = SendAgentRequestResponse.parse(
      await (await fetch(`${endpoint}/${input.requestId}`)).json(),
    );
    const [receipt] = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.agentId, agent.id));
    assert.equal(receipt.state, "unknown");
    const invocations = await db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.receiptId, receipt.id));
    assert.equal(invocations.length, 1);
    assert.equal(invocations[0].state, "unknown");
    assert.ok(invocations[0].effectStartedAt);
    assert.equal(dispatches, 1);
    assert.equal(providers, 1);
    if (!["normal", "replacement"].includes(mode)) {
      assert.equal(first.deliveryState, "unconfirmed", JSON.stringify(first));
      assert.equal(replay.deliveryState, "unconfirmed");
      assert.equal(recovered.deliveryState, "unconfirmed");
      const messages = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.agentId, agent.id));
      assert.ok(
        messages.every((message) => message.role === "user"),
        "foreign or incomplete evidence must not authorize a final notice",
      );
      return;
    }
    assert.equal(first.deliveryState, "complete", JSON.stringify(first));
    assert.equal(first.outcome, "tool_outcome_unknown");
    assert.ok(first.agentMessage);
    assert.ok(replay.agentMessage);
    assert.ok(recovered.agentMessage);
    assert.equal(first.agentMessage.role, "system");
    assert.ok(
      first.agentMessage.content.includes(
        toolMessage(locale, "receiptLabel", { id: receipt.id }),
      ),
    );
    assert.equal(replay.agentMessage.id, first.agentMessage.id);
    assert.equal(recovered.agentMessage.id, first.agentMessage.id);
    assert.equal(recovered.outcome, "tool_outcome_unknown");
    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.agentId, agent.id));
    assert.equal(messages.length, 2);
    const [savedAgent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, agent.id));
    assert.equal(
      savedAgent.runLeaseOwner,
      mode === "replacement" ? replacementOwner : null,
    );
    if (mode === "replacement") {
      assert.equal(savedAgent.status, "working");
      assert.equal(savedAgent.currentAction, "Replacement work");
    }
  });
}
