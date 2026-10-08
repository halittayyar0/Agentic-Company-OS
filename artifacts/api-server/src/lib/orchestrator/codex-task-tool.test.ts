import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  executionPolicyTable,
  operationReceiptsTable,
  codexTaskSessionsTable,
  usageEventsTable,
  codexActionApprovalsTable,
} from "@workspace/db";
import { getToolsForAgent } from "./tools";
import { executeTool, executeCodexTaskTool } from "./execute-tool";
import { fixture, nativeFixturePorts } from "../testing/codex-task-fixture";
import { runGovernedCodexTask } from "../codex-task-service";
import { classifyToolSideEffect } from "./operation-receipts";
import { isComputerTool } from "./tool-loop-policy";
import { getCodexTaskCopy } from "../codex-task-copy";
import { loadCompletionEvidence } from "./completion-evidence";
test.after(() => closeDatabase());

test("optional native coding is task-only, plan-only, explicitly configured and follows permissions", async (t) => {
  await dbReady;
  const [policy] = await db.select().from(executionPolicyTable);
  const before = { ...process.env };
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Native catalog fixture",
      role: "Fixture",
      systemPrompt: "Fixture",
    })
    .returning();
  t.after(async () => {
    for (const key of Object.keys(process.env))
      if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
    await db.update(executionPolicyTable).set(policy);
  });
  Object.assign(process.env, {
    ALLOW_AGENT_CODEX_TASKS: "true",
    ALLOW_AGENT_PROCESS_EXEC: "true",
    ACOS_CODEX_EXECUTABLE: process.execPath,
    RUNTIME_ROLE: "combined",
  });
  await db.update(executionPolicyTable).set({ mode: "approval", custom: null });
  const names = async (active: boolean, modelId: string) =>
    (await getToolsForAgent(agent, active, { modelId })).map(
      (tool) => tool.function.name,
    );
  assert.equal(
    (await names(true, "chatgpt:fixture-model")).includes("vm_codex_task"),
    process.platform === "win32" || process.platform === "linux",
  );
  assert.equal(
    (await names(false, "chatgpt:fixture-model")).includes("vm_codex_task"),
    false,
  );
  assert.equal(
    (await names(true, "ollama:fixture-model")).includes("vm_codex_task"),
    false,
  );
  delete process.env.ALLOW_AGENT_CODEX_TASKS;
  assert.equal(
    (await names(true, "chatgpt:fixture-model")).includes("vm_codex_task"),
    false,
  );
  process.env.ALLOW_AGENT_CODEX_TASKS = "true";
  await db.update(executionPolicyTable).set({ mode: "read_only" });
  assert.equal(
    (await names(true, "chatgpt:fixture-model")).includes("vm_codex_task"),
    false,
  );
  assert.equal(
    classifyToolSideEffect({ toolName: "vm_codex_task" }),
    "at_most_once",
  );
  assert.equal(isComputerTool("vm_codex_task"), true);
});

test("native tool refuses model-supplied runtime paths, account and execution controls before effect reservation", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Native args fixture",
      role: "Fixture",
      systemPrompt: "Fixture",
    })
    .returning();
  t.after(() => db.delete(agentsTable).where(eq(agentsTable.id, agent.id)));
  for (const locale of [
    "tr",
    "en",
    "de",
    "ru",
    "zh-CN",
    "zh-TW",
    "ar",
  ] as const) {
    const result = await executeTool(
      { agent, taskId: null, locale },
      "vm_codex_task",
      JSON.stringify({
        prompt: "Fixture",
        executable: process.execPath,
        workspace: "/outside",
        accountId: "private-fixture-account",
      }),
    );
    assert.equal(result.toolOutcome, "rejected");
    assert.match(result.content, /CODEX_ARGUMENTS_INVALID/);
    assert.doesNotMatch(result.content, /private-fixture-account|\/outside/);
  }
  assert.equal(
    (
      await db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.agentId, agent.id))
    ).length,
    0,
  );
});

