import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import test, { after, type TestContext } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import type { createChatCompletion } from "@workspace/ai-server";
import {
  activityEventsTable,
  agentsTable,
  approvalRequestsTable,
  companyChannelMembersTable,
  companyChannelsTable,
  companyMessagesTable,
  db,
  dbReady,
  operationInvocationsTable,
  operationReceiptsTable,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { deleteEntry, readTextFile } from "../vm/sandbox";
import {
  executeApprovedAction,
  executeTool,
  runDurableExternalEffect,
  type ToolRuntimeContext,
} from "./execute-tool";
import { runJudge } from "./judge";
import {
  markRuntimeDraining,
  registerRuntimeInstance,
  type RuntimeInstanceHandle,
} from "./runtime-instance-registry";
import * as schedulerModule from "./scheduler";
import { stepTask } from "./step-task";
import { ModelProviderSetupRequiredError } from "./model-select";
import {
  TaskLeaseOwnershipLostError,
  type TaskLeaseHeartbeatRuntime,
  type TaskLeaseTimer,
} from "./task-lease-heartbeat";
import { scrubExpiredApprovals } from "./sudo-approval-retention";
import { EmergencyStopError, setEmergencyStop } from "./runtime-emergency-stop";
import { WORKSPACE_LOCALES } from "../workspace-locale";
import { getToolCopy, toolMessage } from "./tool-localization";
import { reserveOperation } from "./operation-receipts";

const workerConfig = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
const { claimDueTasks, reviveAndReleaseStaleWork } = schedulerModule;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class ManualLeaseHeartbeatClock implements TaskLeaseHeartbeatRuntime {
  private current: Date;
  private readonly timers = new Set<
    TaskLeaseTimer & {
      dueAt: number;
      callback: () => void | Promise<void>;
      cancelled: boolean;
    }
  >();

  constructor(now: Date) {
    this.current = now;
  }

  now(): Date {
    return new Date(this.current);
  }

  setTimeout(
    callback: () => void | Promise<void>,
    delayMs: number,
  ): TaskLeaseTimer {
    const timer = {
      dueAt: this.current.getTime() + delayMs,
      callback,
      cancelled: false,
      unref: () => undefined,
    };
    this.timers.add(timer);
    return timer;
  }

  clearTimeout(timer: TaskLeaseTimer): void {
    const scheduled = timer as TaskLeaseTimer & { cancelled?: boolean };
    scheduled.cancelled = true;
    this.timers.delete(timer as never);
  }

  async advanceBy(durationMs: number): Promise<void> {
    const target = this.current.getTime() + durationMs;
    for (;;) {
      const next = [...this.timers]
        .filter((timer) => !timer.cancelled && timer.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt)[0];
      if (!next) break;
      this.timers.delete(next);
      this.current = new Date(next.dueAt);
      await next.callback();
    }
    this.current = new Date(target);
  }
}

async function registerWorker(t: TestContext): Promise<RuntimeInstanceHandle> {
  const runtime = await registerRuntimeInstance(
    {
      role: "worker",
      schedulerEnabled: true,
      capabilities: { scheduler: true },
      buildVersion: `task4-fix-${randomUUID()}`,
    },
    workerConfig,
  );
  t.after(() => runtime.stopHeartbeat());
  return runtime;
}

async function createClaimedFixture(
  t: TestContext,
  name: string,
  autonomyMode: "finite" | "continuous" = "finite",
) {
  await dbReady;
  const runtime = await registerWorker(t);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `${name} agent`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: {
        canCreateSubAgents: false,
        canDelegate: false,
        canSpend: false,
        canDelete: true,
        canPublish: false,
        canContactExternal: false,
        canBrowse: true,
        canUseTerminal: true,
        canUseSudo: false,
      },
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: name,
      brief: "Exercise durable attempt correctness.",
      ownerAgentId: agent.id,
      status: "pending",
      autonomyMode,
      cadenceSeconds: autonomyMode === "continuous" ? 60 : undefined,
      createdByUser: true,
    })
    .returning();
  const claimed = (await claimDueTasks(runtime, workerConfig)).find(
    (candidate) => candidate.id === task.id,
  );
  assert.ok(claimed, `task ${task.id} should be claimed`);
  t.after(async () => {
    await db
      .update(tasksTable)
      .set({
        status: "cancelled",
        blockedReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(eq(agentsTable.id, agent.id));
  });
  return { runtime, agent, task, claimed };
}

test("a project without a model remains queued and records a recoverable setup attempt", async (t) => {
  const fixture = await createClaimedFixture(t, "Provider setup wait");
  await stepTask(fixture.claimed, {
    runtimeOperationsConfig: workerConfig,
    selectModelPlan: () => {
      throw new ModelProviderSetupRequiredError();
    },
  });
  const [[task], [attempt]] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId)),
  ]);
  assert.equal(task.status, "in_progress");
  assert.equal(task.blockedReason, null);
  assert.equal(task.leaseOwner, null);
  assert.ok(task.nextAttemptAt);
  assert.equal(attempt.state, "retrying");
  assert.equal(attempt.failureKind, "provider_setup_required");
});

function toolCompletion(
  model: string,
  toolName: string,
  args: Record<string, unknown>,
): Awaited<ReturnType<typeof createChatCompletion>> {
  return {
    provider: "replit",
    completion: {
      id: randomUUID(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1_000),
      model,
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
                function: { name: toolName, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
    },
  };
}

function toolBatchCompletion(
  model: string,
  calls: ReadonlyArray<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>,
): Awaited<ReturnType<typeof createChatCompletion>> {
  const completion = toolCompletion(model, calls[0]!.name, calls[0]!.args);
  completion.completion.choices[0]!.message.tool_calls = calls.map((call) => ({
    id: call.id,
    type: "function" as const,
    function: {
      name: call.name,
      arguments: JSON.stringify(call.args),
    },
  }));
  return completion;
}

let judgeServer: http.Server | null = null;
let previousJudgeKey: string | undefined;
let previousJudgeUrl: string | undefined;

after(async () => {
  if (judgeServer) {
    judgeServer.closeAllConnections();
    await new Promise<void>((resolve) => judgeServer!.close(() => resolve()));
    judgeServer = null;
  }
  if (previousJudgeKey === undefined)
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = previousJudgeKey;
  if (previousJudgeUrl === undefined)
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = previousJudgeUrl;
});

async function startJudgeServer(_t: TestContext): Promise<void> {
  if (judgeServer) return;
  previousJudgeKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  previousJudgeUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      model?: string;
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: randomUUID(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1_000),
        model: payload.model ?? "test-judge",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({ verdict: "pass", reasoning: "ok" }),
            },
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "task4-fix-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  judgeServer = server;
}

test("durable lifecycle tools leave no partial terminal state when the step crashes before finalization", async (t) => {
  await startJudgeServer(t);
  const cases = [
    {
      name: "complete",
      toolName: "complete_task",
      args: { resultSummary: "Verified result" },
    },
    {
      name: "approval",
      toolName: "request_approval",
      args: {
        category: "other",
        title: "Operator decision",
        description: "Approve the next bounded step.",
      },
    },
    {
      name: "input",
      toolName: "request_user_input",
      args: { question: "Which option should be used?" },
    },
  ] as const;

  for (const lifecycle of cases) {
    await t.test(lifecycle.name, async (subtest) => {
      const fixture = await createClaimedFixture(
        subtest,
        `Atomic lifecycle ${lifecycle.name}`,
      );
      const crash = new Error(`synthetic crash after ${lifecycle.toolName}`);
      await stepTask(fixture.claimed, {
        createCompletion: async (params) => {
          await params.beforeRequest?.();
          return toolCompletion(
            params.model,
            lifecycle.toolName,
            lifecycle.args,
          );
        },
        runTool: async (ctx, name, rawArgs) => {
          await executeTool(ctx, name, rawArgs);
          throw crash;
        },
        runtimeOperationsConfig: workerConfig,
      });

      const [[task], [attempt], approvals, events] = await Promise.all([
        db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
        db
          .select()
          .from(taskAttemptsTable)
          .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId)),
        db
          .select()
          .from(approvalRequestsTable)
          .where(eq(approvalRequestsTable.taskId, fixture.task.id)),
        db
          .select()
          .from(activityEventsTable)
          .where(eq(activityEventsTable.taskId, fixture.task.id)),
      ]);
      assert.equal(task.status, "in_progress");
      assert.equal(attempt.state, "retrying");
      assert.equal(approvals.length, 0);
      assert.equal(
        events.some(
          (event) =>
            event.type === "approval_requested" ||
            (event.type === "note" && event.detail?.question) ||
            (event.type === "task_status_changed" &&
              /tamamlandi|completed/iu.test(event.summary)),
        ),
        false,
      );
    });
  }
});

test("all durable lifecycle finalizers roll back on replaced-owner and emergency barriers", async (t) => {
  await startJudgeServer(t);
  const lifecycleCases = [
    {
      name: "complete",
      toolName: "complete_task",
      args: { resultSummary: "Verified result" },
    },
    {
      name: "approval",
      toolName: "request_approval",
      args: {
        category: "other",
        title: "Operator decision",
        description: "Approve the next bounded step.",
      },
    },
    {
      name: "input",
      toolName: "request_user_input",
      args: { question: "Which option should be used?" },
    },
  ] as const;
  type StepTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
  const stepWithBarrier = stepTask as typeof stepTask &
    ((
      task: Parameters<typeof stepTask>[0],
      dependencies: Parameters<typeof stepTask>[1] & {
        beforeLifecycleFinalizeRelease(
          tx: StepTransaction,
          intent: { kind: string },
        ): Promise<void>;
      },
    ) => Promise<void>);

  for (const lifecycle of lifecycleCases) {
    for (const conflict of ["replaced_owner", "emergency"] as const) {
      await t.test(`${lifecycle.name} · ${conflict}`, async (subtest) => {
        const fixture = await createClaimedFixture(
          subtest,
          `Atomic ${lifecycle.name} ${conflict}`,
        );
        const [replacementAgent] = await db
          .insert(agentsTable)
          .values({
            name: `Replacement ${lifecycle.name} ${conflict}`,
            role: "Test",
            systemPrompt: "Test only",
            createdByUser: true,
          })
          .returning();
        subtest.after(async () => {
          await db
            .update(agentsTable)
            .set({ isActive: false, status: "archived" })
            .where(eq(agentsTable.id, replacementAgent.id));
        });
        await stepWithBarrier(fixture.claimed, {
          createCompletion: async (params) => {
            await params.beforeRequest?.();
            return toolCompletion(
              params.model,
              lifecycle.toolName,
              lifecycle.args,
            );
          },
          runtimeOperationsConfig: workerConfig,
          beforeLifecycleFinalizeRelease: async (tx) => {
            if (conflict === "replaced_owner") {
              await tx
                .update(tasksTable)
                .set({ ownerAgentId: replacementAgent.id })
                .where(eq(tasksTable.id, fixture.task.id));
              return;
            }
            throw new EmergencyStopError({
              id: 1,
              emergencyStopEnabled: true,
              emergencyStopReason: "synthetic finalization barrier",
              version: 1,
              updatedBy: "task4-test",
              updatedAt: new Date(),
            });
          },
        });

        const [[task], [agent], [attempt], approvals, events] =
          await Promise.all([
            db
              .select()
              .from(tasksTable)
              .where(eq(tasksTable.id, fixture.task.id)),
            db
              .select()
              .from(agentsTable)
              .where(eq(agentsTable.id, fixture.agent.id)),
            db
              .select()
              .from(taskAttemptsTable)
              .where(
                eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId),
              ),
            db
              .select()
              .from(approvalRequestsTable)
              .where(eq(approvalRequestsTable.taskId, fixture.task.id)),
            db
              .select()
              .from(activityEventsTable)
              .where(eq(activityEventsTable.taskId, fixture.task.id)),
          ]);
        assert.equal(task.status, "in_progress");
        assert.equal(task.ownerAgentId, fixture.agent.id);
        assert.equal(task.leaseOwner, fixture.claimed.leaseOwner);
        assert.equal(agent.runLeaseOwner, fixture.claimed.leaseOwner);
        assert.equal(attempt.state, "running");
        assert.equal(approvals.length, 0);
        assert.equal(
          events.some((event) =>
            ["approval_requested", "task_status_changed", "note"].includes(
              event.type,
            ),
          ),
          false,
        );
      });
    }
  }
});

