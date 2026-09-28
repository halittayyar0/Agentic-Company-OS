import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { createChatCompletion } from "@workspace/ai-server";
import type { WorkspaceLocale } from "../workspace-locale";
import type { ToolRuntimeContext } from "./execute-tool";

delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
process.env.NODE_ENV = "test";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid/v1";
const root = await fsp.mkdtemp(path.join(os.tmpdir(), "acos-terminal-outer-"));
process.env.AGENT_SANDBOX_ROOT = root;
const {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  approvalRequestsTable,
  operationReceiptsTable,
  activityEventsTable,
} = await import("@workspace/db");
const { readRuntimeOperationsConfig } =
  await import("../runtime-operations-config");
const { registerRuntimeInstance } = await import("./runtime-instance-registry");
const { runAgentTurn } = await import("./run-agent-turn");
const { stepTask } = await import("./step-task");
const { executeTool, executeApprovedAction } = await import("./execute-tool");
const { specialistPermissionsPreset } = await import("./permission-presets");
const { writeTextFile, readTextFile } = await import("../vm/sandbox");
const { terminalMessage, getTerminalCopy } =
  await import("../vm/terminal-localization");
const { getToolCopy, toolMessage } = await import("./tool-localization");

test.after(async () => {
  await closeDatabase();
  await fsp.rm(root, { recursive: true, force: true });
});

for (const toolName of ["vm_run_command", "vm_read_file"] as const) {
  for (const [mode, outcome] of [
    ["chat", "unknown"],
    ["task", "unknown"],
    ["task", "deferred"],
  ] as const) {
    test(`${toolName} ${mode} ${outcome} shares one captured locale between the prompt and every dispatched tool`, async (t) => {
      await dbReady;
      const config = readRuntimeOperationsConfig({
        RUNTIME_ROLE: mode === "chat" ? "api" : "worker",
      });
      const runtime = await registerRuntimeInstance(
        {
          role: mode === "chat" ? "api" : "worker",
          schedulerEnabled: mode === "task",
          capabilities: { http: mode === "chat", scheduler: mode === "task" },
        },
        config,
      );
      t.after(() => runtime.stopHeartbeat());
      const leaseOwner = `terminal-outer:${randomUUID()}`;
      const expiry = new Date(Date.now() + 120_000);
      const [agent] = await db
        .insert(agentsTable)
        .values({
          name: `Locale ${mode}`,
          role: "Test",
          systemPrompt: "Test only",
          createdByUser: true,
          permissions: specialistPermissionsPreset,
          ...(mode === "task"
            ? {
                status: "working" as const,
                runLeaseOwner: leaseOwner,
                runLeaseExpiresAt: expiry,
              }
            : {}),
        })
        .returning();
      const [task] = await db
        .insert(tasksTable)
        .values({
          title: "Terminal locale",
          brief: "Inspect the workspace",
          ownerAgentId: agent.id,
          createdByUser: true,
          ...(mode === "task"
            ? {
                status: "in_progress" as const,
                leaseOwner,
                leaseExpiresAt: expiry,
              }
            : {}),
        })
        .returning();
      const contexts: ToolRuntimeContext[] = [];
      const actions: Array<string | null> = [];
      const prompts: string[] = [];
      const deferred: string[] = [];
      const captured: WorkspaceLocale = mode === "chat" ? "en" : "de";
      const deps = {
        locale: captured as WorkspaceLocale,
        runtimeHandle: runtime,
        runtimeOperationsConfig: config,
        createCompletion: (async (params) => {
          prompts.push(String(params.messages[0].content));
          deferred.push(
            ...params.messages
              .filter(
                (message) =>
                  message.role === "tool" &&
                  message.tool_call_id === "locale-999",
              )
              .map((message) => String(message.content)),
          );
          deps.locale = "ar";
          return {
            provider: "replit",
            completion: {
              id: randomUUID(),
              object: "chat.completion",
              created: 1,
              model: params.model,
              choices: [
                {
                  index: 0,
                  finish_reason: "tool_calls",
                  logprobs: null,
                  message: {
                    role: "assistant",
                    content: null,
                    refusal: null,
                    tool_calls: (prompts.length === 1 ? [0, 999] : [1]).map(
                      (i) => ({
                        id: `locale-${i}`,
                        type: "function" as const,
                        function: {
                          name: toolName,
                          arguments: JSON.stringify(
                            toolName === "vm_run_command"
                              ? { command: i === 0 ? "help" : "pwd" }
                              : { path: "source.txt" },
                          ),
                        },
                      }),
                    ),
                  },
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            },
          };
        }) satisfies typeof createChatCompletion,
        runTool: (async (ctx) => {
          contexts.push(ctx);
          const [live] = await db
            .select()
            .from(agentsTable)
            .where(eq(agentsTable.id, ctx.agent.id));
          actions.push(live.currentAction);
          return {
            content: "fixture",
            createdTasks: [],
            createdAgents: [],
            toolOutcome: contexts.length === 1 ? "succeeded" : outcome,
            receiptId: "fixture-unknown",
          };
        }) satisfies typeof executeTool,
      };
      if (mode === "chat") {
        await runAgentTurn(
          agent,
          toolName === "vm_run_command"
            ? "Only use the terminal to inspect the workspace"
            : "Only use files to inspect the workspace",
          { modelMode: "manual", modelId: "minimax/minimax-m3:free" },
          task,
          deps,
        );
      } else {
        await db
          .update(agentsTable)
          .set({ currentTaskId: task.id })
          .where(eq(agentsTable.id, agent.id));
        const runtimeAttemptId = randomUUID();
        const logicalExecutionId = randomUUID();
        await db.insert(taskAttemptsTable).values({
          id: runtimeAttemptId,
          taskId: task.id,
          agentId: agent.id,
          workerInstanceId: runtime.id,
          leaseOwner,
          attemptNumber: 1,
          cycleNumber: 0,
          state: "claimed",
          logicalExecutionId,
        });
        await stepTask(
          {
            ...task,
            leaseOwner,
            runtimeAttemptId,
            runtimeInstanceId: runtime.id,
            logicalExecutionId,
          },
          deps,
        );
      }
      assert.equal(prompts.length, 2);
      assert.ok(
        prompts.every((prompt) =>
          prompt.includes(`<workspace_language locale="${captured}">`),
        ),
      );
      assert.equal(contexts.length, 2);
      assert.deepEqual(
        actions,
        Array(2).fill(
          toolName === "vm_run_command"
            ? getTerminalCopy(captured).terminalDispatch
            : getToolCopy(captured).readDispatch,
        ),
      );
      assert.deepEqual(
        contexts.map((ctx) => ctx.locale),
        [captured, captured],
      );
      assert.ok(contexts.every((ctx) => ctx.operationIdentity));
      assert.deepEqual(deferred, [
        terminalMessage(captured, "computerDeferred", { tool: toolName }),
      ]);
      const events = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.agentId, agent.id));
      if (mode === "chat") {
        assert.equal(
          events.find((event) => event.detail?.outcome === "activated")
            ?.summary,
          terminalMessage(captured, "scopeActivated", {
            tools:
              toolName === "vm_run_command"
                ? "vm_run_command"
                : "vm_list_files, vm_read_file",
          }),
        );
      } else {
        const key =
          outcome === "unknown" ? "taskUnknownStopped" : "taskDeferred";
        const [savedTask] = await db
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, task.id));
        assert.equal(
          savedTask.lastError,
          `${terminalMessage(captured, key)} ${toolMessage(captured, "receiptLabel", { id: "fixture-unknown" })}.`,
        );
        assert.equal(
          events.find(
            (event) =>
              event.detail?.runtimeEvent ===
              (outcome === "unknown"
                ? "operation_outcome_unknown"
                : "operation_deferred"),
          )?.summary,
          terminalMessage(captured, key),
        );
      }
      assert.equal(
        events.filter(
          (event) =>
            event.summary ===
            terminalMessage(captured, "computerSelected", {
              name: agent.name,
              tool: toolName,
            }),
        ).length,
        2,
      );
    });
  }
}

