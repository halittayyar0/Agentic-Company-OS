import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import type { ToolRuntimeContext } from "./execute-tool";
import type { WorkspaceLocale } from "../workspace-locale";
import type { createChatCompletion } from "@workspace/ai-server";

delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
process.env.NODE_ENV = "test";
process.env.AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS = "true";
process.env.AGENT_BROWSER_HEADLESS = "true";
const sandboxRoot = await fsp.mkdtemp(
  path.join(os.tmpdir(), "acos-team-locales-"),
);
process.env.AGENT_SANDBOX_ROOT = sandboxRoot;
const judgeRequests: { messages: { role: string; content: string }[] }[] = [];
let judgeVerdict = "pass";
const judge = http.createServer(async (request, response) => {
  if (request.method === "GET") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      '<!doctype html><label>原文 {title} $&<input name="plain" aria-label="原文 {title} $&"></label><button>原文 {button} $&</button>',
    );
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  judgeRequests.push(JSON.parse(body));
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      id: randomUUID(),
      object: "chat.completion",
      created: 1,
      model: "local-judge",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: JSON.stringify({
              verdict: judgeVerdict,
              reasoning: "原文 {reasoning} $&",
            }),
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  );
});
await new Promise<void>((resolve) => judge.listen(0, "127.0.0.1", resolve));
const address = judge.address();
assert.ok(address && typeof address !== "string");
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "local-team-test-key";
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
const {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  usageEventsTable,
  taskAttemptsTable,
  runtimeInstancesTable,
  activityEventsTable,
  approvalRequestsTable,
  operationReceiptsTable,
  companyChannelsTable,
  companyChannelMembersTable,
  companyMessagesTable,
  messagesTable,
} = await import("@workspace/db");
const { executeTool } = await import("./execute-tool");
const { specialistPermissionsPreset } = await import("./permission-presets");
const { getToolCopy, toolMessage } = await import("./tool-localization");
const { WORKSPACE_LOCALES } = await import("../workspace-locale");
const browser = await import("../vm/browser");
const { runJudge } = await import("./judge");
const { loadCompletionEvidence } = await import("./completion-evidence");
const { ModelRoutesExhaustedError } = await import("./model-fallback");
const { TaskSpendBudgetError } = await import("./task-spend-admission");
const { canonicalArgumentHash } = await import("./operation-receipts");
const { getAgentSudoTarget } = await import("../vm/sandbox");
const { stepTask } = await import("./step-task");
const { readRuntimeOperationsConfig } =
  await import("../runtime-operations-config");

test.after(async () => {
  await browser.closeAllSessions();
  judge.closeAllConnections();
  await new Promise<void>((resolve) => judge.close(() => resolve()));
  await closeDatabase();
  await fsp.rm(sandboxRoot, { recursive: true, force: true });
});