test("a reassigned task rejects the stale owner's intermediate step write", async (t) => {
  await startJudgeServer(t);
  const fixture = await createClaimedFixture(t, "Intermediate owner fence");
  const [replacementAgent] = await db
    .insert(agentsTable)
    .values({
      name: "Intermediate replacement owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  t.after(async () => {
    await db
      .update(agentsTable)
      .set({ isActive: false, status: "archived" })
      .where(eq(agentsTable.id, replacementAgent.id));
  });
  let barrierCalls = 0;
  const stepWithBarrier = stepTask as typeof stepTask &
    ((
      task: Parameters<typeof stepTask>[0],
      dependencies: Parameters<typeof stepTask>[1] & {
        beforeOwnedStepWriteTransaction(): Promise<void>;
      },
    ) => Promise<void>);
  await stepWithBarrier(fixture.claimed, {
    createCompletion: async (params) => {
      await params.beforeRequest?.();
      return toolCompletion(params.model, "complete_task", {
        resultSummary: "stale owner must not persist this result",
      });
    },
    runtimeOperationsConfig: workerConfig,
    beforeOwnedStepWriteTransaction: async () => {
      barrierCalls += 1;
      if (barrierCalls !== 1) return;
      await db
        .update(tasksTable)
        .set({ ownerAgentId: replacementAgent.id })
        .where(eq(tasksTable.id, fixture.task.id));
    },
  });

  const [[task], [attempt], events] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId)),
    db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, fixture.task.id)),
  ]);
  assert.equal(barrierCalls, 1);
  assert.equal(task.ownerAgentId, replacementAgent.id);
  assert.equal(task.lastModelId, null);
  assert.equal(attempt.state, "lost");
  assert.equal(
    events.some(
      (event) =>
        event.type === "task_status_changed" &&
        /stale owner must not persist/iu.test(event.summary),
    ),
    false,
  );
});

test("invalid or oversized questions cannot create an unanswerable wait", async (t) => {
  const fixture = await createClaimedFixture(t, "Question validation");
  for (const question of ["x".repeat(1001), "\u200b", {}, " "]) {
    const result = await executeTool(
      {
        agent: fixture.agent,
        taskId: fixture.task.id,
        taskLeaseOwner: fixture.claimed.leaseOwner,
        runtimeAttemptId: fixture.claimed.runtimeAttemptId,
        assertTaskLease: async () => {},
      },
      "request_user_input",
      JSON.stringify({ question }),
    );
    assert.match(result.content, /^Hata:/);
    assert.equal(result.durableTaskLifecycleIntent, undefined);
  }
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, fixture.task.id));
  assert.equal(task.userInputQuestionId, null);
  assert.notEqual(task.status, "blocked");
});

test("a durable lifecycle mutation and its operation receipt succeed in one finalization", async (t) => {
  await startJudgeServer(t);
  const fixture = await createClaimedFixture(
    t,
    "Atomic lifecycle operation receipt",
  );
  const question = `Choose bounded option ${randomUUID()}`;
  await stepTask(fixture.claimed, {
    locale: "tr",
    createCompletion: async (params) => {
      await params.beforeRequest?.();
      return toolCompletion(params.model, "request_user_input", { question });
    },
    runtimeOperationsConfig: workerConfig,
  });

  const [[task], [attempt], [receipt], events] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId)),
    db
      .select()
      .from(operationReceiptsTable)
      .where(
        and(
          eq(operationReceiptsTable.taskId, fixture.task.id),
          eq(operationReceiptsTable.toolName, "request_user_input"),
        ),
      ),
    db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, fixture.task.id)),
  ]);
  assert.equal(task.status, "blocked");
  assert.equal(task.blockedReason, "user_input");
  assert.match(task.userInputQuestionId ?? "", /^[a-f\d-]{36}$/);
  assert.equal(task.userInputQuestion, question);
  assert.equal(task.userInputOwnerAgentId, fixture.task.ownerAgentId);
  assert.ok(
    events.some(
      (event) => event.detail?.questionId === task.userInputQuestionId,
    ),
  );
  assert.equal(attempt.state, "blocked");
  assert.equal(receipt.state, "succeeded");
  assert.deepEqual(receipt.resultData, {
    taskId: fixture.task.id,
    status: "blocked",
    executionLocale: "tr",
  });
  assert.equal(JSON.stringify(receipt).includes(question), false);
  assert.equal(
    events.filter(
      (event) => event.type === "note" && event.detail?.question === question,
    ).length,
    1,
  );
  const invocations = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.receiptId, receipt.id));
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0]!.state, "succeeded");
});

test("all lifecycle finalizers preserve the reserved language and exact source across a preference change", async (t) => {
  await startJudgeServer(t);
  const source = "  Original {summary} $&\n\n  العربية 原文\t  ";
  for (const locale of WORKSPACE_LOCALES) {
    for (const kind of [
      "complete",
      "continuous",
      "approval",
      "question",
    ] as const) {
      await t.test(`${locale} ${kind}`, async (subtest) => {
        const fixture = await createClaimedFixture(
          subtest,
          `Locale ${locale} ${kind}`,
          kind === "continuous" ? "continuous" : "finite",
        );
        const toolName =
          kind === "approval"
            ? "request_approval"
            : kind === "question"
              ? "request_user_input"
              : "complete_task";
        const args =
          kind === "approval"
            ? { category: "other", title: source, description: source }
            : kind === "question"
              ? { question: source }
              : { resultSummary: source };
        const identityArgs =
          kind === "approval"
            ? {
                category: "other",
                title: source.trim(),
                description: source.trim(),
                amountUsd: null,
                toolName: null,
                actionArgsHash: null,
                target: null,
              }
            : kind === "question"
              ? { question: source.trim() }
              : { resultSummary: source.trim() };
        let prepared: Awaited<ReturnType<typeof executeTool>> | undefined;
        let originalHash: string | undefined;
        let currentAction: string | null = null;
        await stepTask(fixture.claimed, {
          locale: locale === "en" ? "ar" : "en",
          createCompletion: async (params) => {
            await params.beforeRequest?.();
            return toolCompletion(params.model, toolName, args);
          },
          runTool: async (ctx, name, rawArgs) => {
            const [live] = await db
              .select()
              .from(agentsTable)
              .where(eq(agentsTable.id, ctx.agent.id));
            currentAction = live.currentAction;
            const identity = ctx.operationIdentity!;
            const reservation = await reserveOperation({
              canonicalVersion: 1,
              executionKind: identity.executionKind,
              logicalExecutionId: identity.logicalExecutionId,
              toolName: name,
              args: identityArgs,
              executionLocale: locale,
              physical: {
                attemptId: identity.originAttemptId,
                workerInstanceId: identity.runtimeInstanceId,
                modelToolCallId: identity.modelToolCallId,
                callSlot: identity.callSlot,
              },
              taskId: ctx.taskId,
              agentId: ctx.agent.id,
              approvalId: null,
              sourceMessageId: null,
              originAttemptId: identity.originAttemptId,
              sideEffectClass: "transactional",
            });
            originalHash = reservation.receipt.argumentHash;
            prepared = await executeTool(ctx, name, rawArgs);
            return prepared;
          },
          runtimeOperationsConfig: workerConfig,
        });
        assert.equal(prepared?.toolOutcome, "succeeded");
        assert.ok(prepared.durableTaskLifecycleIntent);
        const [[task], [receipt], events, approvals] = await Promise.all([
          db
            .select()
            .from(tasksTable)
            .where(eq(tasksTable.id, fixture.task.id)),
          db
            .select()
            .from(operationReceiptsTable)
            .where(
              and(
                eq(operationReceiptsTable.taskId, fixture.task.id),
                eq(operationReceiptsTable.toolName, toolName),
              ),
            ),
          db
            .select()
            .from(activityEventsTable)
            .where(eq(activityEventsTable.taskId, fixture.task.id)),
          db
            .select()
            .from(approvalRequestsTable)
            .where(eq(approvalRequestsTable.taskId, fixture.task.id)),
        ]);
        assert.equal(receipt.state, "succeeded");
        assert.equal(receipt.resultData?.executionLocale, locale);
        assert.equal(receipt.argumentHash, originalHash);
        assert.ok(!JSON.stringify(receipt).includes(source));
        let expectedActivity: string;
        if (kind === "question") {
          assert.equal(
            prepared.content,
            getToolCopy(locale).teamQuestionPrepared,
          );
          assert.equal(task.status, "blocked");
          assert.equal(task.blockedReason, "user_input");
          assert.equal(task.userInputQuestion, source);
          assert.equal(task.lastError, getToolCopy(locale).teamInputWaiting);
          expectedActivity = toolMessage(locale, "teamQuestionActivity", {
            question: source,
          });
        } else if (kind === "approval") {
          assert.equal(
            prepared.content,
            getToolCopy(locale).teamApprovalPrepared,
          );
          assert.equal(task.status, "awaiting_approval");
          assert.equal(approvals.length, 1);
          assert.equal(approvals[0].title, source);
          assert.equal(approvals[0].description, source);
          expectedActivity = toolMessage(locale, "teamApprovalActivity", {
            title: source,
          });
        } else {
          assert.equal(task.resultSummary, source);
          assert.equal(
            task.status,
            kind === "continuous" ? "in_progress" : "completed",
          );
          if (kind === "complete")
            assert.equal(
              prepared.content,
              getToolCopy(locale).teamCompletionPrepared,
            );
          else {
            assert.ok(task.nextAttemptAt);
            assert.equal(
              prepared.content,
              toolMessage(locale, "teamCyclePrepared", {
                at: task.nextAttemptAt.toISOString(),
              }),
            );
          }
          expectedActivity = toolMessage(
            locale,
            kind === "continuous"
              ? "teamCycleActivity"
              : "teamCompletionActivity",
            { summary: source },
          );
        }
        assert.equal(
          events.filter((event) => event.summary === expectedActivity).length,
          1,
          JSON.stringify(events.map((event) => event.summary)),
        );
        assert.equal(task.leaseOwner, null);
        const actions =
          locale === "en"
            ? {
                complete: "جارٍ مراجعة نتيجة المهمة",
                continuous: "جارٍ مراجعة نتيجة المهمة",
                approval: "جارٍ طلب موافقة المشغّل",
                question: "جارٍ طلب معلومات من المستخدم",
              }
            : {
                complete: "Reviewing task result",
                continuous: "Reviewing task result",
                approval: "Requesting operator approval",
                question: "Requesting user input",
              };
        assert.equal(currentAction, actions[kind]);
      });
    }
  }
});