for (const mode of [
  "completed",
  "lost_after_consumption",
  "failed_after_receipt",
])
  test(`the production native tool envelope preserves ${mode} truth without another inference`, async (t) => {
    const f = await fixture(t);
    await db
      .delete(codexTaskSessionsTable)
      .where(eq(codexTaskSessionsTable.taskId, f.task.id));
    let launches = 0;
    const dependencies = {
      runTask: ((context, input, admission) =>
        runGovernedCodexTask(context, input, {
          ...admission,
          environment: {
            ALLOW_AGENT_CODEX_TASKS: "true",
            ALLOW_AGENT_PROCESS_EXEC: "true",
            ACOS_CODEX_EXECUTABLE: process.execPath,
            CHATGPT_STORAGE_DIRECTORY: path.join(f.root, "private"),
          },
          runtime: {
            store: async () => f.store,
            sessions: async () => ({
              renewRegistration: async () =>
                (await f.store.readActiveRegistration())!,
            }),
          },
          resolveWorkspace: async () => f.workspace,
          processPorts: (input) => {
            const ports = nativeFixturePorts(
              t,
              { ...f, session: input.session! },
              mode,
            );
            return {
              ...ports,
              launch: async (prepared, binding) => {
                launches++;
                return ports.launch(prepared, binding);
              },
            };
          },
        })) as typeof runGovernedCodexTask,
    };
    const args = { prompt: "Complete the governed fixture" };
    const running = executeCodexTaskTool(f.context, args, dependencies);
    void running.catch(() => {});
    const approval = await f.pending();
    assert.equal(
      (
        await f.decide(approval.id, {
          decision: "approved",
          expectedArgsHash: approval.scope?.argsHash,
        })
      ).status,
      200,
    );
    const result = await running;
    if (mode !== "completed") {
      assert.equal(result.toolOutcome, "unknown");
      const payload = JSON.parse(result.content);
      assert.equal(payload.requestStarted, true);
      assert.equal(
        payload.message,
        getCodexTaskCopy(f.context.locale ?? "tr").interrupted,
      );
      assert.equal(payload.usage.totalTokens, 8);
      assert.equal(payload.deliverableVerified, false);
      assert.equal(
        payload.actions.length,
        mode === "failed_after_receipt" ? 1 : 0,
      );
      if (mode === "failed_after_receipt")
        assert.equal(payload.actions[0].status, "completed");
      assert.doesNotMatch(
        result.content,
        /fixture-private|sessionOwnerToken|fixture-account|"session"|"binding"|"threadId"|"turnId"|"itemId"/,
      );
      const replay = await executeCodexTaskTool(f.context, args, dependencies);
      assert.equal(replay.toolOutcome, "unknown");
      assert.equal(launches, 1);
      const [receipt] = await db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.taskId, f.task.id));
      assert.equal(receipt.state, "unknown");
      const [native] = await db
        .select()
        .from(codexActionApprovalsTable)
        .where(eq(codexActionApprovalsTable.taskId, f.task.id));
      assert.equal(
        native.state,
        mode === "failed_after_receipt" ? "receipted" : "uncertain",
      );
      assert.equal(
        (
          await db
            .select()
            .from(codexTaskSessionsTable)
            .where(eq(codexTaskSessionsTable.taskId, f.task.id))
        )[0].state,
        "uncertain",
      );
      const events = await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.taskId, f.task.id));
      assert.equal(events.length, 1);
      assert.equal(events[0].outcome, "failed");
      return;
    }
    assert.equal(result.toolOutcome, "succeeded");
    assert.ok(result.receiptId);
    assert.doesNotMatch(
      result.content,
      /fixture-private|sessionOwnerToken|fixture-account|"session"|"binding"/,
    );
    const replay = await executeCodexTaskTool(f.context, args, dependencies);
    assert.equal(replay.toolOutcome, "succeeded");
    assert.equal(replay.receiptId, result.receiptId);
    assert.equal(launches, 1);
    const [receipt] = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, result.receiptId));
    assert.equal(receipt.state, "succeeded");
    assert.equal(receipt.sideEffectClass, "at_most_once");
    assert.equal(receipt.resultData?.proofScope, "codex_turn");
    assert.equal(receipt.resultData?.deliverableVerified, false);
    assert.equal(receipt.resultData?.nativeItemCount, 1);
    const evidence = await loadCompletionEvidence(f.task);
    const completionReceipt = evidence.receipts.find(
      (item) => item.id === receipt.id,
    );
    assert.equal(completionReceipt?.proofScope, "codex_turn");
    assert.equal(completionReceipt?.deliverableVerified, false);
    assert.equal(completionReceipt?.nativeItemCount, 1);
    assert.equal(evidence.sourceChangeTotal, 0);
    assert.equal(
      (
        await db
          .select()
          .from(usageEventsTable)
          .where(eq(usageEventsTable.taskId, f.task.id))
      ).length,
      1,
    );
  });