const source = "  原文 {name} $&\n  متن عربي\n ";
async function context(
  locale: WorkspaceLocale = "en",
  withTask = false,
): Promise<ToolRuntimeContext> {
  await dbReady;
  const suffix = randomUUID();
  const leaseOwner = `team-${suffix}`;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Team ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(Date.now() + 180_000),
      permissions: {
        ...specialistPermissionsPreset,
        canCreateSubAgents: true,
        canDelegate: true,
      },
    })
    .returning();
  if (!withTask) return { agent, taskId: null, locale };
  const runtimeInstanceId = `team-runtime-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeInstanceId,
    role: "worker",
    state: "healthy",
    hostname: "test",
    processId: 1,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: new Date(),
  });
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Team locale task",
      brief: source,
      ownerAgentId: agent.id,
      createdByUser: true,
      status: "in_progress",
      progressPercent: 47,
      leaseOwner,
      leaseExpiresAt: new Date(Date.now() + 180_000),
      stepAttempts: 1,
    })
    .returning();
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
    locale,
    taskLeaseOwner: leaseOwner,
    runtimeAttemptId,
    assertTaskLease: async () => undefined,
    operationIdentity: {
      executionKind: "task_step",
      logicalExecutionId,
      runtimeInstanceId,
      originAttemptId: runtimeAttemptId,
      sourceMessageId: null,
      modelToolCallId: `call-${suffix}`,
      callSlot: "round:0:tool:0",
      agentLeaseOwner: leaseOwner,
    },
  };
}
const call = (
  ctx: ToolRuntimeContext,
  name: string,
  args: Record<string, unknown>,
) => executeTool(ctx, name, JSON.stringify(args));

async function evidenceReceipt(
  ctx: ToolRuntimeContext,
  overrides: Partial<typeof operationReceiptsTable.$inferInsert> = {},
) {
  const id = randomUUID();
  const [receipt] = await db
    .insert(operationReceiptsTable)
    .values({
      id,
      operationKey: `evidence-${id}`,
      replayKey: `evidence-${id}`,
      executionKind: "task_step",
      logicalExecutionId: ctx.operationIdentity!.logicalExecutionId,
      taskId: ctx.taskId!,
      agentId: ctx.agent.id,
      originAttemptId: ctx.runtimeAttemptId!,
      sideEffectClass: "at_most_once",
      state: "failed",
      toolName: "vm_run_command",
      argumentHash: "0".repeat(64),
      startedAt: new Date(),
      finishedAt: new Date(),
      failureKind: "command_failed",
      sanitizedError: "Command exited with code 1",
      resultData: { ok: false, exitCode: 1 },
      ...overrides,
    })
    .returning();
  return receipt;
}

async function taskEvidence(ctx: ToolRuntimeContext) {
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, ctx.taskId!));
  return loadCompletionEvidence(task);
}

async function retireFixtureAgent(agentId: number) {
  // Keep completed fixture evidence, but do not consume another scenario's
  // active-agent capacity or leave executable tasks behind.
  await db
    .update(tasksTable)
    .set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null })
    .where(eq(tasksTable.ownerAgentId, agentId));
  await db
    .update(agentsTable)
    .set({
      isActive: false,
      status: "archived",
      currentTaskId: null,
      currentAction: null,
      runLeaseOwner: null,
      runLeaseExpiresAt: null,
    })
    .where(eq(agentsTable.id, agentId));
}

async function finalizeClaimedTool(
  ctx: ToolRuntimeContext,
  name: string,
  args: Record<string, unknown>,
) {
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, ctx.taskId!));
  // This fixture owns both leases and a registered, healthy worker row. Start
  // the real outer step at its claimed boundary instead of applying an intent.
  await db
    .update(taskAttemptsTable)
    .set({ state: "claimed" })
    .where(eq(taskAttemptsTable.id, ctx.runtimeAttemptId!));
  const createCompletion: typeof createChatCompletion = async (params) => {
    await params.beforeRequest?.();
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
              tool_calls: [
                {
                  id: randomUUID(),
                  type: "function",
                  function: { name, arguments: JSON.stringify(args) },
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
      ...task,
      leaseOwner: ctx.taskLeaseOwner!,
      runtimeAttemptId: ctx.runtimeAttemptId!,
      runtimeInstanceId: ctx.operationIdentity!.runtimeInstanceId!,
      logicalExecutionId: ctx.operationIdentity!.logicalExecutionId,
    },
    {
      locale: ctx.locale,
      runtimeOperationsConfig: readRuntimeOperationsConfig({
        RUNTIME_ROLE: "worker",
      }),
      createCompletion,
    },
  );
}

test("outer browser approval finalization omits the activity target while retaining the exact capability and preview", async (t) => {
  for (const locale of WORKSPACE_LOCALES) {
    for (const toolName of ["browser_type", "browser_click"] as const) {
      await t.test(`${locale} ${toolName}`, async (subtest) => {
        const ctx = await context(locale, true);
        subtest.after(() => retireFixtureAgent(ctx.agent.id));
        await db
          .update(agentsTable)
          .set({
            permissions: { ...ctx.agent.permissions, canContactExternal: true },
          })
          .where(eq(agentsTable.id, ctx.agent.id));
        const url = `http://127.0.0.1:${address.port}/private-target-${randomUUID()}`;
        try {
          await browser.navigateTo(ctx.agent.id, url);
          const before = await browser.snapshotPage(ctx.agent.id);
          const ref = Number(
            before.lines
              .find(
                (line) =>
                  line.includes(
                    toolName === "browser_type" ? "{title}" : "{button}",
                  ) && line.includes("[ref="),
              )
              ?.match(/\[ref=(\d+)\]/)?.[1],
          );
          assert.ok(ref);
          const toolArgs =
            toolName === "browser_type"
              ? { ref, text: source, submit: false }
              : { ref };
          await finalizeClaimedTool(ctx, "request_approval", {
            title: "Reviewed browser action",
            description: "Exact source remains in the approval",
            category: "external_contact",
            toolName,
            toolArgs,
          });
          const [approval] = await db
            .select()
            .from(approvalRequestsTable)
            .where(eq(approvalRequestsTable.taskId, ctx.taskId!));
          assert.ok(approval);
          assert.equal(approval.status, "pending");
          assert.equal(approval.consumedAt, null);
          assert.equal(approval.scope?.toolName, toolName);
          assert.ok(approval.scope?.target?.includes(url));
          assert.ok(
            approval.scope?.preview?.includes(
              toolMessage(locale, "previewPage", { url }),
            ),
          );
          assert.equal(approval.actionPayload?.args.ref, ref);
          if (toolName === "browser_type")
            assert.equal(approval.actionPayload?.args.text, source);
          assert.ok(approval.browserBindingHash);
          const [event] = await db
            .select()
            .from(activityEventsTable)
            .where(
              and(
                eq(activityEventsTable.taskId, ctx.taskId!),
                eq(activityEventsTable.type, "approval_requested"),
              ),
            );
          assert.equal(
            event.summary,
            toolMessage(locale, "teamApprovalActivity", {
              title: approval.title,
            }),
          );
          assert.equal(event.detail?.target, null);
          assert.equal(event.detail?.toolName, toolName);
          assert.ok(!JSON.stringify(event).includes(url));
          const after = await browser.snapshotPage(ctx.agent.id);
          assert.deepEqual(after.lines, before.lines);
          const [task] = await db
            .select()
            .from(tasksTable)
            .where(eq(tasksTable.id, ctx.taskId!));
          assert.equal(task.status, "awaiting_approval");
          assert.equal(task.leaseOwner, null);
        } finally {
          await browser.closeSession(ctx.agent.id);
        }
      });
    }
  }
});