test("a deferred durable operation stops its tool batch and schedules the attempt for retry", async (t) => {
  await startJudgeServer(t);
  const fixture = await createClaimedFixture(t, "Deferred durable operation");
  const dispatched: string[] = [];
  await stepTask(fixture.claimed, {
    createCompletion: async (params) => {
      await params.beforeRequest?.();
      return toolBatchCompletion(params.model, [
        {
          id: "deferred-operation",
          name: "request_user_input",
          args: { question: "another worker owns this lifecycle operation" },
        },
        {
          id: "must-not-run-after-deferred",
          name: "post_company_message",
          args: { content: "must not be posted" },
        },
      ]);
    },
    runTool: async (_ctx, name) => {
      dispatched.push(name);
      return {
        content: "The same operation is already running on another worker.",
        createdTasks: [],
        createdAgents: [],
        toolOutcome: "deferred",
        receiptId: "receipt-deferred-operation",
      };
    },
    runtimeOperationsConfig: workerConfig,
  });

  const [[task], [attempt]] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId)),
  ]);
  assert.deepEqual(dispatched, ["request_user_input"]);
  assert.equal(task.status, "in_progress");
  assert.equal(task.leaseOwner, null);
  assert.ok(task.nextAttemptAt);
  assert.equal(task.consecutiveFailures, 0);
  assert.equal(attempt.state, "retrying");
  assert.equal(attempt.failureKind, "operation_deferred");
  assert.match(attempt.sanitizedError ?? "", /receipt-deferred-operation/u);
});

test("continuous completion persists cadence, releases both leases, and succeeds one attempt atomically", async (t) => {
  await startJudgeServer(t);
  const fixture = await createClaimedFixture(
    t,
    "Atomic continuous lifecycle",
    "continuous",
  );
  const before = Date.now();
  await stepTask(fixture.claimed, {
    locale: "tr",
    createCompletion: async (params) => {
      await params.beforeRequest?.();
      return toolCompletion(params.model, "complete_task", {
        resultSummary: "Cycle evidence is complete.",
      });
    },
    runtimeOperationsConfig: workerConfig,
  });

  const [[task], [agent], [attempt], [receipt]] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
    db.select().from(agentsTable).where(eq(agentsTable.id, fixture.agent.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId)),
    db
      .select()
      .from(operationReceiptsTable)
      .where(
        and(
          eq(operationReceiptsTable.taskId, fixture.task.id),
          eq(operationReceiptsTable.toolName, "complete_task"),
        ),
      ),
  ]);
  assert.equal(task.status, "in_progress");
  assert.equal(task.cycleCount, 1);
  assert.ok(
    task.nextAttemptAt && task.nextAttemptAt.getTime() >= before + 59_000,
  );
  assert.equal(task.leaseOwner, null);
  assert.equal(agent.runLeaseOwner, null);
  assert.equal(attempt.state, "succeeded");
  assert.equal(receipt.state, "succeeded");
  assert.deepEqual(receipt.resultData, {
    taskId: fixture.task.id,
    status: "in_progress",
    executionLocale: "tr",
  });
});

test("judge ownership failure immediately after provider completion propagates unchanged and writes no review", async (t) => {
  await dbReady;
  await startJudgeServer(t);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Judge boundary agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const ownershipLoss = new TaskLeaseOwnershipLostError("revoked after judge");
  let assertions = 0;

  await assert.rejects(
    runJudge({
      agent,
      taskId: null,
      purpose: "completion",
      originalBrief: "Check the exact durable owner.",
      actionSummary: "Done.",
      beforeAttempt: async () => {
        assertions += 1;
        if (assertions === 2) throw ownershipLoss;
      },
    }),
    (error) => error === ownershipLoss,
  );
  assert.equal(assertions, 2);
  const reviews = await db
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.agentId, agent.id),
        eq(activityEventsTable.type, "judge_review"),
      ),
    );
  assert.equal(reviews.length, 0);
});

test("inner task fences prevent mutations and a generic approval cannot be consumed by a task tool call", async (t) => {
  const fixture = await createClaimedFixture(t, "Inner effect fence");
  await db
    .update(taskAttemptsTable)
    .set({ state: "running" })
    .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId));
  const [channel] = await db
    .insert(companyChannelsTable)
    .values({ key: `task4-${randomUUID()}`, name: "Task 4 test" })
    .returning();
  await db.insert(companyChannelMembersTable).values({
    channelId: channel.id,
    agentId: fixture.agent.id,
  });
  const deleteArgs = { command: "rm -f never-created.txt" };
  const argsHash = createHash("sha256")
    .update(JSON.stringify(deleteArgs))
    .digest("hex");
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: fixture.task.id,
      agentId: fixture.agent.id,
      category: "delete",
      title: "Delete test",
      description: "Must remain unconsumed after ownership loss.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      scope: { toolName: "vm_run_command", argsHash, target: null },
    })
    .returning();
  const ownershipLoss = new TaskLeaseOwnershipLostError("inner fence revoked");

  for (const [name, args] of [
    ["log_note", { summary: "must not persist" }],
    ["post_company_message", { content: "must not post" }],
  ] as const) {
    let assertions = 0;
    const context = {
      agent: fixture.agent,
      taskId: fixture.task.id,
      taskLeaseOwner: fixture.claimed.leaseOwner,
      runtimeAttemptId: fixture.claimed.runtimeAttemptId,
      assertTaskLease: async () => {
        assertions += 1;
        if (assertions >= 2) throw ownershipLoss;
      },
    } as ToolRuntimeContext & { runtimeAttemptId: string };
    await assert.rejects(
      executeTool(context, name, JSON.stringify(args)),
      (error) => error === ownershipLoss,
      `${name} must propagate the inner ownership fence`,
    );
    assert.equal(
      assertions,
      2,
      `${name} must reassert after the outer live-owner check`,
    );
  }

  for (const [name, args] of [
    ["vm_write_file", { path: "task4-fence.txt", content: "forbidden" }],
    ["browser_open", { url: "https://example.com/task4-forbidden" }],
  ] as const) {
    let assertions = 0;
    const result = await executeTool(
      {
        agent: fixture.agent,
        taskId: fixture.task.id,
        taskLeaseOwner: fixture.claimed.leaseOwner,
        runtimeAttemptId: fixture.claimed.runtimeAttemptId,
        assertTaskLease: async () => {
          assertions += 1;
          if (assertions >= 2) throw ownershipLoss;
        },
      },
      name,
      JSON.stringify(args),
    );
    assert.equal(result.toolOutcome, "rejected");
    assert.equal(
      assertions,
      2,
      `${name} must reassert before its physical effect`,
    );
  }

  let approvalAssertions = 0;
  const approvalResult = await executeTool(
    {
      agent: fixture.agent,
      taskId: fixture.task.id,
      taskLeaseOwner: fixture.claimed.leaseOwner,
      runtimeAttemptId: fixture.claimed.runtimeAttemptId,
      assertTaskLease: async () => {
        approvalAssertions += 1;
      },
    },
    "vm_run_command",
    JSON.stringify(deleteArgs),
  );
  assert.equal(approvalResult.toolOutcome, "rejected");
  assert.match(approvalResult.content, /onay/iu);
  assert.equal(
    approvalAssertions,
    1,
    "ordinary task calls must stop before an approved-action effect fence",
  );

  const [events, messages, [persistedApproval]] = await Promise.all([
    db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, fixture.task.id)),
    db
      .select()
      .from(companyMessagesTable)
      .where(eq(companyMessagesTable.taskId, fixture.task.id)),
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approval.id)),
  ]);
  assert.equal(
    events.filter((event) => event.type !== "operations_changed").length,
    0,
    "ownership-fenced tools must not persist user-visible mutation events",
  );
  assert.equal(messages.length, 0);
  assert.equal(persistedApproval.consumedAt, null);
  await assert.rejects(readTextFile(fixture.agent.id, "task4-fence.txt"));
});

test("inactive-owner startup rolls back the agent release when the task CAS loses", async (t) => {
  const fixture = await createClaimedFixture(t, "Inactive owner rollback");
  const replacementOwner = `replacement:${randomUUID()}`;
  await db
    .update(agentsTable)
    .set({ isActive: false })
    .where(eq(agentsTable.id, fixture.agent.id));
  await db
    .update(tasksTable)
    .set({ leaseOwner: replacementOwner })
    .where(eq(tasksTable.id, fixture.task.id));

  await stepTask(fixture.claimed, { runtimeOperationsConfig: workerConfig });

  const [[agent], [task], [attempt]] = await Promise.all([
    db.select().from(agentsTable).where(eq(agentsTable.id, fixture.agent.id)),
    db.select().from(tasksTable).where(eq(tasksTable.id, fixture.task.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId)),
  ]);
  assert.equal(agent.runLeaseOwner, fixture.claimed.leaseOwner);
  assert.equal(task.leaseOwner, replacementOwner);
  assert.equal(attempt.state, "claimed");
});

test("expired-task recovery aborts when the owner changes after candidate selection", async (t) => {
  await dbReady;
  // Earlier crash-path fixtures deliberately leave orphan attempts behind.
  // Drain those rows before installing the transaction barrier so the first
  // intercepted transaction belongs to this exact expired-task candidate.
  await reviveAndReleaseStaleWork();
  const leaseOwner = `reassigned-recovery:${randomUUID()}`;
  const futureLease = new Date(Date.now() + workerConfig.taskLeaseMs);
  const [selectedAgent] = await db
    .insert(agentsTable)
    .values({
      name: "Selected recovery owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: futureLease,
    })
    .returning();
  const [replacementAgent] = await db
    .insert(agentsTable)
    .values({
      name: "Replacement recovery owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: futureLease,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Recovery reassignment fence",
      brief: "Recovery may mutate only the agent locked before the task.",
      ownerAgentId: selectedAgent.id,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt: new Date(Date.now() - 1_000),
      createdByUser: true,
    })
    .returning();
  t.after(async () => {
    await db
      .update(tasksTable)
      .set({
        status: "cancelled",
        blockedReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(tasksTable.id, task.id));
    for (const agentId of [selectedAgent.id, replacementAgent.id]) {
      await db
        .update(agentsTable)
        .set({
          isActive: false,
          status: "archived",
          runLeaseOwner: null,
          runLeaseExpiresAt: null,
        })
        .where(eq(agentsTable.id, agentId));
    }
  });

  const candidatesSelected = deferred<void>();
  const releaseRecovery = deferred<void>();
  const recovering = reviveAndReleaseStaleWork(15_000, {
    afterExpiredTaskCandidatesSelected: async () => {
      candidatesSelected.resolve();
      await releaseRecovery.promise;
    },
  });
  await candidatesSelected.promise;
  await db
    .update(tasksTable)
    .set({ ownerAgentId: replacementAgent.id })
    .where(eq(tasksTable.id, task.id));
  releaseRecovery.resolve();
  await recovering;

  const [[persistedTask], [persistedReplacement]] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, replacementAgent.id)),
  ]);
  assert.equal(persistedTask.ownerAgentId, replacementAgent.id);
  assert.equal(persistedTask.leaseOwner, leaseOwner);
  assert.equal(persistedReplacement.runLeaseOwner, leaseOwner);
  assert.equal(persistedReplacement.status, "working");
});