test("approved Terminal execution captures locale before claim and retains exact capability identity", async (t) => {
  await dbReady;
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  t.after(() => runtime.stopHeartbeat());
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approved locale",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: { ...specialistPermissionsPreset, canDelete: true },
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Delete test fixture",
      brief: "Temporary test directory only",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const args = { command: "rm approved.txt" };
  const argsHash = createHash("sha256")
    .update(JSON.stringify(args))
    .digest("hex");
  await writeTextFile(agent.id, "approved.txt", "test");
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "delete",
      title: "Delete fixture",
      description: "Test fixture only",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 120_000),
      scope: { toolName: "vm_run_command", argsHash },
      actionPayload: {
        toolName: "vm_run_command",
        args,
        taskDisposition: "complete",
      },
    })
    .returning();
  const contexts: ToolRuntimeContext[] = [];
  const actions: Array<string | null> = [];
  const deps = {
    locale: "en" as WorkspaceLocale,
    runtimeInstanceId: runtime.id,
    afterClaimLocksBeforeTimestamp: async () => {
      deps.locale = "ar";
    },
    executeAction: (async (ctx, name, raw) => {
      contexts.push(ctx);
      await ctx.assertTaskLease?.();
      const [liveAgent] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, ctx.agent.id));
      actions.push(liveAgent.currentAction);
      return executeTool(ctx, name, raw);
    }) satisfies typeof executeTool,
  };
  const result = await executeApprovedAction(approval.id, config, deps);
  assert.equal(result.claimed, true);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].locale, "en");
  assert.deepEqual(actions, [
    terminalMessage("en", "approvedAction", { tool: "vm_run_command" }),
  ]);
  assert.deepEqual(contexts[0].preapprovedAction?.capabilityArgs, args);
  assert.equal(contexts[0].preapprovedAction?.argsHash, argsHash);
  await assert.rejects(readTextFile(agent.id, "approved.txt"));
  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.approvalId, approval.id));
  assert.equal(receipt.argumentHash, argsHash);
  assert.equal(receipt.resultData?.executionLocale, "en");
  const [completed] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.equal(
    completed.resultSummary,
    terminalMessage("en", "approvedCompleted", {
      tool: "vm_run_command",
      exitCode: 0,
    }),
  );
  const replay = await executeApprovedAction(approval.id, config, {
    ...deps,
    locale: "de",
  });
  assert.equal(replay.claimed, false);
  assert.equal(contexts.length, 1);
});