test("parent completion notifications retain source layout and unfenced direct completion stays rejected", async (t) => {
  for (const locale of WORKSPACE_LOCALES) {
    for (const mode of ["outer", "unfenced"] as const) {
      await t.test(`${locale} ${mode}`, async (subtest) => {
        const parent = await context(locale);
        subtest.after(() => retireFixtureAgent(parent.agent.id));
        const ctx = await context(locale, true);
        subtest.after(() => retireFixtureAgent(ctx.agent.id));
        const [parentTask] = await db
          .insert(tasksTable)
          .values({
            title: "Parent source",
            brief: "Review child work",
            ownerAgentId: parent.agent.id,
            status: "in_progress",
            createdByUser: true,
          })
          .returning();
        await db
          .update(tasksTable)
          .set({
            parentTaskId: parentTask.id,
            assignedByAgentId: parent.agent.id,
            title: source,
          })
          .where(eq(tasksTable.id, ctx.taskId!));
        await db
          .update(agentsTable)
          .set({ name: source })
          .where(eq(agentsTable.id, ctx.agent.id));
        if (mode === "outer")
          await finalizeClaimedTool(ctx, "complete_task", {
            resultSummary: source,
          });
        else {
          const result = await call(
            {
              ...ctx,
              operationIdentity: undefined,
              runtimeAttemptId: undefined,
            },
            "complete_task",
            { resultSummary: source },
          );
          assert.equal(result.toolOutcome, "rejected", result.content);
          const [unchanged] = await db
            .select()
            .from(tasksTable)
            .where(eq(tasksTable.id, ctx.taskId!));
          assert.equal(unchanged.status, "in_progress");
          assert.equal(unchanged.resultSummary, null);
          const events = await db
            .select()
            .from(activityEventsTable)
            .where(eq(activityEventsTable.taskId, parentTask.id));
          assert.equal(events.length, 0);
          return;
        }
        const [task] = await db
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.id, ctx.taskId!));
        assert.equal(task.status, "completed");
        assert.equal(task.resultSummary, source);
        const events = await db
          .select()
          .from(activityEventsTable)
          .where(
            and(
              eq(activityEventsTable.taskId, parentTask.id),
              eq(activityEventsTable.type, "progress_update"),
            ),
          );
        assert.equal(events.length, 1);
        assert.equal(events[0].agentId, parent.agent.id);
        assert.equal(events[0].detail?.completedSubtaskId, ctx.taskId);
        assert.equal(
          events[0].summary,
          toolMessage(locale, "teamChildCompletedActivity", {
            name: source,
            title: source,
            summary: source,
          }),
        );
      });
    }
  }
});

test("agent creation and delegation preserve supplied source and use the execution language", async () => {
  const ctx = await context();
  const created = await call(ctx, "create_sub_agent", {
    name: source,
    role: source,
    systemPrompt: source,
  });
  assert.equal(created.toolOutcome, "succeeded");
  assert.equal(created.createdAgents[0].systemPrompt, source);
  assert.equal(created.createdAgents[0].name, source);
  assert.match(created.content, /New sub-agent created/);
  const delegated = await call(ctx, "delegate_task", {
    agentId: created.createdAgents[0].id,
    title: source,
    brief: source,
  });
  assert.equal(delegated.toolOutcome, "succeeded");
  assert.equal(delegated.createdTasks[0].brief, source);
  assert.equal(delegated.createdTasks[0].title, source);
  assert.match(delegated.content, /Task created and delegated/);
});

test("progress and notes preserve supplied whitespace and report localized success", async () => {
  const ctx = await context("en", true);
  const progress = await call(ctx, "update_task_progress", {
    progressPercent: 51,
    note: source,
  });
  assert.equal(progress.toolOutcome, "succeeded");
  const [event] = await db
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.taskId, ctx.taskId!),
        eq(activityEventsTable.type, "progress_update"),
      ),
    );
  assert.equal(event.summary, source);
  assert.match(progress.content, /Progress saved: 51%/);
  const noteCtx = await context();
  const note = await call(noteCtx, "log_note", { summary: source });
  const [saved] = await db
    .select()
    .from(activityEventsTable)
    .where(
      eq(activityEventsTable.id, note.operationResultData!.eventId as number),
    );
  assert.equal(saved.summary, source);
  assert.equal(note.content, "Note saved.");
});

test("company messages retain original content and use localized delivery and denial text", async () => {
  const ctx = await context();
  await db
    .insert(companyChannelsTable)
    .values({ key: "company", name: "Company room" })
    .onConflictDoNothing();
  const [channel] = await db
    .select()
    .from(companyChannelsTable)
    .where(eq(companyChannelsTable.key, "company"));
  await db
    .insert(companyChannelMembersTable)
    .values({ channelId: channel.id, agentId: ctx.agent.id });
  const result = await call(ctx, "post_company_message", { content: source });
  assert.equal(result.toolOutcome, "succeeded");
  const [saved] = await db
    .select()
    .from(companyMessagesTable)
    .where(
      eq(
        companyMessagesTable.id,
        result.operationResultData!.messageId as number,
      ),
    );
  assert.equal(saved.content, source);
  assert.match(result.content, /Company message saved/);
  const denied = await call(ctx, "post_company_message", {
    content: "Another",
  });
  assert.equal(denied.toolOutcome, "rejected");
  assert.match(denied.content, /at least 5 seconds/);
});

test("question and completion lifecycle intents retain source and localize preparation", async () => {
  const questionCtx = await context("en", true);
  const question = await call(questionCtx, "request_user_input", {
    question: source,
  });
  assert.equal(question.toolOutcome, "succeeded");
  assert.equal(question.durableTaskLifecycleIntent?.kind, "user_input");
  assert.equal(
    (question.durableTaskLifecycleIntent as { question: string }).question,
    source,
  );
  assert.equal(question.content, "Question prepared for atomic finalization.");
  const completeCtx = await context("en", true);
  const completed = await call(completeCtx, "complete_task", {
    resultSummary: source,
  });
  assert.equal(completed.toolOutcome, "succeeded");
  assert.equal(completed.durableTaskLifecycleIntent?.kind, "complete");
  assert.equal(
    (completed.durableTaskLifecycleIntent as { resultSummary: string })
      .resultSummary,
    source,
  );
  assert.equal(
    completed.content,
    "Task completion prepared for atomic finalization.",
  );
  assert.ok(
    judgeRequests
      .at(-1)
      ?.messages.some((message) => /English/.test(message.content)),
  );
});