test("task claim rolls back when the owner changes after candidate selection", async (t) => {
  await dbReady;
  const runtime = await registerWorker(t);
  const [selectedAgent] = await db
    .insert(agentsTable)
    .values({
      name: "Selected claim owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [replacementAgent] = await db
    .insert(agentsTable)
    .values({
      name: "Replacement claim owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Claim reassignment fence",
      brief: "A claim may lease only the selected task owner.",
      ownerAgentId: selectedAgent.id,
      status: "pending",
      updatedAt: new Date(0),
      createdByUser: true,
    })
    .returning();
  t.after(async () => {
    await db
      .update(tasksTable)
      .set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null })
      .where(eq(tasksTable.id, task.id));
    for (const agentId of [selectedAgent.id, replacementAgent.id]) {
      await db
        .update(agentsTable)
        .set({
          isActive: false,
          status: "archived",
          runLeaseOwner: null,
          runLeaseExpiresAt: null,
        })
        .where(eq(agentsTable.id, agentId));
    }
  });

  const transactionSelected = deferred<void>();
  const releaseTransaction = deferred<void>();
  const mutableDb = db as typeof db & { transaction: typeof db.transaction };
  const originalTransaction = mutableDb.transaction;
  let intercept = true;
  mutableDb.transaction = ((...args: unknown[]) => {
    if (!intercept) {
      return (originalTransaction as (...values: unknown[]) => unknown).apply(
        db,
        args,
      );
    }
    intercept = false;
    transactionSelected.resolve();
    return releaseTransaction.promise.then(() =>
      (originalTransaction as (...values: unknown[]) => unknown).apply(
        db,
        args,
      ),
    );
  }) as typeof db.transaction;

  let claimed: Awaited<ReturnType<typeof claimDueTasks>>;
  try {
    const claiming = claimDueTasks(runtime, workerConfig);
    await transactionSelected.promise;
    await db
      .update(tasksTable)
      .set({ ownerAgentId: replacementAgent.id })
      .where(eq(tasksTable.id, task.id));
    releaseTransaction.resolve();
    claimed = await claiming;
  } finally {
    mutableDb.transaction = originalTransaction;
    releaseTransaction.resolve();
  }

  const [[persistedTask], [persistedSelected], attempts] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db.select().from(agentsTable).where(eq(agentsTable.id, selectedAgent.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.taskId, task.id)),
  ]);
  assert.equal(
    claimed.filter((candidate) => candidate.id === task.id).length,
    0,
  );
  assert.equal(persistedTask.ownerAgentId, replacementAgent.id);
  assert.equal(persistedTask.leaseOwner, null);
  assert.equal(persistedSelected.runLeaseOwner, null);
  assert.equal(persistedSelected.currentTaskId, null);
  assert.equal(attempts.length, 0);
});

test("forged and locally stopped runtime handles cannot claim any row", async (t) => {
  await dbReady;
  const runtime = await registerWorker(t);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Forged claim agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Forged runtime claim",
      brief: "Only the private registry handle may claim.",
      ownerAgentId: agent.id,
      status: "pending",
      createdByUser: true,
    })
    .returning();
  t.after(async () => {
    await db
      .update(tasksTable)
      .set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(eq(agentsTable.id, agent.id));
  });
  const forged = {
    id: runtime.id,
    startedAt: new Date(runtime.startedAt),
    stopHeartbeat: async () => undefined,
  } as RuntimeInstanceHandle;

  await assert.rejects(claimDueTasks(forged, workerConfig), /runtime handle/iu);
  await runtime.stopHeartbeat();
  await assert.rejects(
    claimDueTasks(runtime, workerConfig),
    /runtime handle/iu,
  );

  const [[persistedTask], [persistedAgent], attempts] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db.select().from(agentsTable).where(eq(agentsTable.id, agent.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.taskId, task.id)),
  ]);
  assert.equal(persistedTask.leaseOwner, null);
  assert.equal(persistedAgent.runLeaseOwner, null);
  assert.equal(attempts.length, 0);
});

test("selection before drain cannot pass the per-candidate runtime admission fence", async (t) => {
  const fixtureRuntime = await registerWorker(t);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Drain barrier agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Drain barrier task",
      brief: "A selected task must be revalidated after drain.",
      ownerAgentId: agent.id,
      status: "pending",
      createdByUser: true,
    })
    .returning();
  t.after(async () => {
    await db
      .update(tasksTable)
      .set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(eq(agentsTable.id, agent.id));
  });
  const selected = deferred<void>();
  const releaseTransaction = deferred<void>();
  const mutableDb = db as typeof db & { transaction: typeof db.transaction };
  const originalTransaction = mutableDb.transaction;
  let intercept = true;
  mutableDb.transaction = ((...args: unknown[]) => {
    if (!intercept) {
      return (originalTransaction as (...values: unknown[]) => unknown).apply(
        db,
        args,
      );
    }
    intercept = false;
    selected.resolve();
    return releaseTransaction.promise.then(() =>
      (originalTransaction as (...values: unknown[]) => unknown).apply(
        db,
        args,
      ),
    );
  }) as typeof db.transaction;
  try {
    const claiming = claimDueTasks(fixtureRuntime, workerConfig);
    await selected.promise;
    assert.equal(await markRuntimeDraining(fixtureRuntime), true);
    releaseTransaction.resolve();
    assert.deepEqual(await claiming, []);
  } finally {
    mutableDb.transaction = originalTransaction;
    releaseTransaction.resolve();
  }
  const [[persisted], attempts] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.taskId, task.id)),
  ]);
  assert.equal(persisted.leaseOwner, null);
  assert.equal(attempts.length, 0);
});

test("slot filling starts and heartbeats each claim before the next claim transaction", async (t) => {
  await dbReady;
  await startJudgeServer(t);
  const runtime = await registerWorker(t);
  const taskIds: number[] = [];
  const agentIds: number[] = [];
  for (let index = 0; index < 2; index += 1) {
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: `Interleaved claim agent ${index}`,
        role: "Test",
        systemPrompt: "Test only",
        createdByUser: true,
      })
      .returning();
    agentIds.push(agent.id);
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: `Interleaved claim task ${index}`,
        brief: "Start and heartbeat the first task before claiming the next.",
        ownerAgentId: agent.id,
        status: "pending",
        createdByUser: true,
      })
      .returning();
    taskIds.push(task.id);
  }
  t.after(async () => {
    await db
      .update(tasksTable)
      .set({
        status: "cancelled",
        blockedReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(inArray(tasksTable.id, taskIds));
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(inArray(agentsTable.id, agentIds));
  });

  type ManualTimer = {
    callback: () => void | Promise<void>;
    cleared: boolean;
    unref(): void;
  };
  const timers: ManualTimer[] = [];
  const manualHeartbeatRuntime = {
    now: () => new Date(),
    setTimeout(callback: () => void | Promise<void>) {
      const timer: ManualTimer = {
        callback,
        cleared: false,
        unref() {},
      };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer: ManualTimer) {
      timer.cleared = true;
    },
  };
  const secondClaimBlocked = deferred<void>();
  const releaseSecondClaim = deferred<void>();
  const secondClaimLocksHeld = deferred<void>();
  const releaseSecondClaimTimestamp = deferred<void>();
  const firstProviderStarted = deferred<void>();
  const bothProvidersStarted = deferred<void>();
  const releaseProviders = deferred<void>();
  let providerCalls = 0;

  type Claimed = Awaited<ReturnType<typeof claimDueTasks>>[number];
  type SlotFillDependencies = {
    beforeClaimTransaction?: (
      slot: number,
      candidate: { id: number },
    ) => Promise<void>;
    afterClaimLocksBeforeTimestamp?: (
      slot: number,
      candidate: { id: number },
    ) => Promise<void>;
    runClaimedTask?: (
      task: Claimed,
      lifecycle: { afterInitialLeaseHeartbeat(): void },
    ) => Promise<void>;
  };
  const claimAndStepDueTasks = (
    schedulerModule as typeof schedulerModule & {
      claimAndStepDueTasks?: (
        runtime: RuntimeInstanceHandle,
        config: typeof workerConfig,
        dependencies?: SlotFillDependencies,
      ) => Promise<void>;
    }
  ).claimAndStepDueTasks;
  assert.equal(
    typeof claimAndStepDueTasks,
    "function",
    "the scheduler must expose its production slot-fill path",
  );
  assert.ok(claimAndStepDueTasks);

  const scheduling = claimAndStepDueTasks(runtime, workerConfig, {
    beforeClaimTransaction: async (slot, candidate) => {
      if (slot !== 1 || !taskIds.includes(candidate.id)) return;
      secondClaimBlocked.resolve();
      await releaseSecondClaim.promise;
    },
    afterClaimLocksBeforeTimestamp: async (slot, candidate) => {
      if (slot !== 1 || !taskIds.includes(candidate.id)) return;
      secondClaimLocksHeld.resolve();
      await releaseSecondClaimTimestamp.promise;
    },
    runClaimedTask: (claimed, lifecycle) =>
      stepTask(claimed, {
        runtimeOperationsConfig: workerConfig,
        leaseHeartbeatRuntime: manualHeartbeatRuntime,
        afterInitialLeaseHeartbeat: lifecycle.afterInitialLeaseHeartbeat,
        createCompletion: async (params) => {
          await params.beforeRequest?.();
          providerCalls += 1;
          if (providerCalls === 1) firstProviderStarted.resolve();
          if (providerCalls === 2) bothProvidersStarted.resolve();
          await releaseProviders.promise;
          return toolCompletion(params.model, "request_user_input", {
            question: "Hold the provider while the claim barrier is tested.",
          });
        },
      }),
  });

  try {
    await Promise.all([
      secondClaimBlocked.promise,
      firstProviderStarted.promise,
    ]);
    const firstClaimRows = await db
      .select()
      .from(tasksTable)
      .where(inArray(tasksTable.id, taskIds));
    const firstClaim = firstClaimRows.find((task) => task.leaseOwner !== null);
    assert.ok(
      firstClaim,
      "the first claim must commit before claim two blocks",
    );
    assert.equal(
      firstClaimRows.filter((task) => task.leaseOwner !== null).length,
      1,
    );
    assert.ok(firstClaim.leaseExpiresAt);
    const firstClaimLeaseExpiresAt = firstClaim.leaseExpiresAt;
    const firstAgentId = firstClaim.ownerAgentId;
    const firstLeaseOwner = firstClaim.leaseOwner;
    const [firstAttemptBeforeRecovery] = await db
      .select()
      .from(taskAttemptsTable)
      .where(eq(taskAttemptsTable.taskId, firstClaim.id));
    assert.equal(firstAttemptBeforeRecovery.state, "running");

    const firstTimer = timers.find((timer) => !timer.cleared);
    assert.ok(firstTimer, "the first claimed task must have a live heartbeat");
    const expiredAt = new Date(Date.now() - 1);
    await db
      .update(tasksTable)
      .set({ leaseExpiresAt: expiredAt })
      .where(eq(tasksTable.id, firstClaim.id));
    await db
      .update(agentsTable)
      .set({ runLeaseExpiresAt: expiredAt })
      .where(eq(agentsTable.id, firstAgentId));
    await Promise.resolve(firstTimer.callback());
    await reviveAndReleaseStaleWork();

    const [[firstAfterRecovery], [firstAttemptAfterRecovery]] =
      await Promise.all([
        db.select().from(tasksTable).where(eq(tasksTable.id, firstClaim.id)),
        db
          .select()
          .from(taskAttemptsTable)
          .where(eq(taskAttemptsTable.id, firstAttemptBeforeRecovery.id)),
      ]);
    assert.equal(firstAfterRecovery.leaseOwner, firstLeaseOwner);
    assert.equal(firstAfterRecovery.recoveryCount, 0);
    assert.equal(firstAttemptAfterRecovery.state, "running");

    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseSecondClaim.resolve();
    let claimLockTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        secondClaimLocksHeld.promise,
        new Promise<never>((_resolve, reject) => {
          claimLockTimer = setTimeout(
            () =>
              reject(
                new Error("post-lock claim timestamp barrier was not reached"),
              ),
            250,
          );
        }),
      ]);
    } finally {
      if (claimLockTimer) clearTimeout(claimLockTimer);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondClaimTimestampFloor = Date.now();
    releaseSecondClaimTimestamp.resolve();
    await bothProvidersStarted.promise;
    const claimedRows = await db
      .select()
      .from(tasksTable)
      .where(inArray(tasksTable.id, taskIds));
    const secondClaim = claimedRows.find((task) => task.id !== firstClaim.id);
    assert.ok(secondClaim?.leaseExpiresAt);
    assert.ok(
      secondClaim.leaseExpiresAt.getTime() > firstClaimLeaseExpiresAt.getTime(),
      "claim two must derive its lease from its released transaction, not batch selection time",
    );
    assert.ok(
      secondClaim.leaseExpiresAt.getTime() - workerConfig.taskLeaseMs >=
        secondClaimTimestampFloor,
      "claim two must derive its lease after the candidate locks and timestamp barrier release",
    );
  } finally {
    releaseProviders.resolve();
    releaseSecondClaim.resolve();
    releaseSecondClaimTimestamp.resolve();
    await scheduling.catch(() => undefined);
  }
});

