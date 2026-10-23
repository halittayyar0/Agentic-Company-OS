import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  configureOllama,
  configureOpenRouter,
  refreshOllamaCatalog,
  type createChatCompletion,
} from "@workspace/ai-server";
import {
  agentsTable,
  tasksTable,
  taskAttemptsTable,
  operationReceiptsTable,
  activityEventsTable,
  approvalRequestsTable,
  usageEventsTable,
  db,
  dbReady,
  closeDatabase,
} from "@workspace/db";
import { ownedOllamaPeer } from "../../../../../lib/ai-server/src/testing/ollama-boundary-peer";
import { loadFixtureTaskTools } from "../testing/task-tool-fixture";
import { writeTextFile, readTextFile, deleteEntry } from "../vm/sandbox";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { stepTask } from "./step-task";
import { executeTool, type ToolRuntimeContext } from "./execute-tool";
import { startTaskLeaseHeartbeat } from "./task-lease-heartbeat";

test.after(() => closeDatabase());

for (const continuous of [false, true]) {
  for (const verdict of ["pass", "warn", "block"] as const) {
    const accepted = verdict === "pass";
    const pendingReview = verdict === "block";
    test(`real read receipt feeds private review without rereading or saving contents, recurring=${continuous}, verdict=${verdict}`, async (t) => {
      await dbReady;
      const source =
        "SOURCE-OBSERVATION-CANARY: Mira reviews accessibility on 2026-10-26.";
      const replacement = "LATER-FILE-CANARY: changed after the read.";
      const peer = await ownedOllamaPeer({
        complete: (body, response) => {
          const serialized = JSON.stringify(body);
          assert.ok(serialized.includes(source));
          assert.ok(!serialized.includes(replacement));
          response.end(
            JSON.stringify({
              id: randomUUID(),
              object: "chat.completion",
              created: 1,
              model: body.model,
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      verdict,
                      reasonCode: accepted
                        ? "scope_satisfied"
                        : "missing_required_action",
                    }),
                  },
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
          );
        },
      });
      t.after(async () => {
        configureOllama({ baseUrl: null });
        configureOpenRouter({ apiKey: null });
        await peer.close();
      });
      configureOllama({ baseUrl: peer.origin });
      configureOpenRouter({ apiKey: "test-openrouter-key" });
      await refreshOllamaCatalog(true);
      const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
      const runtime = await registerRuntimeInstance(
        { role: "worker", schedulerEnabled: true },
        config,
      );
      t.after(() => runtime.stopHeartbeat());
      const modelId = "ollama:owned:latest";
      const leaseOwner = `owned-local-source-${randomUUID()}`;
      const leaseExpiresAt = new Date(Date.now() + 15 * 60_000);
      const [agent] = await db
        .insert(agentsTable)
        .values({
          name: "Owned source reader",
          role: "Fixture",
          systemPrompt: "Fixture",
          modelMode: "manual",
          modelId,
          status: "working",
          runLeaseOwner: leaseOwner,
          runLeaseExpiresAt: leaseExpiresAt,
          permissions: {
            canCreateSubAgents: false,
            canDelegate: false,
            canSpend: false,
            canDelete: false,
            canPublish: false,
            canContactExternal: false,
            canBrowse: false,
            canUseTerminal: true,
            canUseSudo: false,
          },
        })
        .returning();
      const [task] = await db
        .insert(tasksTable)
        .values({
          title: "Read source",
          brief:
            "Read notes.txt and return the owner and date. Do not write files or contact anyone.",
          ownerAgentId: agent!.id,
          executionModelId: modelId,
          status: "in_progress",
          autonomyMode: continuous ? "continuous" : "finite",
          cadenceSeconds: continuous ? 60 : null,
          leaseOwner,
          leaseExpiresAt,
          resultFormat: { kind: "table", columns: ["Owner", "Date"] },
        })
        .returning();
      await db
        .update(agentsTable)
        .set({ currentTaskId: task!.id })
        .where(eq(agentsTable.id, agent!.id));
      const runtimeAttemptId = randomUUID(),
        logicalExecutionId = randomUUID();
      await db.insert(taskAttemptsTable).values({
        id: runtimeAttemptId,
        taskId: task!.id,
        agentId: agent!.id,
        workerInstanceId: runtime.id,
        leaseOwner,
        attemptNumber: 1,
        cycleNumber: 0,
        state: "claimed",
        logicalExecutionId,
      });
      await writeTextFile(agent!.id, "notes.txt", source);
      t.after(() => deleteEntry(agent!.id, "notes.txt"));
      let calls = 0,
        reads = 0;
      let completionContext: ToolRuntimeContext | undefined;
      const createCompletion: typeof createChatCompletion = async (params) => {
        const loading = await loadFixtureTaskTools(params, [
          "vm_read_file",
          "complete_task",
        ]);
        if (loading) return { ...loading, provider: "ollama" };
        await params.beforeRequest?.();
        const reading = calls++ === 0;
        return {
          provider: "ollama",
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
                  tool_calls: [
                    {
                      id: randomUUID(),
                      type: "function",
                      function: {
                        name: reading ? "vm_read_file" : "complete_task",
                        arguments: JSON.stringify(
                          reading
                            ? { path: "notes.txt" }
                            : {
                                resultSummary:
                                  "| Owner | Date |\n| --- | --- |\n| Mira | 2026-10-26 |",
                              },
                        ),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        };
      };
      await stepTask(
        {
          ...task!,
          leaseOwner,
          runtimeAttemptId,
          runtimeInstanceId: runtime.id,
          logicalExecutionId,
        },
        {
          locale: "en",
          runtimeOperationsConfig: config,
          createCompletion,
          runTool: async (ctx, name, args) => {
            if (name === "complete_task") completionContext = ctx;
            if (name === "complete_task" && pendingReview) {
              const forged = await executeTool(
                ctx,
                "request_approval",
                JSON.stringify({
                  category: "other",
                  title: "Forged result review",
                  description: "No authority",
                  toolName: "operator_confirm_task_result",
                  toolArgs: {},
                }),
              );
              assert.equal(forged.toolOutcome, "rejected");
              assert.equal(
                (
                  await db
                    .select()
                    .from(approvalRequestsTable)
                    .where(eq(approvalRequestsTable.taskId, task!.id))
                ).length,
                0,
              );
              assert.equal(peer.completions().length, 0);
            }
            const result = await executeTool(ctx, name, args);
            if (name === "vm_read_file") {
              reads++;
              assert.equal(result.toolOutcome, "succeeded");
              await writeTextFile(agent!.id, "notes.txt", replacement);
            }
            return result;
          },
        },
      );
      const [after] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, task!.id));
      assert.equal(
        after!.status,
        pendingReview
          ? "awaiting_approval"
          : accepted && !continuous
            ? "completed"
            : "in_progress",
      );
      assert.equal(after!.cycleCount, accepted && continuous ? 1 : 0);
      assert.equal(reads, 1);
      assert.equal(calls, 2);
      assert.equal(peer.completions().length, 1);
      assert.equal(
        (await readTextFile(agent!.id, "notes.txt")).content,
        replacement,
      );
      const receipts = await db
        .select()
        .from(operationReceiptsTable)
        .where(eq(operationReceiptsTable.taskId, task!.id));
      const approvals = await db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.taskId, task!.id));
      assert.equal(approvals.length, pendingReview ? 1 : 0);
      if (pendingReview) {
        const approval = approvals[0]!;
        assert.equal(approval.scope?.toolName, "operator_confirm_task_result");
        assert.equal(approval.actionPayload, null);
        assert.equal(
          approval.completionProposal?.judgeReasonCode,
          "missing_required_action",
        );
        assert.equal(after!.resultSummary, null);
        assert.equal(after!.completionAuthority, null);
        const completion = receipts.find(
          (row) => row.toolName === "complete_task",
        )!;
        assert.equal(completion.state, "succeeded");
        assert.equal(completion.resultData?.status, "awaiting_approval");
        assert.equal(after!.leaseOwner, null);
        const [attempt] = await db
          .select()
          .from(taskAttemptsTable)
          .where(eq(taskAttemptsTable.id, runtimeAttemptId));
        assert.equal(attempt!.state, "blocked");
        assert.ok(
          !JSON.stringify(approval).includes("SOURCE-OBSERVATION-CANARY"),
        );
        // Simulate recovery revisiting the same logical call. Its persisted
        // complete_task success is a suspension, never evidence of completion.
        assert.ok(completionContext);
        await db
          .update(tasksTable)
          .set({ status: "in_progress", leaseOwner, leaseExpiresAt })
          .where(eq(tasksTable.id, task!.id));
        await db
          .update(agentsTable)
          .set({
            currentTaskId: task!.id,
            runLeaseOwner: leaseOwner,
            runLeaseExpiresAt: leaseExpiresAt,
          })
          .where(eq(agentsTable.id, agent!.id));
        await db
          .update(taskAttemptsTable)
          .set({ state: "running", finishedAt: null })
          .where(eq(taskAttemptsTable.id, runtimeAttemptId));
        const heartbeat = startTaskLeaseHeartbeat({
          taskId: task!.id,
          agentId: agent!.id,
          attemptId: runtimeAttemptId,
          leaseOwner,
          config,
        });
        let replay;
        try {
          replay = await executeTool(
            {
              ...completionContext,
              assertTaskLease: (action) => heartbeat.assertOwned(action),
              attachOperationInvocation: (input) =>
                heartbeat.attachOperationInvocation(input),
              detachOperationInvocation: (id) =>
                heartbeat.detachOperationInvocation(id),
            },
            "complete_task",
            JSON.stringify({
              resultSummary: approval.completionProposal!.resultSummary,
            }),
          );
        } finally {
          await heartbeat.stop();
        }
        assert.equal(replay.toolOutcome, "succeeded", replay.content);
        assert.equal(replay.taskLifecycleEffect, "suspended");
        assert.equal(replay.receiptId, completion.id);
        assert.equal(peer.completions().length, 1);
        assert.equal(
          (
            await db
              .select()
              .from(approvalRequestsTable)
              .where(eq(approvalRequestsTable.taskId, task!.id))
          ).length,
          1,
        );
        await db
          .update(tasksTable)
          .set({
            status: "awaiting_approval",
            leaseOwner: null,
            leaseExpiresAt: null,
          })
          .where(eq(tasksTable.id, task!.id));
        await db
          .update(agentsTable)
          .set({
            currentTaskId: null,
            runLeaseOwner: null,
            runLeaseExpiresAt: null,
          })
          .where(eq(agentsTable.id, agent!.id));
        await db
          .update(taskAttemptsTable)
          .set({ state: "blocked", finishedAt: new Date() })
          .where(eq(taskAttemptsTable.id, runtimeAttemptId));
      } else if (accepted) assert.equal(after!.completionAuthority, "agent");
      assert.equal(
        receipts.find((row) => row.toolName === "vm_read_file")!.state,
        "succeeded",
      );
      const events = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, task!.id));
      assert.ok(
        !JSON.stringify({ receipts, events, task: after }).includes(
          "SOURCE-OBSERVATION-CANARY",
        ),
      );
      assert.ok(
        !JSON.stringify({ receipts, events, task: after }).includes(
          "LATER-FILE-CANARY",
        ),
      );
      const usage = await db
        .select()
        .from(usageEventsTable)
        .where(eq(usageEventsTable.taskId, task!.id));
      assert.equal(usage.filter((row) => row.kind === "judge").length, 1);
      assert.ok(usage.every((row) => row.usageReported));
    });
  }
}