test("completion review receives failed command evidence and the native turn's limited proof in one existing judge call", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale, true);
    const { id } = await evidenceReceipt(ctx);
    const native = await evidenceReceipt(ctx, {
      toolName: "vm_codex_task",
      state: "succeeded",
      failureKind: null,
      resultData: {
        proofScope: "codex_turn",
        deliverableVerified: false,
        nativeItemCount: 1,
        text: "PRIVATE_native_transcript",
      },
    });
    const before = judgeRequests.length;
    await call(ctx, "complete_task", {
      resultSummary: "I ran the checks and everything passed.",
    });
    assert.equal(
      judgeRequests.length,
      before + 1,
      "one existing judge call is sufficient",
    );
    const prompt = judgeRequests
      .at(-1)!
      .messages.map((message) => message.content)
      .join("\n");
    assert.ok(
      prompt.includes(id),
      "the judge never received the persisted receipt",
    );
    assert.match(prompt, /"state"\s*:\s*"failed"/u);
    assert.match(prompt, /"exitCode"\s*:\s*1/u);
    assert.ok(prompt.includes(native.id));
    assert.match(prompt, /"proofScope"\s*:\s*"codex_turn"/u);
    assert.match(prompt, /"deliverableVerified"\s*:\s*false/u);
    assert.doesNotMatch(prompt, /PRIVATE_native_transcript/u);
    const [review] = await db
      .select()
      .from(activityEventsTable)
      .where(
        and(
          eq(activityEventsTable.taskId, ctx.taskId!),
          eq(activityEventsTable.type, "judge_review"),
        ),
      )
      .orderBy(activityEventsTable.id);
    assert.equal(
      (review.detail!.completionEvidence as { receiptTotal: number })
        .receiptTotal,
      2,
    );
    await retireFixtureAgent(ctx.agent.id);
  }
});

test("completion evidence isolates task cycles and approved effects and excludes raw contents", async () => {
  const ctx = await context("en", true);
  const other = await context("en", true);
  const cycleStart = new Date(Date.now() - 1000);
  await db
    .update(tasksTable)
    .set({ cycleCount: 1, lastCycleCompletedAt: cycleStart })
    .where(eq(tasksTable.id, ctx.taskId!));
  // This task's original attempt belongs to the previous cycle.
  const old = await evidenceReceipt(ctx);
  const foreign = await evidenceReceipt(other);
  const [attempt] = await db
    .select()
    .from(taskAttemptsTable)
    .where(eq(taskAttemptsTable.id, ctx.runtimeAttemptId!));
  const currentAttemptId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    ...attempt,
    id: currentAttemptId,
    cycleNumber: 1,
    logicalExecutionId: randomUUID(),
  });
  const latest = await evidenceReceipt(ctx, {
    originAttemptId: currentAttemptId,
    state: "succeeded",
    failureKind: null,
    sanitizedError: "PRIVATE_ERROR_TEXT",
    resultSummary: "PRIVATE_COMMAND_OUTPUT",
    resultData: {
      ok: true,
      exitCode: 0,
      stdout: "PRIVATE_STDOUT",
      command: "PRIVATE_COMMAND",
      apiKey: "PRIVATE_KEY",
      artifactId: "INVALID_PRIVATE_ARTIFACT",
    },
  });
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      agentId: ctx.agent.id,
      taskId: ctx.taskId!,
      category: "other",
      title: "PRIVATE_TITLE",
      description: "PRIVATE_DESCRIPTION",
    })
    .returning();
  const approved = await evidenceReceipt(ctx, {
    executionKind: "approved_action",
    originAttemptId: null,
    approvalId: approval.id,
    reservedAt: new Date(),
    logicalExecutionId: `approval:${approval.id}`,
  });
  const oldApproved = await evidenceReceipt(ctx, {
    executionKind: "approved_action",
    originAttemptId: null,
    approvalId: approval.id,
    reservedAt: new Date(cycleStart.getTime() - 1000),
    logicalExecutionId: `approval:${approval.id}`,
  });
  const snapshot = await taskEvidence(ctx);
  assert.equal(snapshot.cycleNumber, 1);
  assert.equal(snapshot.receiptTotal, 2);
  assert.deepEqual(
    new Set(snapshot.receipts.map((row) => row.id)),
    new Set([latest.id, approved.id]),
  );
  const serialized = JSON.stringify(snapshot);
  for (const excluded of [old.id, foreign.id, oldApproved.id, "PRIVATE_"])
    assert.ok(!serialized.includes(excluded), excluded);
  await retireFixtureAgent(ctx.agent.id);
  await retireFixtureAgent(other.agent.id);
});