test("two schedulers never create a delayed five-claim first batch", async (t) => {
  await dbReady;
  await startJudgeServer(t);
  const firstRuntime = await registerWorker(t);
  const secondRuntime = await registerWorker(t);
  const taskIds: number[] = [];
  const agentIds: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: `Immediate heartbeat agent ${index}`,
        role: "Test",
        systemPrompt: "Test only",
        createdByUser: true,
      })
      .returning();
    agentIds.push(agent.id);
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: `Immediate heartbeat task ${index}`,
        brief: "No claim may wait behind the runnable batch.",
        ownerAgentId: agent.id,
        status: "pending",
        createdByUser: true,
      })
      .returning();
    taskIds.push(task.id);
  }
  t.after(async () => {
    await db
      .update(tasksTable)
      .set({
        status: "cancelled",
        blockedReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(inArray(tasksTable.id, taskIds));
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(inArray(agentsTable.id, agentIds));
  });

  const firstBatch = (await claimDueTasks(firstRuntime, workerConfig)).filter(
    (task) => taskIds.includes(task.id),
  );
  const secondBatch = (await claimDueTasks(secondRuntime, workerConfig)).filter(
    (task) => taskIds.includes(task.id),
  );
  assert.equal(firstBatch.length, 3);
  assert.equal(secondBatch.length, 2);

  type ManualTimer = {
    callback: () => void | Promise<void>;
    cleared: boolean;
    unref(): void;
  };
  const timers: ManualTimer[] = [];
  const manualHeartbeatRuntime = {
    now: () => new Date(),
    setTimeout(callback: () => void | Promise<void>) {
      const timer: ManualTimer = {
        callback,
        cleared: false,
        unref() {},
      };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer: ManualTimer) {
      timer.cleared = true;
    },
  };
  const providerStarted = deferred<void>();
  const releaseProviders = deferred<void>();
  let providerCalls = 0;
  const allClaims = [...firstBatch, ...secondBatch];
  const stepping = allClaims.map((claimed) =>
    stepTask(claimed, {
      runtimeOperationsConfig: workerConfig,
      leaseHeartbeatRuntime: manualHeartbeatRuntime,
      createCompletion: async (params) => {
        await params.beforeRequest?.();
        providerCalls += 1;
        if (providerCalls === allClaims.length) providerStarted.resolve();
        await releaseProviders.promise;
        return toolCompletion(params.model, "request_user_input", {
          question:
            "Hold this provider until every claimed task is heartbeating.",
        });
      },
    }),
  );
  await providerStarted.promise;
  const initialTimers = timers.filter((timer) => !timer.cleared);
  assert.equal(initialTimers.length, 5);

  const expiredAt = new Date(Date.now() - 1);
  await db
    .update(tasksTable)
    .set({ leaseExpiresAt: expiredAt })
    .where(inArray(tasksTable.id, taskIds));
  await db
    .update(agentsTable)
    .set({ runLeaseExpiresAt: expiredAt })
    .where(inArray(agentsTable.id, agentIds));
  await Promise.all(
    initialTimers.map((timer) => Promise.resolve(timer.callback())),
  );
  await reviveAndReleaseStaleWork();

  const [liveTasks, liveAttempts] = await Promise.all([
    db.select().from(tasksTable).where(inArray(tasksTable.id, taskIds)),
    db
      .select()
      .from(taskAttemptsTable)
      .where(inArray(taskAttemptsTable.taskId, taskIds)),
  ]);
  assert.equal(liveTasks.length, 5);
  assert.equal(
    liveTasks.every((task) => task.recoveryCount === 0),
    true,
  );
  assert.equal(
    liveTasks.every((task) => task.leaseOwner !== null),
    true,
  );
  assert.equal(liveAttempts.length, 5);
  assert.equal(
    liveAttempts.every((attempt) => attempt.state === "running"),
    true,
  );

  releaseProviders.resolve();
  await Promise.all(stepping);
});

test("recovery loses an orphan active attempt whose task lease was already cleared and links its replacement", async (t) => {
  const fixture = await createClaimedFixture(t, "Orphan attempt recovery");
  await db
    .update(tasksTable)
    .set({
      leaseOwner: null,
      leaseExpiresAt: null,
      lastSteppedAt: new Date(Date.now() - 60_000),
    })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(agentsTable)
    .set({ runLeaseOwner: null, runLeaseExpiresAt: null, status: "idle" })
    .where(eq(agentsTable.id, fixture.agent.id));

  await reviveAndReleaseStaleWork();
  const [lost] = await db
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId));
  assert.equal(lost.state, "lost");

  const replacement = (await claimDueTasks(fixture.runtime, workerConfig)).find(
    (candidate) => candidate.id === fixture.task.id,
  );
  assert.ok(replacement);
  const [replacementAttempt] = await db
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.id, replacement.runtimeAttemptId));
  assert.equal(
    replacementAttempt.recoveryOfAttemptId,
    fixture.claimed.runtimeAttemptId,
  );
});

test("an expired lease cannot be reclaimed until recovery terminalizes its active attempt", async (t) => {
  const fixture = await createClaimedFixture(
    t,
    "Claim waits for attempt recovery",
  );
  const expiredAt = new Date(Date.now() - 60_000);
  await db
    .update(taskAttemptsTable)
    .set({ state: "running" })
    .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId));
  await db
    .update(tasksTable)
    .set({
      leaseExpiresAt: expiredAt,
      lastSteppedAt: expiredAt,
    })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(agentsTable)
    .set({ runLeaseExpiresAt: expiredAt })
    .where(eq(agentsTable.id, fixture.agent.id));

  const prematureClaim = (
    await claimDueTasks(fixture.runtime, workerConfig)
  ).find((candidate) => candidate.id === fixture.task.id);
  assert.equal(
    prematureClaim,
    undefined,
    "claim must defer while the previous attempt is still active",
  );
  const activeBeforeRecovery = await db
    .select()
    .from(taskAttemptsTable)
    .where(
      and(
        eq(taskAttemptsTable.taskId, fixture.task.id),
        inArray(taskAttemptsTable.state, ["claimed", "running"]),
      ),
    );
  assert.equal(activeBeforeRecovery.length, 1);
  assert.equal(activeBeforeRecovery[0]?.id, fixture.claimed.runtimeAttemptId);

  await reviveAndReleaseStaleWork();
  const [lostAttempt] = await db
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.id, fixture.claimed.runtimeAttemptId));
  assert.equal(lostAttempt.state, "lost");

  const replacement = (await claimDueTasks(fixture.runtime, workerConfig)).find(
    (candidate) => candidate.id === fixture.task.id,
  );
  assert.ok(replacement);
  const [replacementAttempt] = await db
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.id, replacement.runtimeAttemptId));
  assert.equal(
    replacementAttempt.recoveryOfAttemptId,
    fixture.claimed.runtimeAttemptId,
  );
  const activeAfterRecovery = await db
    .select()
    .from(taskAttemptsTable)
    .where(
      and(
        eq(taskAttemptsTable.taskId, fixture.task.id),
        inArray(taskAttemptsTable.state, ["claimed", "running"]),
      ),
    );
  assert.equal(activeAfterRecovery.length, 1);
  assert.equal(activeAfterRecovery[0]?.id, replacement.runtimeAttemptId);
});

test("recovery failures reject their caller instead of being reduced to a log", async (t) => {
  const fixture = await createClaimedFixture(t, "Throwing recovery core");
  const expiredAt = new Date(Date.now() - 60_000);
  await db
    .update(tasksTable)
    .set({ leaseExpiresAt: expiredAt })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(agentsTable)
    .set({ runLeaseExpiresAt: expiredAt })
    .where(eq(agentsTable.id, fixture.agent.id));
  const syntheticFailure = new Error("synthetic recovery transaction failure");
  const mutableDb = db as typeof db & { transaction: typeof db.transaction };
  const originalTransaction = mutableDb.transaction;
  let injected = false;
  mutableDb.transaction = ((...args: unknown[]) => {
    if (!injected) {
      injected = true;
      return Promise.reject(syntheticFailure);
    }
    return (originalTransaction as (...values: unknown[]) => unknown).apply(
      db,
      args,
    );
  }) as typeof db.transaction;
  try {
    await assert.rejects(reviveAndReleaseStaleWork(), syntheticFailure);
  } finally {
    mutableDb.transaction = originalTransaction;
  }
  assert.equal(injected, true);
});