test("completion evidence keeps full state counts when receipt and child samples are truncated", async () => {
  const ctx = await context("en", true);
  for (let index = 0; index < 15; index++)
    await evidenceReceipt(ctx, {
      reservedAt: new Date(Date.now() + index),
      state: index < 2 ? "failed" : "succeeded",
      resultData: { ok: index >= 2, exitCode: index < 2 ? 1 : 0 },
    });
  for (let index = 0; index < 11; index++)
    await db.insert(tasksTable).values({
      title: "PRIVATE_CHILD_TITLE",
      brief: "PRIVATE_CHILD_BRIEF",
      resultSummary: "PRIVATE_CHILD_SUMMARY",
      ownerAgentId: ctx.agent.id,
      parentTaskId: ctx.taskId!,
      status: index < 2 ? "failed" : "completed",
    });
  const snapshot = await taskEvidence(ctx);
  assert.equal(snapshot.receiptTotal, 15);
  assert.equal(snapshot.receipts.length, 12);
  assert.equal(snapshot.receiptsTruncated, true);
  assert.equal(
    snapshot.receiptCounts.find((row) => row.state === "failed")!.count,
    2,
  );
  assert.equal(snapshot.childTotal, 11);
  assert.equal(snapshot.children.length, 8);
  assert.equal(snapshot.childrenTruncated, true);
  assert.equal(
    snapshot.childCounts.find((row) => row.status === "failed")!.count,
    2,
  );
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE_"));
  assert.ok(JSON.stringify(snapshot).length < 8000);
  await retireFixtureAgent(ctx.agent.id);
});

test("completion evidence allows answer-only tasks and ignores earlier continuous-cycle children", async () => {
  const ctx = await context("en", true);
  assert.equal((await taskEvidence(ctx)).receiptTotal, 0);
  const [child] = await db
    .insert(tasksTable)
    .values({
      title: "Previous child",
      brief: "Old cycle",
      ownerAgentId: ctx.agent.id,
      parentTaskId: ctx.taskId!,
      status: "completed",
    })
    .returning();
  await db
    .update(tasksTable)
    .set({
      cycleCount: 1,
      lastCycleCompletedAt: new Date(child.createdAt.getTime() + 1),
    })
    .where(eq(tasksTable.id, ctx.taskId!));
  assert.equal((await taskEvidence(ctx)).childTotal, 0);
  await retireFixtureAgent(ctx.agent.id);
});

test("completion evidence rejects invalid typed result fields without turning truncated text into an artifact ID", async () => {
  const ctx = await context("en", true);
  const validPrefix = randomUUID();
  await evidenceReceipt(ctx, {
    resultData: {
      ok: "true",
      exitCode: "0",
      byteCount: -1,
      artifactId: `${validPrefix}PRIVATE_SUFFIX`,
    },
  });
  const snapshot = await taskEvidence(ctx);
  assert.ok(!("ok" in snapshot.receipts[0]));
  assert.ok(!("exitCode" in snapshot.receipts[0]));
  assert.ok(!("byteCount" in snapshot.receipts[0]));
  assert.ok(!("artifactId" in snapshot.receipts[0]));
  await retireFixtureAgent(ctx.agent.id);
});

test("a blocking evidence review retains the task and its review snapshot without preparing completion", async () => {
  const ctx = await context("en", true);
  const receipt = await evidenceReceipt(ctx);
  judgeVerdict = "block";
  try {
    const result = await call(ctx, "complete_task", {
      resultSummary: "All checks passed.",
    });
    assert.equal(result.toolOutcome, "rejected");
    assert.equal(result.durableTaskLifecycleIntent, undefined);
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, ctx.taskId!));
    assert.equal(task.status, "in_progress");
    const [review] = await db
      .select()
      .from(activityEventsTable)
      .where(
        and(
          eq(activityEventsTable.taskId, ctx.taskId!),
          eq(activityEventsTable.type, "judge_review"),
        ),
      );
    assert.equal(review.detail!.verdict, "block");
    assert.equal(
      (review.detail!.completionEvidence as { receipts: { id: string }[] })
        .receipts[0].id,
      receipt.id,
    );
  } finally {
    judgeVerdict = "pass";
    await retireFixtureAgent(ctx.agent.id);
  }
});

test("approval records preserve explicit text and localize authored receipt and judge activity", async () => {
  const ctx = await context();
  const approved = await call(ctx, "request_approval", {
    category: "other",
    title: source,
    description: source,
  });
  assert.equal(approved.toolOutcome, "succeeded");
  const [saved] = await db
    .select()
    .from(approvalRequestsTable)
    .where(
      eq(
        approvalRequestsTable.id,
        approved.operationResultData!.approvalId as number,
      ),
    );
  assert.equal(saved.title, source);
  assert.equal(saved.description, source);
  assert.match(approved.content, /Approval request created/);
  const events = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.agentId, ctx.agent.id));
  assert.ok(
    events.some((event) =>
      event.summary.startsWith("Review (approval request): PASS"),
    ),
  );
});

test("malformed team fields cannot create or mutate domain records", async () => {
  const ctx = await context("en", true);
  const malformed: [string, Record<string, unknown>][] = [
    [
      "create_sub_agent",
      { name: ["bad"], role: "role", systemPrompt: "prompt" },
    ],
    ["create_sub_agent", { name: "bad", role: {}, systemPrompt: "prompt" }],
    ["update_task_progress", { progressPercent: "0" }],
    ["update_task_progress", { progressPercent: 50, note: {} }],
    ["complete_task", { resultSummary: ["bad"] }],
    ["request_user_input", { question: ["bad"] }],
    ["log_note", { summary: { bad: true } }],
    ["post_company_message", { content: ["bad"] }],
    [
      "request_approval",
      { category: "typo", title: "bad", description: "bad" },
    ],
    [
      "request_approval",
      { category: "other", title: ["bad"], description: "bad" },
    ],
    [
      "request_approval",
      {
        category: "other",
        title: "bad",
        description: "bad",
        toolName: "browser_type",
        toolArgs: { ref: "1", text: ["bad"] },
      },
    ],
  ];
  const violations: string[] = [];
  for (const [name, args] of malformed) {
    ctx.operationIdentity!.callSlot = `invalid:${violations.length}:${randomUUID()}`;
    const result = await call(ctx, name, args);
    if (result.toolOutcome !== "rejected")
      violations.push(`${name}:${JSON.stringify(args)}`);
  }
  assert.deepEqual(violations, []);
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, ctx.taskId!));
  assert.equal(task.progressPercent, 47);
  assert.equal(
    (
      await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.agentId, ctx.agent.id))
    ).length,
    0,
  );
  assert.equal(
    (
      await db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.agentId, ctx.agent.id))
    ).length,
    0,
  );
  assert.equal(
    (
      await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.parentAgentId, ctx.agent.id))
    ).length,
    0,
  );
});

test("malformed delegation fields cannot be coerced into an otherwise authorized child assignment", async () => {
  const ctx = await context();
  const created = await call(ctx, "create_sub_agent", {
    name: "Target",
    role: "Test",
    systemPrompt: "Test only",
  });
  const child = created.createdAgents[0];
  const valid = { agentId: child.id, title: "Task", brief: "Bounded test" };
  for (const patch of [
    { agentId: [child.id] },
    { agentId: String(child.id) },
    { title: ["Task"] },
    { brief: {} },
    { priority: "typo" },
    { autonomyMode: "continuous", cadenceSeconds: "60" },
  ]) {
    const result = await call(ctx, "delegate_task", { ...valid, ...patch });
    assert.equal(result.toolOutcome, "rejected");
    assert.equal(result.createdTasks.length, 0);
  }
  assert.equal(
    (
      await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.ownerAgentId, child.id))
    ).length,
    0,
  );
});

test("all seven team languages preserve source and explicit outcomes through real effects and lifecycle preparation", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale, true);
    const copy = getToolCopy(locale);
    const text = toolMessage.bind(null, locale);
    const standalone = { ...ctx, taskId: null, operationIdentity: undefined };
    const creating = call(standalone, "create_sub_agent", {
      name: source,
      role: source,
      systemPrompt: source,
    });
    standalone.locale = locale === "tr" ? "en" : "tr";
    const created = await creating;
    assert.equal(created.toolOutcome, "succeeded", created.content);
    standalone.locale = locale;
    const child = created.createdAgents[0];
    assert.equal(created.content, text("teamAgentCreated", { id: child.id }));
    assert.equal(child.systemPrompt, source);
    assert.equal(child.role, source);
    const delegated = await call(standalone, "delegate_task", {
      agentId: child.id,
      title: source,
      brief: source,
    });
    assert.equal(
      delegated.content,
      text("teamDelegated", { id: delegated.createdTasks[0].id }),
    );
    assert.equal(delegated.createdTasks[0].brief, source);
    const progress = await call(ctx, "update_task_progress", {
      progressPercent: 52,
    });
    assert.equal(progress.content, text("teamProgressSaved", { progress: 52 }));
    const [activity] = await db
      .select()
      .from(activityEventsTable)
      .where(
        and(
          eq(activityEventsTable.taskId, ctx.taskId!),
          eq(activityEventsTable.type, "progress_update"),
        ),
      );
    assert.equal(activity.summary, copy.teamProgressDefault);
    const note = await call(ctx, "log_note", { summary: source });
    assert.equal(note.content, copy.teamNoteSaved);
    assert.equal(note.toolOutcome, "succeeded");
    const question = await call(ctx, "request_user_input", {
      question: source,
    });
    assert.equal(question.content, copy.teamQuestionPrepared);
    assert.equal(
      (question.durableTaskLifecycleIntent as { question: string }).question,
      source,
    );
    const complete = await call(ctx, "complete_task", {
      resultSummary: source,
    });
    assert.equal(complete.content, copy.teamCompletionPrepared);
    assert.equal(
      (complete.durableTaskLifecycleIntent as { resultSummary: string })
        .resultSummary,
      source,
    );
    const approval = await call(standalone, "request_approval", {
      title: source,
      description: source,
      category: "other",
    });
    const approvalId = approval.operationResultData!.approvalId as number;
    const [row] = await db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approvalId));
    assert.equal(row.description, source);
    assert.equal(
      approval.content,
      text("teamApprovalCreated", { id: approvalId, taskId: row.taskId }),
    );
    const [channel] = await db
      .select()
      .from(companyChannelsTable)
      .where(eq(companyChannelsTable.key, "company"));
    await db
      .insert(companyChannelMembersTable)
      .values({ channelId: channel.id, agentId: ctx.agent.id });
    const message = await call(standalone, "post_company_message", {
      content: source,
    });
    assert.equal(
      message.content,
      text("teamMessageSaved", {
        id: message.operationResultData!.messageId as number,
      }),
    );
    const denied = await call(standalone, "post_company_message", {
      content: "next",
    });
    assert.equal(denied.toolOutcome, "rejected");
    assert.equal(
      denied.content,
      text("teamBlocked", { reason: copy.teamMessageCooldown }),
    );
    const bad = await call(ctx, "update_task_progress", {
      progressPercent: "0",
    });
    assert.equal(
      bad.content,
      text("teamNumberInvalid", { field: "progressPercent" }),
    );
    assert.equal(bad.toolOutcome, "rejected");
  }
});

test("transactional replay translates only its new wrapper and preserves the first source and receipt identity", async () => {
  const ctx = await context("tr", true);
  const first = await call(ctx, "log_note", { summary: source });
  ctx.locale = "en";
  const replay = await call(ctx, "log_note", { summary: source.trim() });
  assert.equal(replay.receiptId, first.receiptId);
  assert.equal(replay.toolOutcome, "succeeded");
  assert.match(
    replay.content,
    /Operation was already recorded atomically; it was not applied again/,
  );
  const events = await db
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.agentId, ctx.agent.id),
        eq(activityEventsTable.type, "note"),
      ),
    );
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, source);
});