test("consumed approval recovery persists unknown while stopped and owner-fences an expired replacement lease", async (t) => {
  await dbReady;
  await setEmergencyStop({ enabled: false, reason: null });
  const [approvalAgent] = await db
    .insert(agentsTable)
    .values({
      name: "Recovery unknown approval agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const replacementLeaseOwner = `recovery-replacement:${randomUUID()}`;
  const replacementExpiry = new Date(Date.now() - 60_000);
  const [replacementAgent] = await db
    .insert(agentsTable)
    .values({
      name: "Recovery unknown replacement owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: replacementLeaseOwner,
      runLeaseExpiresAt: replacementExpiry,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Recovery consumed ambiguity",
      brief: "Fail-closed recovery must preserve a replacement owner.",
      ownerAgentId: replacementAgent.id,
      status: "awaiting_approval",
      leaseOwner: replacementLeaseOwner,
      leaseExpiresAt: replacementExpiry,
      createdByUser: true,
    })
    .returning();
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: approvalAgent.id,
      category: "other",
      title: "Consumed recovery ambiguity",
      description: "A crashed consumed capability needs durable evidence.",
      status: "approved",
      resolvedAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(Date.now() - 30_000),
      scope: { toolName: "vm_run_command", argsHash: "recovery-unknown" },
      actionPayload: null,
    })
    .returning();
  t.after(async () => {
    await setEmergencyStop({ enabled: false, reason: null });
    await db
      .update(tasksTable)
      .set({
        status: "cancelled",
        blockedReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(inArray(agentsTable.id, [approvalAgent.id, replacementAgent.id]));
  });
  await setEmergencyStop({
    enabled: true,
    reason: "Recovery bookkeeping stop fixture",
  });
  // Recreate a different expired owner lease after stop cleanup. Recovery may
  // block/release that exact stale lease but must preserve the replacement
  // owner identity while persisting approval-specific evidence.
  await db
    .update(tasksTable)
    .set({
      ownerAgentId: replacementAgent.id,
      status: "awaiting_approval",
      leaseOwner: replacementLeaseOwner,
      leaseExpiresAt: replacementExpiry,
    })
    .where(eq(tasksTable.id, task.id));
  await db
    .update(agentsTable)
    .set({
      status: "working",
      currentTaskId: task.id,
      runLeaseOwner: replacementLeaseOwner,
      runLeaseExpiresAt: replacementExpiry,
    })
    .where(eq(agentsTable.id, replacementAgent.id));

  await reviveAndReleaseStaleWork();
  const [[preservedTask], [markedApproval], events] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approval.id)),
    db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, task.id)),
  ]);
  assert.equal(preservedTask.ownerAgentId, replacementAgent.id);
  assert.equal(preservedTask.leaseOwner, null);
  assert.equal(preservedTask.status, "blocked");
  assert.match(markedApproval.decisionNote ?? "", /APPROVAL_OUTCOME_UNKNOWN/u);
  assert.equal(
    events.filter(
      (event) =>
        event.detail?.approvalId === approval.id &&
        event.detail?.outcome === "unknown" &&
        event.detail?.replayBlocked === true,
    ).length,
    1,
  );
});

test("resolved approval recovery never requeues work while emergency stop is enabled", async (t) => {
  await dbReady;
  await setEmergencyStop({ enabled: false, reason: null });
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Stopped approval resume agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Stopped approval resume",
      brief: "Requeue requires execution-enabled authority.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  await db.insert(approvalRequestsTable).values({
    taskId: task.id,
    agentId: agent.id,
    category: "other",
    title: "Resolved non-action approval",
    description: "This can resume only after the stop is cleared.",
    status: "approved",
    resolvedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });
  t.after(async () => {
    await setEmergencyStop({ enabled: false, reason: null });
    await db
      .update(tasksTable)
      .set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({ isActive: false, status: "archived" })
      .where(eq(agentsTable.id, agent.id));
  });
  await setEmergencyStop({
    enabled: true,
    reason: "Do not resume resolved approval",
  });
  await reviveAndReleaseStaleWork();
  const [stoppedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.equal(stoppedTask.status, "awaiting_approval");
});

test("expired approval scrub linearizes on runtime controls before approval and task cleanup", async (t) => {
  await dbReady;
  await setEmergencyStop({ enabled: false, reason: null });
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Canonical scrub agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Canonical approval scrub",
      brief: "Expiry cleanup must own the stop row first.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Expired canonical approval",
      description: "Lock order regression.",
      status: "approved",
      resolvedAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() - 1),
      scope: { toolName: "vm_run_sudo_command", argsHash: "expired" },
      actionPayload: {
        toolName: "vm_run_sudo_command",
        args: { command: "echo never" },
      },
    })
    .returning();
  t.after(async () => {
    await setEmergencyStop({ enabled: false, reason: null });
    await db
      .update(tasksTable)
      .set({ status: "cancelled", blockedReason: null })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({ isActive: false, status: "archived" })
      .where(eq(agentsTable.id, agent.id));
  });
  const runtimeLocked = deferred<void>();
  const releaseScrub = deferred<void>();
  const scrubWithBarrier =
    scrubExpiredApprovals as typeof scrubExpiredApprovals &
      ((
        now: Date,
        dependencies: { afterRuntimeControlLock: () => Promise<void> },
      ) => Promise<number>);
  const scrubbing = scrubWithBarrier(new Date(), {
    afterRuntimeControlLock: async () => {
      runtimeLocked.resolve();
      await releaseScrub.promise;
    },
  });
  let barrierTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runtimeLocked.promise,
      new Promise<never>((_resolve, reject) => {
        barrierTimer = setTimeout(
          () =>
            reject(new Error("runtime-control scrub barrier was not reached")),
          250,
        );
      }),
    ]);
    const stopping = setEmergencyStop({
      enabled: true,
      reason: "Scrub serialization test",
    });
    const stopSettledBeforeRelease = await Promise.race([
      stopping.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    assert.equal(stopSettledBeforeRelease, false);
    releaseScrub.resolve();
    assert.equal(await scrubbing, 1);
    await stopping;
  } finally {
    if (barrierTimer) clearTimeout(barrierTimer);
    releaseScrub.resolve();
    await scrubbing.catch(() => undefined);
  }
  const [[scrubbed], [blockedTask]] = await Promise.all([
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approval.id)),
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
  ]);
  assert.equal(scrubbed.status, "rejected");
  assert.equal(scrubbed.actionPayload, null);
  assert.equal(blockedTask.status, "blocked");
});

test("expired approval scrub preserves a different live owner lease", async (t) => {
  await dbReady;
  await setEmergencyStop({ enabled: false, reason: null });
  const [approvalAgent, replacementAgent] = await db
    .insert(agentsTable)
    .values([
      {
        name: "Expired approval origin agent",
        role: "Test",
        systemPrompt: "Test only",
        createdByUser: true,
      },
      {
        name: "Expired approval replacement agent",
        role: "Test",
        systemPrompt: "Test only",
        createdByUser: true,
      },
    ])
    .returning();
  const replacementLeaseOwner = `replacement:${randomUUID()}`;
  const replacementLeaseExpiresAt = new Date(Date.now() + 60_000);
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Expired approval replacement lease",
      brief: "Expiry evidence must not revoke a different live worker.",
      ownerAgentId: replacementAgent.id,
      status: "awaiting_approval",
      leaseOwner: replacementLeaseOwner,
      leaseExpiresAt: replacementLeaseExpiresAt,
      createdByUser: true,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({
      status: "working",
      currentTaskId: task.id,
      runLeaseOwner: replacementLeaseOwner,
      runLeaseExpiresAt: replacementLeaseExpiresAt,
    })
    .where(eq(agentsTable.id, replacementAgent.id));
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: approvalAgent.id,
      category: "other",
      title: "Expired approval owned by an earlier agent",
      description: "The replacement worker lease must remain fenced.",
      status: "approved",
      resolvedAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() - 1),
      scope: { toolName: "vm_run_sudo_command", argsHash: "expired-owner" },
      actionPayload: {
        toolName: "vm_run_sudo_command",
        args: { command: "echo never" },
      },
    })
    .returning();
  t.after(async () => {
    await setEmergencyStop({ enabled: false, reason: null });
    await db
      .update(tasksTable)
      .set({
        status: "cancelled",
        blockedReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        currentTaskId: null,
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(inArray(agentsTable.id, [approvalAgent.id, replacementAgent.id]));
  });

  assert.equal(await scrubExpiredApprovals(new Date()), 1);
  const [[scrubbed], [blockedTask], [preservedAgent]] = await Promise.all([
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approval.id)),
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, replacementAgent.id)),
  ]);
  assert.equal(scrubbed.status, "rejected");
  assert.equal(scrubbed.actionPayload, null);
  assert.equal(blockedTask.status, "blocked");
  assert.equal(blockedTask.ownerAgentId, replacementAgent.id);
  assert.equal(blockedTask.leaseOwner, replacementLeaseOwner);
  assert.equal(
    blockedTask.leaseExpiresAt?.getTime(),
    replacementLeaseExpiresAt.getTime(),
  );
  assert.equal(preservedAgent.runLeaseOwner, replacementLeaseOwner);
  assert.equal(
    preservedAgent.runLeaseExpiresAt?.getTime(),
    replacementLeaseExpiresAt.getTime(),
  );
});

test("approved-action claim timestamps after canonical locks and refuses an approval that expires there", async (t) => {
  await dbReady;
  await setEmergencyStop({ enabled: false, reason: null });
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approved action timestamp agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: {
        canCreateSubAgents: false,
        canDelegate: false,
        canSpend: false,
        canDelete: false,
        canPublish: false,
        canContactExternal: false,
        canBrowse: true,
        canUseTerminal: true,
        canUseSudo: false,
      },
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Approved action timestamp",
      brief: "An expired capability cannot inherit a stale pre-lock clock.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const actionArgs = { command: "echo never-dispatch" };
  const argsHash = createHash("sha256")
    .update(JSON.stringify(actionArgs))
    .digest("hex");
  const expiresAt = new Date(Date.now() + 200);
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Expires behind the claim locks",
      description: "The transaction clock must be sampled after its locks.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt,
      scope: { toolName: "vm_run_command", argsHash, target: null },
      actionPayload: {
        toolName: "vm_run_command",
        args: actionArgs,
        taskDisposition: "resume",
      },
    })
    .returning();
  t.after(async () => {
    await setEmergencyStop({ enabled: false, reason: null });
    await db
      .update(tasksTable)
      .set({
        status: "cancelled",
        blockedReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(eq(agentsTable.id, agent.id));
  });

  const claimLocksHeld = deferred<void>();
  const releaseClaimTimestamp = deferred<void>();
  let effectCount = 0;
  const executeWithClaimBarrier = executeApprovedAction as unknown as (
    approvalId: number,
    config: typeof workerConfig,
    dependencies: {
      executeAction: typeof executeTool;
      afterClaimLocksBeforeTimestamp: () => Promise<void>;
    },
  ) => ReturnType<typeof executeApprovedAction>;
  const execution = executeWithClaimBarrier(approval.id, workerConfig, {
    afterClaimLocksBeforeTimestamp: async () => {
      claimLocksHeld.resolve();
      await releaseClaimTimestamp.promise;
    },
    executeAction: async () => {
      effectCount += 1;
      throw new Error("expired approval reached dispatch");
    },
  });
  let barrierTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      claimLocksHeld.promise,
      new Promise<never>((_resolve, reject) => {
        barrierTimer = setTimeout(
          () => reject(new Error("approved-action claim lock barrier missed")),
          250,
        );
      }),
    ]);
    const waitMs = Math.max(0, expiresAt.getTime() - Date.now() + 20);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } finally {
    if (barrierTimer) clearTimeout(barrierTimer);
    releaseClaimTimestamp.resolve();
  }
  const outcome = await execution;
  assert.deepEqual(outcome, {
    status: "queued",
    claimed: false,
    approvalId: approval.id,
  });
  assert.equal(effectCount, 0);
  const [[preservedApproval], [preservedTask], [preservedAgent]] =
    await Promise.all([
      db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, approval.id)),
      db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
      db.select().from(agentsTable).where(eq(agentsTable.id, agent.id)),
    ]);
  assert.equal(preservedApproval.consumedAt, null);
  assert.equal(preservedTask.leaseOwner, null);
  assert.equal(preservedAgent.runLeaseOwner, null);
});