test("browser approval previews localize headings while retaining literal target and input evidence", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale, true);
    const copy = getToolCopy(locale);
    const url = `http://127.0.0.1:${address.port}/page`;
    try {
      await browser.navigateTo(ctx.agent.id, url);
      const snapshot = await browser.snapshotPage(ctx.agent.id);
      const inputRef = Number(
        snapshot.lines
          .find((line) => line.includes("{title}") && line.includes("[ref="))
          ?.match(/\[ref=(\d+)\]/)?.[1],
      );
      assert.ok(inputRef);
      const downgraded = await call(ctx, "request_approval", {
        title: source,
        description: source,
        category: "other",
        toolName: "browser_type",
        toolArgs: { ref: inputRef, text: source, submit: false },
      });
      assert.equal(downgraded.toolOutcome, "rejected");
      assert.equal(
        downgraded.content,
        toolMessage(locale, "teamCategoryRequired", {
          tool: "browser_type",
          category: "external_contact",
        }),
      );
      await db
        .update(agentsTable)
        .set({
          permissions: { ...ctx.agent.permissions, canContactExternal: true },
        })
        .where(eq(agentsTable.id, ctx.agent.id));
      const result = await call(ctx, "request_approval", {
        title: source,
        description: source,
        category: "external_contact",
        toolName: "browser_type",
        toolArgs: { ref: inputRef, text: source, submit: false },
      });
      assert.equal(result.toolOutcome, "succeeded", result.content);
      const intent = result.durableTaskLifecycleIntent;
      assert.ok(intent?.kind === "approval");
      assert.ok(
        intent.scope?.preview?.includes(
          toolMessage(locale, "previewPage", { url }),
        ),
      );
      assert.ok(
        intent.scope?.preview?.includes(
          toolMessage(locale, "previewText", { text: JSON.stringify(source) }),
        ),
      );
      assert.ok(
        intent.scope?.preview?.includes(
          toolMessage(locale, "previewSubmit", { value: copy.previewNo }),
        ),
      );
      assert.equal(intent.actionPayload?.args.text, source);
      const replay = await call(ctx, "request_approval", {
        title: source,
        description: source,
        category: "external_contact",
        toolName: "browser_type",
        toolArgs: { ref: inputRef, text: source, submit: true },
      });
      assert.equal(replay.toolOutcome, "rejected");
      assert.equal(replay.content, copy.browserSeparateSubmit);
      const after = await browser.snapshotPage(ctx.agent.id);
      assert.deepEqual(after.lines, snapshot.lines);
    } finally {
      await browser.closeSession(ctx.agent.id);
    }
  }
});

test("a consumed execution allowance prevents starting completion and approval reviews", async () => {
  const ctx = await context("en", true);
  await db.insert(usageEventsTable).values({
    agentId: ctx.agent.id,
    taskId: ctx.taskId!,
    kind: "task_step",
    modelId: "test",
    provider: "test",
    totalTokens: 100000,
  });
  const before = judgeRequests.length;
  for (const purpose of ["completion", "approval"] as const) {
    await assert.rejects(
      runJudge({
        agent: ctx.agent,
        taskId: ctx.taskId!,
        locale: "en",
        purpose,
        originalBrief: "Test",
        actionSummary: "Done",
        beforeAttempt: async () => {},
      }),
      TaskSpendBudgetError,
    );
  }
  assert.equal(judgeRequests.length, before);
});

test("judge fallback retains blocking policy in every selected language", async () => {
  const ctx = await context();
  judgeVerdict = "unsupported";
  try {
    for (const locale of WORKSPACE_LOCALES) {
      for (const purpose of ["completion", "approval"] as const) {
        const result = await runJudge({
          agent: ctx.agent,
          taskId: null,
          locale,
          purpose,
          originalBrief: source,
          actionSummary: source,
        });
        const copy = getToolCopy(locale);
        assert.ok(result.providerFailure instanceof ModelRoutesExhaustedError);
        assert.equal(
          result.verdict,
          purpose === "completion" ? "block" : "warn",
        );
        assert.equal(
          result.reasoning,
          purpose === "completion"
            ? copy.judgeCompletionUnavailable
            : copy.judgeApprovalUnavailable,
        );
      }
    }
  } finally {
    judgeVerdict = "pass";
  }
});

test("capacity and permission denials stay localized and cause no child mutation", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale);
    const copy = getToolCopy(locale);
    const args = { name: source, role: source, systemPrompt: source };
    const prior = process.env.MAX_ACTIVE_AGENTS;
    try {
      process.env.MAX_ACTIVE_AGENTS = "1";
      const capacity = await call(ctx, "create_sub_agent", args);
      assert.equal(capacity.toolOutcome, "rejected");
      assert.equal(
        capacity.content,
        toolMessage(locale, "teamAgentCapacity", { limit: 1 }),
      );
    } finally {
      if (prior === undefined) delete process.env.MAX_ACTIVE_AGENTS;
      else process.env.MAX_ACTIVE_AGENTS = prior;
    }
    await db
      .update(agentsTable)
      .set({
        permissions: {
          ...ctx.agent.permissions,
          canCreateSubAgents: false,
          canDelegate: false,
        },
      })
      .where(eq(agentsTable.id, ctx.agent.id));
    const denied = await call(ctx, "create_sub_agent", args);
    assert.equal(denied.toolOutcome, "rejected");
    assert.equal(denied.content, copy.teamCreateDenied);
    const delegated = await call(ctx, "delegate_task", {
      agentId: 1,
      title: source,
      brief: source,
    });
    assert.equal(delegated.content, copy.teamDelegateDenied);
    assert.equal(delegated.toolOutcome, "rejected");
    assert.equal(
      (
        await db
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.parentAgentId, ctx.agent.id))
      ).length,
      0,
    );
  }
});

test("translated sudo previews cannot change capability or request identity and never execute the proposal", async () => {
  const ctx = await context("tr", true);
  await db
    .update(agentsTable)
    .set({
      isRootCeo: true,
      templateKey: "ceo",
      depth: 0,
      permissions: { ...ctx.agent.permissions, canUseSudo: true },
    })
    .where(eq(agentsTable.id, ctx.agent.id));
  const previousGate = process.env.ALLOW_AGENT_SUDO;
  process.env.ALLOW_AGENT_SUDO = "true";
  const command = `node -e "require('node:fs').writeFileSync('must-not-run.txt','bad')"`;
  try {
    for (const locale of WORKSPACE_LOCALES) {
      const [message] = await db
        .insert(messagesTable)
        .values({
          agentId: ctx.agent.id,
          role: "user",
          content: "Local approval fixture",
        })
        .returning();
      const chat: ToolRuntimeContext = {
        ...ctx,
        locale,
        taskId: null,
        operationIdentity: {
          ...ctx.operationIdentity!,
          executionKind: "chat_turn",
          logicalExecutionId: `chat:${message.id}`,
          sourceMessageId: message.id,
          originAttemptId: null,
        },
      };
      const before = judgeRequests.length;
      const args = { toolName: "vm_run_sudo_command", toolArgs: { command } };
      const first = await call(chat, "request_approval", args);
      assert.equal(first.toolOutcome, "succeeded", first.content);
      const id = first.operationResultData!.approvalId as number;
      const [saved] = await db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, id));
      const copy = getToolCopy(locale);
      const target = await getAgentSudoTarget(ctx.agent.id);
      assert.equal(saved.title, copy.teamSudoTitle);
      assert.equal(saved.description, copy.teamSudoDescription);
      assert.ok(saved.scope?.preview?.startsWith(copy.teamSudoTitle));
      assert.ok(
        saved.scope?.preview?.includes(
          toolMessage(locale, "previewDirectory", { path: target.cwd }),
        ),
      );
      assert.ok(saved.scope?.preview?.includes(`\n${command}\n`));
      assert.equal(saved.scope?.argsHash, canonicalArgumentHash({ command }));
      assert.equal(saved.status, "pending");
      assert.equal(saved.consumedAt, null);
      chat.locale = locale === "tr" ? "en" : "tr";
      const replay = await call(chat, "request_approval", args);
      assert.equal(replay.receiptId, first.receiptId);
      assert.equal(replay.operationResultData!.approvalId, id);
      assert.equal(
        replay.content,
        toolMessage(chat.locale, "teamApprovalReplayed", { id }),
      );
      assert.equal(judgeRequests.length - before, 1);
      const [unchanged] = await db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, id));
      assert.equal(unchanged.title, saved.title);
      assert.deepEqual(unchanged.scope, saved.scope);
      await assert.rejects(
        fsp.stat(path.join(target.cwd, "must-not-run.txt")),
        { code: "ENOENT" },
      );
    }
  } finally {
    if (previousGate === undefined) delete process.env.ALLOW_AGENT_SUDO;
    else process.env.ALLOW_AGENT_SUDO = previousGate;
  }
});

test("review: padded browser approval identifiers cannot bypass nested validation or create effects", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale, true);
    await db
      .update(agentsTable)
      .set({
        permissions: { ...ctx.agent.permissions, canContactExternal: true },
      })
      .where(eq(agentsTable.id, ctx.agent.id));
    try {
      await browser.navigateTo(
        ctx.agent.id,
        `http://127.0.0.1:${address.port}/page`,
      );
      const snapshot = await browser.snapshotPage(ctx.agent.id);
      const ref = Number(
        snapshot.lines
          .find((line) => line.includes("{title}") && line.includes("[ref="))
          ?.match(/\[ref=(\d+)\]/)?.[1],
      );
      assert.ok(ref);
      const beforeJudge = judgeRequests.length;
      const [beforeTask] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, ctx.taskId!));
      for (const [toolName, toolArgs] of [
        [" browser_type ", { ref: [ref], text: ["coerced"], submit: "false" }],
        ["\tbrowser_click", { ref: [ref] }],
        ["browser_type\n", { ref, text: ["coerced"], submit: false }],
        [" browser_type", { ref, text: "source", submit: "true" }],
      ] as const) {
        const result = await call(ctx, "request_approval", {
          title: source,
          description: source,
          category: "external_contact",
          toolName,
          toolArgs,
        });
        assert.equal(result.toolOutcome, "rejected", result.content);
        assert.equal(result.durableTaskLifecycleIntent, undefined);
      }
      assert.equal(judgeRequests.length, beforeJudge);
      const approvals = await db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.agentId, ctx.agent.id));
      assert.equal(approvals.length, 0);
      const [afterTask] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, ctx.taskId!));
      assert.deepEqual(afterTask, beforeTask);
      assert.deepEqual(
        (await browser.snapshotPage(ctx.agent.id)).lines,
        snapshot.lines,
      );
    } finally {
      await browser.closeSession(ctx.agent.id);
      await retireFixtureAgent(ctx.agent.id);
    }
  }
});