test("an approved capability revalidates its exact task lease at the effect boundary", async (t) => {
  await dbReady;
  const runtime = await registerWorker(t);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approved pre-dispatch fence agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: {
        canCreateSubAgents: false,
        canDelegate: false,
        canSpend: false,
        canDelete: false,
        canPublish: false,
        canContactExternal: false,
        canBrowse: true,
        canUseTerminal: true,
        canUseSudo: false,
      },
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Approved pre-dispatch fence",
      brief: "No stale approved worker may dispatch.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const effectPath = `task4-pre-dispatch-${randomUUID()}.txt`;
  const actionArgs = { command: `write ${effectPath} forbidden` };
  const argsHash = createHash("sha256")
    .update(JSON.stringify(actionArgs))
    .digest("hex");
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Pre-dispatch fence",
      description: "The consumed capability must still honor its live lease.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      scope: { toolName: "vm_run_command", argsHash, target: null },
      actionPayload: {
        toolName: "vm_run_command",
        args: actionArgs,
        taskDisposition: "resume",
      },
    })
    .returning();
  t.after(async () => {
    await deleteEntry(agent.id, effectPath).catch(() => undefined);
    await db
      .update(tasksTable)
      .set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(eq(agentsTable.id, agent.id));
  });

  let boundaryChecks = 0;
  const executeWithBoundary = executeApprovedAction as unknown as (
    approvalId: number,
    config: typeof workerConfig,
    dependencies: {
      runtimeInstanceId: string;
      beforeOperationEffectBoundary: () => Promise<void>;
    },
  ) => ReturnType<typeof executeApprovedAction>;
  const outcome = await executeWithBoundary(approval.id, workerConfig, {
    runtimeInstanceId: runtime.id,
    beforeOperationEffectBoundary: async () => {
      boundaryChecks += 1;
      const [unconsumed] = await db
        .select({ consumedAt: approvalRequestsTable.consumedAt })
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, approval.id));
      assert.equal(unconsumed?.consumedAt, null);
      await db
        .update(tasksTable)
        .set({ leaseExpiresAt: new Date(Date.now() - 1) })
        .where(eq(tasksTable.id, task.id));
    },
  });

  assert.equal(boundaryChecks, 1, JSON.stringify(outcome));
  assert.equal(outcome.status, "failed");
  await assert.rejects(
    readTextFile(agent.id, effectPath),
    /Dosya bulunamadi/iu,
  );
  const [[preservedApproval], [receipt], events] = await Promise.all([
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approval.id)),
    db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.approvalId, approval.id)),
    db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, task.id)),
  ]);
  assert.ok(receipt);
  const invocations = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.receiptId, receipt.id));
  assert.equal(preservedApproval.consumedAt, null);
  assert.ok(preservedApproval.actionPayload);
  assert.equal(receipt.state, "reserved");
  assert.equal(
    invocations.some((invocation) => invocation.state === "failed"),
    true,
  );
  assert.equal(
    events.some(
      (event) =>
        event.detail?.approvalId === approval.id &&
        (event.detail?.replayBlocked === true ||
          event.detail?.outcome === "unknown"),
    ),
    false,
  );
});

test("a long approved action heartbeats task, agent, and invocation leases without extending crash recovery", async (t) => {
  await dbReady;
  const runtime = await registerWorker(t);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Long approved action owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
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
      title: "Long approved action",
      brief: "Remain live beyond the original invocation lease.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const args = { command: `long-approved-${randomUUID()}` };
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Long approved action",
      description: "Exercise periodic durable ownership renewal.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60_000),
      scope: {
        toolName: "vm_run_command",
        argsHash: createHash("sha256")
          .update(JSON.stringify(args))
          .digest("hex"),
        target: null,
      },
      actionPayload: {
        toolName: "vm_run_command",
        args,
        taskDisposition: "resume",
      },
    })
    .returning();
  const clock = new ManualLeaseHeartbeatClock(new Date());
  const effectStarted = deferred<void>();
  const finishEffect = deferred<void>();
  let assertApprovedOwnership: (() => Promise<void>) | undefined;
  const execution = executeApprovedAction(approval.id, workerConfig, {
    runtimeInstanceId: runtime.id,
    leaseHeartbeatRuntime: clock,
    executeAction: (ctx) => {
      assertApprovedOwnership = ctx.assertTaskLease;
      return runDurableExternalEffect(ctx, {
        toolName: "vm_run_command",
        normalizedArgs: args,
        execute: async ({ startEffect }) => {
          await startEffect();
          effectStarted.resolve();
          await finishEffect.promise;
          return {
            result: {
              content: "long effect completed",
              createdTasks: [],
              createdAgents: [],
              toolOutcome: "succeeded",
            },
            resultData: { ok: true, exitCode: 0, durationMs: 70_000 },
          };
        },
        onError: async () => ({
          content: "long effect failed",
          createdTasks: [],
          createdAgents: [],
          toolOutcome: "rejected",
        }),
      });
    },
  });
  await effectStarted.promise;
  await clock.advanceBy(70_000);

  assert.ok(assertApprovedOwnership);
  const mutableDb = db as typeof db & { transaction: typeof db.transaction };
  const originalTransaction = mutableDb.transaction;
  let databaseUnavailable = true;
  let failedTransactions = 0;
  mutableDb.transaction = ((...transactionArgs: unknown[]) => {
    if (databaseUnavailable) {
      failedTransactions += 1;
      return Promise.reject(
        new Error("synthetic approved-action heartbeat persistence outage"),
      );
    }
    return (originalTransaction as (...values: unknown[]) => unknown).apply(
      db,
      transactionArgs,
    );
  }) as typeof db.transaction;

  const failedHeartbeatCount =
    Math.ceil(workerConfig.taskLeaseMs / workerConfig.taskHeartbeatMs) + 1;
  try {
    for (let failure = 0; failure < failedHeartbeatCount; failure += 1) {
      await clock.advanceBy(workerConfig.taskHeartbeatMs);
      assert.equal(
        failedTransactions,
        failure + 1,
        "a transient persistence outage must keep the approved heartbeat retrying at the same cadence",
      );
    }
    await assert.rejects(
      assertApprovedOwnership(),
      TaskLeaseOwnershipLostError,
    );
    assert.equal(failedTransactions, failedHeartbeatCount + 1);

    databaseUnavailable = false;
    await clock.advanceBy(workerConfig.taskHeartbeatMs);
    await assertApprovedOwnership();
  } finally {
    databaseUnavailable = false;
    mutableDb.transaction = originalTransaction;
  }

  const [[liveTask], [liveAgent], [liveReceipt]] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db.select().from(agentsTable).where(eq(agentsTable.id, agent.id)),
    db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.approvalId, approval.id)),
  ]);
  assert.ok(liveReceipt);
  const [liveInvocation] = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.receiptId, liveReceipt.id));
  assert.ok(liveInvocation);
  assert.ok(liveTask.leaseExpiresAt);
  assert.ok(liveAgent.runLeaseExpiresAt);
  assert.ok(liveInvocation.leaseExpiresAt);
  assert.ok(liveTask.leaseExpiresAt.getTime() > clock.now().getTime());
  assert.ok(liveAgent.runLeaseExpiresAt.getTime() > clock.now().getTime());
  assert.ok(liveInvocation.leaseExpiresAt.getTime() > clock.now().getTime());
  assert.ok(
    liveInvocation.leaseExpiresAt.getTime() -
      liveInvocation.lastHeartbeatAt.getTime() <=
      workerConfig.taskLeaseMs,
  );
  assert.ok(
    workerConfig.taskLeaseMs + workerConfig.schedulerTickMs <=
      workerConfig.recoveryTargetMs,
  );

  finishEffect.resolve();
  const outcome = await execution;
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.claimed, true);
});

test("approved-action heartbeat cannot resurrect leases reclaimed by another owner", async (t) => {
  await dbReady;
  const runtime = await registerWorker(t);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approved heartbeat replacement fence",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
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
      title: "Approved heartbeat replacement fence",
      brief: "A stale heartbeat must not overwrite a replacement lease.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const args = { command: `replacement-fence-${randomUUID()}` };
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Approved heartbeat replacement fence",
      description: "Exercise exact owner compare-and-set renewal.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60_000),
      scope: {
        toolName: "vm_run_command",
        argsHash: createHash("sha256")
          .update(JSON.stringify(args))
          .digest("hex"),
        target: null,
      },
      actionPayload: {
        toolName: "vm_run_command",
        args,
        taskDisposition: "resume",
      },
    })
    .returning();
  t.after(async () => {
    await db
      .update(tasksTable)
      .set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(eq(agentsTable.id, agent.id));
  });

  const clock = new ManualLeaseHeartbeatClock(new Date());
  const effectStarted = deferred<void>();
  const finishEffect = deferred<void>();
  const execution = executeApprovedAction(approval.id, workerConfig, {
    runtimeInstanceId: runtime.id,
    leaseHeartbeatRuntime: clock,
    executeAction: (ctx) =>
      runDurableExternalEffect(ctx, {
        toolName: "vm_run_command",
        normalizedArgs: args,
        execute: async ({ startEffect }) => {
          await startEffect();
          effectStarted.resolve();
          await finishEffect.promise;
          return {
            result: {
              content: "replacement fence effect completed",
              createdTasks: [],
              createdAgents: [],
              toolOutcome: "succeeded",
            },
            resultData: { ok: true, exitCode: 0, durationMs: 1 },
          };
        },
        onError: async () => ({
          content: "replacement fence effect failed",
          createdTasks: [],
          createdAgents: [],
          toolOutcome: "rejected",
        }),
      }),
  });
  await effectStarted.promise;

  const [receipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.approvalId, approval.id));
  const [invocation] = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.receiptId, receipt.id));
  const replacementOwner = `replacement:${randomUUID()}`;
  const replacementExpiry = new Date(
    clock.now().getTime() + workerConfig.taskLeaseMs,
  );
  await Promise.all([
    db
      .update(tasksTable)
      .set({ leaseOwner: replacementOwner, leaseExpiresAt: replacementExpiry })
      .where(eq(tasksTable.id, task.id)),
    db
      .update(agentsTable)
      .set({
        runLeaseOwner: replacementOwner,
        runLeaseExpiresAt: replacementExpiry,
      })
      .where(eq(agentsTable.id, agent.id)),
    db
      .update(operationInvocationsTable)
      .set({ leaseOwner: replacementOwner, leaseExpiresAt: replacementExpiry })
      .where(eq(operationInvocationsTable.id, invocation.id)),
  ]);

  await clock.advanceBy(workerConfig.taskHeartbeatMs * 2);
  const [[preservedTask], [preservedAgent], [preservedInvocation]] =
    await Promise.all([
      db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
      db.select().from(agentsTable).where(eq(agentsTable.id, agent.id)),
      db
        .select()
        .from(operationInvocationsTable)
        .where(eq(operationInvocationsTable.id, invocation.id)),
    ]);
  assert.equal(preservedTask.leaseOwner, replacementOwner);
  assert.equal(
    preservedTask.leaseExpiresAt?.getTime(),
    replacementExpiry.getTime(),
  );
  assert.equal(preservedAgent.runLeaseOwner, replacementOwner);
  assert.equal(
    preservedAgent.runLeaseExpiresAt?.getTime(),
    replacementExpiry.getTime(),
  );
  assert.equal(preservedInvocation.leaseOwner, replacementOwner);
  assert.equal(
    preservedInvocation.leaseExpiresAt.getTime(),
    replacementExpiry.getTime(),
  );

  finishEffect.resolve();
  const outcome = await execution;
  assert.notEqual(outcome.status, "succeeded");
  const [[finalTask], [finalAgent], [finalInvocation]] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db.select().from(agentsTable).where(eq(agentsTable.id, agent.id)),
    db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.id, invocation.id)),
  ]);
  assert.equal(finalTask.leaseOwner, replacementOwner);
  assert.equal(finalAgent.runLeaseOwner, replacementOwner);
  assert.equal(finalInvocation.leaseOwner, replacementOwner);
});

test("a succeeded approved-action receipt is not downgraded when its caller throws", async (t) => {
  await dbReady;
  const runtime = await registerWorker(t);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approved dispatch ambiguity agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: {
        canCreateSubAgents: false,
        canDelegate: false,
        canSpend: false,
        canDelete: false,
        canPublish: false,
        canContactExternal: false,
        canBrowse: true,
        canUseTerminal: true,
        canUseSudo: false,
      },
    })
    .returning();
  const [replacementAgent] = await db
    .insert(agentsTable)
    .values({
      name: "Approved dispatch replacement owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Approved dispatch ambiguity",
      brief:
        "A post-dispatch throw cannot be classified as deterministic failure.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const effectPath = `task4-dispatch-unknown-${randomUUID()}.txt`;
  t.after(async () => {
    await deleteEntry(agent.id, effectPath).catch(() => undefined);
    await db
      .update(tasksTable)
      .set({
        status: "cancelled",
        blockedReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(eq(agentsTable.id, agent.id));
    await db
      .update(agentsTable)
      .set({ isActive: false, status: "archived" })
      .where(eq(agentsTable.id, replacementAgent.id));
  });
  const actionArgs = { command: `write ${effectPath} once` };
  const argsHash = createHash("sha256")
    .update(JSON.stringify(actionArgs))
    .digest("hex");
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Dispatch ambiguity",
      description: "The capability is consumed before the external effect.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      scope: { toolName: "vm_run_command", argsHash, target: null },
      actionPayload: {
        toolName: "vm_run_command",
        args: actionArgs,
        taskDisposition: "resume",
      },
    })
    .returning();
  const unrelatedApprovalId = approval.id + 1_000_000;
  await db.insert(activityEventsTable).values({
    agentId: agent.id,
    taskId: task.id,
    type: "error",
    summary: "Unrelated approval ambiguity fixture",
    detail: {
      approvalId: unrelatedApprovalId,
      outcome: "unknown",
      replayBlocked: true,
    },
    severity: "critical",
  });

  const dispatchFailure = new Error("synthetic post-dispatch failure");
  const executeWithDependencies =
    executeApprovedAction as typeof executeApprovedAction &
      ((
        approvalId: number,
        config: typeof workerConfig,
        dependencies: {
          executeAction: typeof executeTool;
          runtimeInstanceId: string;
        },
      ) => ReturnType<typeof executeApprovedAction>);
  const outcome = await executeWithDependencies(approval.id, workerConfig, {
    runtimeInstanceId: runtime.id,
    executeAction: async (...args) => {
      await executeTool(...args);
      await db
        .update(tasksTable)
        .set({ ownerAgentId: replacementAgent.id })
        .where(eq(tasksTable.id, task.id));
      throw dispatchFailure;
    },
  });

  assert.equal(outcome.status, "queued");
  assert.equal(outcome.claimed, true);
  assert.equal((await readTextFile(agent.id, effectPath)).content, "once");
  const [durableReceipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.approvalId, approval.id));
  assert.ok(durableReceipt);
  const [durableInvocation] = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.receiptId, durableReceipt.id));
  assert.ok(durableInvocation);
  assert.ok(
    durableInvocation.leaseExpiresAt.getTime() -
      durableInvocation.claimedAt.getTime() >=
      workerConfig.taskLeaseMs,
    "the boundary heartbeat renews the invocation through the task lease",
  );
  assert.ok(
    durableInvocation.leaseExpiresAt.getTime() -
      durableInvocation.claimedAt.getTime() <
      workerConfig.recoveryTargetMs,
    "a crashed approved action must remain recoverable within the configured target",
  );
  const [blockedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.equal(blockedTask.ownerAgentId, replacementAgent.id);
  assert.equal(blockedTask.status, "awaiting_approval");
  assert.equal(blockedTask.blockedReason, null);
  const replay = await executeApprovedAction(approval.id, workerConfig);
  assert.equal(replay.status, "queued");
  assert.equal(replay.claimed, false);
  const events = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.taskId, task.id));
  assert.equal(
    events.filter(
      (event) =>
        event.detail?.approvalId === approval.id &&
        (event.detail?.replayBlocked === true ||
          event.detail?.outcome === "unknown"),
    ).length,
    0,
  );
  assert.equal(
    events.filter((event) => event.detail?.approvalId === unrelatedApprovalId)
      .length,
    1,
  );
});

test("post-effect durable success survives emergency stop and preserves a different live owner lease", async (t) => {
  await dbReady;
  await setEmergencyStop({ enabled: false, reason: null });
  const runtime = await registerWorker(t);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approved emergency ambiguity agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: {
        canCreateSubAgents: false,
        canDelegate: false,
        canSpend: false,
        canDelete: false,
        canPublish: false,
        canContactExternal: false,
        canBrowse: true,
        canUseTerminal: true,
        canUseSudo: false,
      },
    })
    .returning();
  const [replacementAgent] = await db
    .insert(agentsTable)
    .values({
      name: "Approved emergency replacement owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Approved emergency ambiguity",
      brief: "Unknown evidence must survive a stop after the effect.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const effectPath = `task4-emergency-unknown-${randomUUID()}.txt`;
  const replacementLeaseOwner = `replacement:${randomUUID()}`;
  t.after(async () => {
    await setEmergencyStop({ enabled: false, reason: null });
    await deleteEntry(agent.id, effectPath).catch(() => undefined);
    await db
      .update(tasksTable)
      .set({
        status: "cancelled",
        blockedReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(tasksTable.id, task.id));
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        status: "archived",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(inArray(agentsTable.id, [agent.id, replacementAgent.id]));
  });
  const actionArgs = { command: `write ${effectPath} once` };
  const argsHash = createHash("sha256")
    .update(JSON.stringify(actionArgs))
    .digest("hex");
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Emergency dispatch ambiguity",
      description: "The stop happens after capability consumption and effect.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      scope: { toolName: "vm_run_command", argsHash, target: null },
      actionPayload: {
        toolName: "vm_run_command",
        args: actionArgs,
        taskDisposition: "resume",
      },
    })
    .returning();

  const outcome = await executeApprovedAction(approval.id, workerConfig, {
    runtimeInstanceId: runtime.id,
    executeAction: async (...args) => {
      await executeTool(...args);
      await setEmergencyStop({
        enabled: true,
        reason: "Synthetic stop after approved effect",
      });
      const replacementExpiry = new Date(Date.now() + 60_000);
      await db
        .update(tasksTable)
        .set({
          ownerAgentId: replacementAgent.id,
          status: "in_progress",
          leaseOwner: replacementLeaseOwner,
          leaseExpiresAt: replacementExpiry,
        })
        .where(eq(tasksTable.id, task.id));
      await db
        .update(agentsTable)
        .set({
          status: "working",
          currentTaskId: task.id,
          runLeaseOwner: replacementLeaseOwner,
          runLeaseExpiresAt: replacementExpiry,
        })
        .where(eq(agentsTable.id, replacementAgent.id));
      throw new Error("synthetic post-effect emergency failure");
    },
  });

  assert.equal(outcome.status, "queued");
  assert.equal(outcome.claimed, true);
  assert.equal((await readTextFile(agent.id, effectPath)).content, "once");
  const [[preservedTask], [persistedApproval], events] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approval.id)),
    db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, task.id)),
  ]);
  assert.equal(preservedTask.ownerAgentId, replacementAgent.id);
  assert.equal(preservedTask.status, "in_progress");
  assert.equal(preservedTask.leaseOwner, replacementLeaseOwner);
  assert.doesNotMatch(
    persistedApproval.decisionNote ?? "",
    /APPROVAL_OUTCOME_UNKNOWN/u,
  );
  assert.equal(
    events.filter(
      (event) =>
        event.detail?.approvalId === approval.id &&
        event.detail?.outcome === "unknown" &&
        event.detail?.replayBlocked === true,
    ).length,
    0,
  );
  const replay = await executeApprovedAction(approval.id, workerConfig);
  assert.equal(replay.status, "queued");
  assert.equal(replay.claimed, false);
});

test("a succeeded approved action keeps durable truth across a lease-expiry finalization race", async (t) => {
  await dbReady;
  const runtime = await registerWorker(t);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approved unknown agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Approved unknown race",
      brief: "The consumed effect must never be described as queued.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const effectPath = `task4-effect-${randomUUID()}.txt`;
  const command = `write ${effectPath} once`;
  const actionArgs = { command };
  const argsHash = createHash("sha256")
    .update(JSON.stringify(actionArgs))
    .digest("hex");
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "other",
      title: "Delayed approved effect",
      description: "Exercise post-consume ambiguity.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      scope: { toolName: "vm_run_command", argsHash, target: null },
      actionPayload: {
        toolName: "vm_run_command",
        args: actionArgs,
        taskDisposition: "resume",
      },
    })
    .returning();
  let finalizationHooks = 0;
  const outcome = await executeApprovedAction(approval.id, workerConfig, {
    runtimeInstanceId: runtime.id,
    afterEffectBeforeFinalization: async () => {
      finalizationHooks += 1;
      const [consumed] = await db
        .select({ consumedAt: approvalRequestsTable.consumedAt })
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, approval.id));
      assert.ok(consumed?.consumedAt);
      await db
        .update(tasksTable)
        .set({ leaseExpiresAt: new Date(Date.now() - 1) })
        .where(eq(tasksTable.id, task.id));
      await db
        .update(agentsTable)
        .set({ runLeaseExpiresAt: new Date(Date.now() - 1) })
        .where(eq(agentsTable.id, agent.id));
      await reviveAndReleaseStaleWork();
    },
  });

  assert.equal(finalizationHooks, 1);
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.claimed, true);
  assert.equal((await readTextFile(agent.id, effectPath)).content, "once");
  const replay = await executeApprovedAction(approval.id, workerConfig);
  assert.equal(replay.status, "queued");
  assert.equal(replay.claimed, false);
  const events = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.taskId, task.id));
  assert.equal(
    events.filter(
      (event) =>
        event.detail?.approvalId === approval.id &&
        (event.detail?.replayBlocked === true ||
          event.detail?.outcome === "unknown"),
    ).length,
    0,
  );
  assert.equal(
    events.filter(
      (event) =>
        event.type === "approval_resolved" &&
        event.detail?.approvalId === approval.id,
    ).length,
    1,
  );
  assert.equal(
    events.some((event) => /remains queued|sirada/iu.test(event.summary)),
    false,
  );
  await deleteEntry(agent.id, effectPath);
});
