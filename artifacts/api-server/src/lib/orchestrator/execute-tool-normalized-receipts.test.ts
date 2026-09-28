import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test, { after, type TestContext } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  db,
  dbReady,
  operationInvocationsTable,
  operationReceiptsTable,
  approvalRequestsTable,
  messagesTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import { deleteEntry, writeTextFile } from "../vm/sandbox";
import { executeTool, type ToolRuntimeContext } from "./execute-tool";
import { toolMessage } from "./tool-localization";
import { WORKSPACE_LOCALES } from "../workspace-locale";
import {
  claimOperationInvocation,
  markOperationRunning,
  markOperationUnknown,
  reconcileOperation,
  reserveOperation,
} from "./operation-receipts";

let normalizedJudgeServer: http.Server | null = null;
let normalizedJudgeCalls = 0;
let normalizedJudgeVerdict: "pass" | "block" = "pass";
let previousJudgeKey: string | undefined;
let previousJudgeUrl: string | undefined;

after(async () => {
  if (normalizedJudgeServer) {
    normalizedJudgeServer.closeAllConnections();
    await new Promise<void>((resolve) =>
      normalizedJudgeServer!.close(() => resolve()),
    );
    normalizedJudgeServer = null;
  }
  if (previousJudgeKey === undefined)
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = previousJudgeKey;
  if (previousJudgeUrl === undefined)
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = previousJudgeUrl;
});

async function startPassingJudge(
  _t: TestContext,
  verdict: "pass" | "block" = "pass",
) {
  normalizedJudgeVerdict = verdict;
  const baselineCalls = normalizedJudgeCalls;
  if (normalizedJudgeServer) {
    return { calls: () => normalizedJudgeCalls - baselineCalls };
  }
  previousJudgeKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  previousJudgeUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  normalizedJudgeServer = http.createServer(async (request, response) => {
    for await (const _chunk of request) {
      // Drain the request before replying.
    }
    normalizedJudgeCalls += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: randomUUID(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1_000),
        model: "normalized-test-judge",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                verdict: normalizedJudgeVerdict,
                reasoning: "bounded verdict",
              }),
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    normalizedJudgeServer!.once("error", reject);
    normalizedJudgeServer!.listen(0, "127.0.0.1", resolve);
  });
  const address = normalizedJudgeServer.address();
  assert.ok(address && typeof address !== "string");
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "normalized-test-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  return { calls: () => normalizedJudgeCalls - baselineCalls };
}

async function createFixture(callSlot: string) {
  await dbReady;
  const suffix = randomUUID();
  const now = new Date();
  const leaseOwner = `normalized-receipt-${suffix}`;
  const runtimeInstanceId = `normalized-runtime-${suffix}`;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Normalized ${suffix}`,
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(now.getTime() + 180_000),
      permissions: {
        canCreateSubAgents: true,
        canDelegate: true,
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
      title: `Normalized ${suffix}`,
      brief: "Exercise the production normalized receipt boundary.",
      ownerAgentId: agent.id,
      createdByUser: true,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + 180_000),
      stepAttempts: 1,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, agent.id));
  await db.insert(runtimeInstancesTable).values({
    id: runtimeInstanceId,
    role: "worker",
    state: "healthy",
    hostname: "normalized-receipt-test",
    processId: 3811,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: now,
  });
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
  const context: ToolRuntimeContext = {
    agent,
    taskId: task.id,
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
      callSlot,
      agentLeaseOwner: leaseOwner,
    },
  };
  return { agent, task, context };
}

test("executeTool commits a transactional mutation with its receipt and safely replays it", async () => {
  const fixture = await createFixture("round:0:tool:0");
  const sentinel = `one-note-${randomUUID()}`;
  const first = await executeTool(
    fixture.context,
    "log_note",
    JSON.stringify({ summary: `  ${sentinel}  ` }),
  );
  const replay = await executeTool(
    fixture.context,
    "log_note",
    JSON.stringify({ summary: sentinel }),
  );

  assert.equal(first.toolOutcome, "succeeded");
  assert.equal(replay.toolOutcome, "succeeded");
  assert.equal(replay.receiptId, first.receiptId);
  assert.match(replay.content, /tekrar uygulanmadı/iu);

  const [events, [receipt], invocations] = await Promise.all([
    db
      .select()
      .from(activityEventsTable)
      .where(
        and(
          eq(activityEventsTable.agentId, fixture.agent.id),
          eq(activityEventsTable.type, "note"),
        ),
      ),
    db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, first.receiptId!)),
    db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.receiptId, first.receiptId!)),
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.summary, `  ${sentinel}  `);
  assert.equal(receipt.state, "succeeded");
  assert.deepEqual(receipt.resultData, {
    eventId: events[0]!.id,
    executionLocale: "tr",
  });
  assert.equal(JSON.stringify(receipt).includes(sentinel), false);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0]!.state, "succeeded");
});

test("transactional retry uses the first language after an operator preference change", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const fixture = await createFixture(`locale-retry-${locale}`);
    const args = JSON.stringify({
      name: "  Literal {id}\n专家  ",
      role: "Test",
      systemPrompt: "Test only",
    });
    const deniedAgent = {
      ...fixture.agent,
      permissions: { ...fixture.agent.permissions, canCreateSubAgents: false },
    };
    await db
      .update(agentsTable)
      .set({ permissions: deniedAgent.permissions })
      .where(eq(agentsTable.id, fixture.agent.id));
    const denied = await executeTool(
      { ...fixture.context, agent: deniedAgent, locale },
      "create_sub_agent",
      args,
    );
    assert.equal(denied.toolOutcome, "rejected");
    assert.ok(denied.receiptId);
    const [reserved] = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, denied.receiptId));
    assert.deepEqual(reserved.resultData, { executionLocale: locale });

    await db
      .update(agentsTable)
      .set({ permissions: fixture.agent.permissions })
      .where(eq(agentsTable.id, fixture.agent.id));
    const changedLocale = locale === "en" ? "ar" : "en";
    const retried = await executeTool(
      { ...fixture.context, locale: changedLocale },
      "create_sub_agent",
      args,
    );
    assert.equal(retried.toolOutcome, "succeeded");
    assert.equal(retried.receiptId, denied.receiptId);
    assert.equal(retried.createdAgents.length, 1);
    assert.equal(retried.createdAgents[0].name, "  Literal {id}\n专家  ");
    assert.equal(
      retried.content,
      toolMessage(locale, "teamAgentCreated", {
        id: retried.createdAgents[0].id,
      }),
    );
    const [completed] = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, denied.receiptId));
    assert.equal(completed.resultData?.executionLocale, locale);
    assert.equal(completed.argumentHash, reserved.argumentHash);
    const replay = await executeTool(
      { ...fixture.context, locale: changedLocale },
      "create_sub_agent",
      args,
    );
    assert.equal(replay.createdAgents[0].id, retried.createdAgents[0].id);
    assert.equal(
      replay.content,
      toolMessage(changedLocale, "teamAgentReplayed", {
        id: retried.createdAgents[0].id,
      }),
    );
  }
});

test("transactional receipt mutation does not invoke an out-of-transaction task heartbeat while holding row locks", async () => {
  const fixture = await createFixture("round:0:tool:heartbeat-fence");
  let heartbeatCalls = 0;
  const context: ToolRuntimeContext = {
    ...fixture.context,
    assertTaskLease: async () => {
      heartbeatCalls += 1;
      if (heartbeatCalls > 1) {
        throw new Error(
          "out-of-transaction heartbeat entered the locked mutation",
        );
      }
    },
  };

  const result = await executeTool(
    context,
    "log_note",
    JSON.stringify({ summary: `single-fence-${randomUUID()}` }),
  );

  assert.equal(result.toolOutcome, "succeeded");
  assert.equal(heartbeatCalls, 1);
});

test("agent creation and progress replay without duplicate domain rows", async () => {
  const agentFixture = await createFixture("round:0:tool:agent");
  const childName = `Receipt child ${randomUUID()}`;
  const childArgs = JSON.stringify({
    name: `  ${childName} `,
    role: " Research ",
    systemPrompt: " Return bounded research evidence. ",
  });
  const created = await executeTool(
    agentFixture.context,
    "create_sub_agent",
    childArgs,
  );
  const replayed = await executeTool(
    agentFixture.context,
    "create_sub_agent",
    JSON.stringify({
      name: childName,
      role: "Research",
      systemPrompt: "Return bounded research evidence.",
    }),
  );
  assert.equal(created.createdAgents.length, 1);
  assert.equal(replayed.createdAgents.length, 1);
  assert.equal(replayed.createdAgents[0]!.id, created.createdAgents[0]!.id);
  const children = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.parentAgentId, agentFixture.agent.id)));
  assert.equal(children.length, 1);
  assert.equal(children[0]!.name, `  ${childName} `);

  const progressFixture = await createFixture("round:0:tool:progress");
  const note = `progress-once-${randomUUID()}`;
  const progressArgs = JSON.stringify({
    progressPercent: 37.2,
    note: ` ${note} `,
  });
  const firstProgress = await executeTool(
    progressFixture.context,
    "update_task_progress",
    progressArgs,
  );
  const replayedProgress = await executeTool(
    progressFixture.context,
    "update_task_progress",
    JSON.stringify({ progressPercent: 37, note }),
  );
  assert.equal(firstProgress.receiptId, replayedProgress.receiptId);
  const progressEvents = await db
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.taskId, progressFixture.task.id),
        eq(activityEventsTable.type, "progress_update"),
      ),
    );
  assert.equal(progressEvents.length, 1);
  assert.equal(progressEvents[0]!.summary, ` ${note} `);
  const [updatedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, progressFixture.task.id));
  assert.equal(updatedTask.progressPercent, 37);
});

test("a permission-rejected transactional handler remains rejected and retryable", async () => {
  const fixture = await createFixture("round:0:tool:invalid");
  await db
    .update(agentsTable)
    .set({
      permissions: { ...fixture.agent.permissions, canCreateSubAgents: false },
    })
    .where(eq(agentsTable.id, fixture.agent.id));
  const invalidArgs = JSON.stringify({
    name: "Permission-bound child",
    role: "Test",
    systemPrompt: "Test only",
  });
  const first = await executeTool(
    fixture.context,
    "create_sub_agent",
    invalidArgs,
  );
  const retry = await executeTool(
    fixture.context,
    "create_sub_agent",
    invalidArgs,
  );
  assert.equal(first.toolOutcome, "rejected");
  assert.equal(retry.toolOutcome, "rejected");
  assert.equal(retry.receiptId, first.receiptId);

  const [[receipt], invocations] = await Promise.all([
    db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, first.receiptId!)),
    db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.receiptId, first.receiptId!)),
  ]);
  assert.equal(receipt.state, "reserved");
  assert.deepEqual(receipt.resultData, { executionLocale: "tr" });
  assert.equal(invocations.length, 2);
  assert.equal(
    invocations.every((invocation) => invocation.state === "failed"),
    true,
  );
  await db
    .update(agentsTable)
    .set({ permissions: fixture.agent.permissions })
    .where(eq(agentsTable.id, fixture.agent.id));
  const authorized = await executeTool(
    fixture.context,
    "create_sub_agent",
    invalidArgs,
  );
  assert.equal(authorized.toolOutcome, "succeeded");
  assert.equal(authorized.receiptId, first.receiptId);
  assert.equal(authorized.createdAgents.length, 1);
});

test("taskless approval persists atomically and replay skips the judge", async (t) => {
  const judge = await startPassingJudge(t);
  const fixture = await createFixture("round:0:tool:approval");
  const title = `Bounded approval ${randomUUID()}`;
  const description = "Review one bounded internal decision.";
  const [sourceMessage] = await db
    .insert(messagesTable)
    .values({
      agentId: fixture.agent.id,
      role: "user",
      content: "Create one bounded approval request.",
    })
    .returning({ id: messagesTable.id });
  const context: ToolRuntimeContext = {
    agent: fixture.agent,
    taskId: null,
    operationIdentity: {
      executionKind: "chat_turn",
      logicalExecutionId: `chat:${sourceMessage.id}`,
      runtimeInstanceId: null,
      originAttemptId: null,
      sourceMessageId: sourceMessage.id,
      modelToolCallId: `approval-call-${randomUUID()}`,
      callSlot: "round:0:tool:approval",
      agentLeaseOwner: fixture.context.operationIdentity!.agentLeaseOwner,
    },
  };
  const first = await executeTool(
    context,
    "request_approval",
    JSON.stringify({
      category: "other",
      title: ` ${title} `,
      description: ` ${description} `,
    }),
  );
  const replay = await executeTool(
    context,
    "request_approval",
    JSON.stringify({
      category: "other",
      title,
      description,
    }),
  );
  assert.equal(first.toolOutcome, "succeeded");
  assert.equal(replay.toolOutcome, "succeeded");
  assert.equal(first.receiptId, replay.receiptId);
  assert.equal(judge.calls(), 1);

  const [approvals, [receipt], invocations] = await Promise.all([
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.agentId, fixture.agent.id)),
    db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, first.receiptId!)),
    db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.receiptId, first.receiptId!)),
  ]);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0]!.title, ` ${title} `);
  assert.equal(approvals[0]!.description, ` ${description} `);
  assert.equal(receipt.state, "succeeded");
  assert.deepEqual(receipt.resultData, {
    approvalId: approvals[0]!.id,
    executionLocale: "tr",
  });
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0]!.state, "succeeded");
  assert.equal(replay.createdTasks.length, 1);
  assert.equal(replay.createdTasks[0]!.id, approvals[0]!.taskId);
});

test("taskless approval retry keeps the reserved language while replay uses the current display language", async (t) => {
  await startPassingJudge(t);
  const source = "  Original {id}\n  原文 العربية  ";
  for (const locale of WORKSPACE_LOCALES) {
    const fixture = await createFixture(`approval-language-${locale}`);
    const [message] = await db
      .insert(messagesTable)
      .values({
        agentId: fixture.agent.id,
        role: "user",
        content: "Review an internal decision",
      })
      .returning();
    const identity = {
      ...fixture.context.operationIdentity!,
      executionKind: "chat_turn" as const,
      logicalExecutionId: `chat:${message.id}`,
      sourceMessageId: message.id,
      originAttemptId: null,
      runtimeInstanceId: null,
    };
    const context: ToolRuntimeContext = {
      agent: fixture.agent,
      taskId: null,
      locale: locale === "en" ? "ar" : "en",
      operationIdentity: identity,
    };
    const reserved = await reserveOperation({
      canonicalVersion: 1,
      executionKind: "chat_turn",
      logicalExecutionId: identity.logicalExecutionId,
      toolName: "request_approval",
      args: {
        category: "other",
        title: source.trim(),
        description: source.trim(),
        amountUsd: null,
        toolName: null,
        actionArgsHash: null,
        target: null,
      },
      executionLocale: locale,
      physical: {
        attemptId: null,
        workerInstanceId: null,
        modelToolCallId: identity.modelToolCallId,
        callSlot: identity.callSlot,
      },
      taskId: null,
      agentId: fixture.agent.id,
      approvalId: null,
      sourceMessageId: message.id,
      originAttemptId: null,
      sideEffectClass: "transactional",
    });
    const args = JSON.stringify({
      category: "other",
      title: source,
      description: source,
    });
    const result = await executeTool(context, "request_approval", args);
    assert.equal(result.toolOutcome, "succeeded");
    assert.equal(result.receiptId, reserved.receipt.id);
    const [approval] = await db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.agentId, fixture.agent.id));
    assert.equal(approval.title, source);
    assert.equal(approval.description, source);
    assert.equal(
      result.content,
      toolMessage(locale, "teamApprovalCreated", {
        id: approval.id,
        taskId: approval.taskId,
      }),
    );
    const calls = normalizedJudgeCalls;
    const replay = await executeTool(context, "request_approval", args);
    assert.equal(normalizedJudgeCalls, calls);
    assert.equal(
      replay.content,
      toolMessage(context.locale!, "teamApprovalReplayed", { id: approval.id }),
    );
    const [completed] = await db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, reserved.receipt.id));
    assert.equal(completed.argumentHash, reserved.receipt.argumentHash);
    assert.equal(completed.resultData?.executionLocale, locale);
    assert.equal(
      (
        await db
          .select()
          .from(approvalRequestsTable)
          .where(eq(approvalRequestsTable.agentId, fixture.agent.id))
      ).length,
      1,
    );
  }
});

test("judge-blocked lifecycle tools are rejected and leave their receipts retryable", async (t) => {
  const judge = await startPassingJudge(t, "block");
  const completeFixture = await createFixture("round:0:tool:blocked-complete");
  const approvalFixture = await createFixture("round:0:tool:blocked-approval");

  const completion = await executeTool(
    completeFixture.context,
    "complete_task",
    JSON.stringify({ resultSummary: "Not enough bounded evidence." }),
  );
  const approval = await executeTool(
    approvalFixture.context,
    "request_approval",
    JSON.stringify({
      category: "other",
      title: "Blocked approval",
      description: "The judge must reject this request.",
    }),
  );

  assert.equal(completion.toolOutcome, "rejected");
  assert.equal(approval.toolOutcome, "rejected");
  assert.equal(judge.calls(), 2);
  const receipts = await db
    .select()
    .from(operationReceiptsTable)
    .where(
      and(
        eq(operationReceiptsTable.state, "reserved"),
        eq(operationReceiptsTable.agentId, completeFixture.agent.id),
      ),
    );
  const approvalReceipts = await db
    .select()
    .from(operationReceiptsTable)
    .where(
      and(
        eq(operationReceiptsTable.state, "reserved"),
        eq(operationReceiptsTable.agentId, approvalFixture.agent.id),
      ),
    );
  assert.equal(receipts.length, 1);
  assert.equal(approvalReceipts.length, 1);
});

test("confirmed-applied reconciliation replays without executing the normalized mutation", async () => {
  const fixture = await createFixture("round:0:tool:reconciled");
  const summary = `must-not-be-inserted-${randomUUID()}`;
  const [sourceMessage] = await db
    .insert(messagesTable)
    .values({
      agentId: fixture.agent.id,
      role: "user",
      content: "Reconcile one synthetic operation.",
    })
    .returning({ id: messagesTable.id });
  const logicalExecutionId = `chat:${sourceMessage.id}`;
  const modelToolCallId = `reconciled-call-${randomUUID()}`;
  const callSlot = "round:0:tool:reconciled";
  const reservation = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "chat_turn",
    logicalExecutionId,
    toolName: "log_note",
    args: { summary },
    physical: {
      attemptId: null,
      workerInstanceId: null,
      modelToolCallId,
      callSlot,
    },
    taskId: null,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: sourceMessage.id,
    originAttemptId: null,
    sideEffectClass: "transactional",
  });
  const invocationLeaseOwner = `reconciled-invocation-${randomUUID()}`;
  const claimed = await claimOperationInvocation({
    receiptId: reservation.receipt.id,
    executionKind: "chat_turn",
    attemptId: null,
    workerInstanceId: null,
    modelToolCallId,
    leaseOwner: invocationLeaseOwner,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    taskLeaseOwner: null,
    agentLeaseOwner: fixture.context.operationIdentity!.agentLeaseOwner,
  });
  assert.ok(claimed.invocation);
  await markOperationRunning({
    receiptId: reservation.receipt.id,
    invocationId: claimed.invocation.id,
    leaseOwner: invocationLeaseOwner,
  });
  await markOperationUnknown({
    receiptId: reservation.receipt.id,
    invocationId: claimed.invocation.id,
    leaseOwner: invocationLeaseOwner,
    failureKind: "synthetic_unknown",
    sanitizedError: "Synthetic response loss.",
  });
  await reconcileOperation({
    receiptId: reservation.receipt.id,
    decision: "confirmed_applied",
    note: "The bounded synthetic effect was independently confirmed.",
    actorId: "normalized-test-operator",
  });

  const context: ToolRuntimeContext = {
    agent: fixture.agent,
    taskId: null,
    operationIdentity: {
      executionKind: "chat_turn",
      logicalExecutionId,
      runtimeInstanceId: null,
      originAttemptId: null,
      sourceMessageId: sourceMessage.id,
      modelToolCallId,
      callSlot,
      agentLeaseOwner: fixture.context.operationIdentity!.agentLeaseOwner,
    },
  };
  const replay = await executeTool(
    context,
    "log_note",
    JSON.stringify({ summary }),
  );
  assert.equal(replay.toolOutcome, "succeeded");
  assert.equal(replay.receiptId, reservation.receipt.id);
  const inserted = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.summary, summary));
  assert.equal(inserted.length, 0);
});

test("a confirmed-applied read-only receipt replays as deferred without claiming a fresh observation", async () => {
  const fixture = await createFixture("round:0:tool:reconciled-read");
  const [sourceMessage] = await db
    .insert(messagesTable)
    .values({
      agentId: fixture.agent.id,
      role: "user",
      content: "Observe one synthetic file.",
    })
    .returning({ id: messagesTable.id });
  const logicalExecutionId = `chat:${sourceMessage.id}`;
  const modelToolCallId = `reconciled-read-${randomUUID()}`;
  const callSlot = "round:0:tool:reconciled-read";
  const args = { path: `missing-${randomUUID()}.txt` };
  const reservation = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "chat_turn",
    logicalExecutionId,
    toolName: "vm_read_file",
    args,
    physical: {
      attemptId: null,
      workerInstanceId: null,
      modelToolCallId,
      callSlot,
    },
    taskId: null,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: sourceMessage.id,
    originAttemptId: null,
    sideEffectClass: "read_only",
  });
  const invocationLeaseOwner = `reconciled-read-${randomUUID()}`;
  const claimed = await claimOperationInvocation({
    receiptId: reservation.receipt.id,
    executionKind: "chat_turn",
    attemptId: null,
    workerInstanceId: null,
    modelToolCallId,
    leaseOwner: invocationLeaseOwner,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    taskLeaseOwner: null,
    agentLeaseOwner: fixture.context.operationIdentity!.agentLeaseOwner,
  });
  assert.ok(claimed.invocation);
  await markOperationRunning({
    receiptId: reservation.receipt.id,
    invocationId: claimed.invocation.id,
    leaseOwner: invocationLeaseOwner,
  });
  await markOperationUnknown({
    receiptId: reservation.receipt.id,
    invocationId: claimed.invocation.id,
    leaseOwner: invocationLeaseOwner,
    failureKind: "synthetic_read_unknown",
    sanitizedError: "Synthetic read response loss.",
  });
  await reconcileOperation({
    receiptId: reservation.receipt.id,
    decision: "confirmed_applied",
    note: "The observation was independently confirmed but its raw value is absent.",
    actorId: "normalized-test-operator",
  });

  const replay = await executeTool(
    {
      agent: fixture.agent,
      taskId: null,
      operationIdentity: {
        executionKind: "chat_turn",
        logicalExecutionId,
        runtimeInstanceId: null,
        originAttemptId: null,
        sourceMessageId: sourceMessage.id,
        modelToolCallId,
        callSlot,
        agentLeaseOwner: fixture.context.operationIdentity!.agentLeaseOwner,
      },
    },
    "vm_read_file",
    JSON.stringify(args),
  );
  assert.equal(replay.toolOutcome, "deferred");
  assert.equal(replay.receiptId, reservation.receipt.id);
  const invocations = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.receiptId, reservation.receipt.id));
  assert.equal(invocations.length, 1);
});

test("confirmed read-only evidence does not suppress a fresh call slot in the same task cycle", async () => {
  const fixture = await createFixture("round:0:tool:read-cycle-a");
  const args = { path: `cycle-read-${randomUUID()}.txt` };
  const first = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId: fixture.context.operationIdentity!.logicalExecutionId,
    toolName: "vm_read_file",
    args,
    physical: {
      attemptId: fixture.context.runtimeAttemptId,
      workerInstanceId: fixture.context.operationIdentity!.runtimeInstanceId,
      modelToolCallId: fixture.context.operationIdentity!.modelToolCallId,
      callSlot: fixture.context.operationIdentity!.callSlot,
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: fixture.context.runtimeAttemptId!,
    sideEffectClass: "read_only",
  });
  const firstLeaseOwner = `read-cycle-first-${randomUUID()}`;
  const firstClaim = await claimOperationInvocation({
    receiptId: first.receipt.id,
    executionKind: "task_step",
    attemptId: fixture.context.runtimeAttemptId!,
    workerInstanceId: fixture.context.operationIdentity!.runtimeInstanceId,
    modelToolCallId: fixture.context.operationIdentity!.modelToolCallId,
    leaseOwner: firstLeaseOwner,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    taskLeaseOwner: fixture.context.taskLeaseOwner!,
    agentLeaseOwner: fixture.context.operationIdentity!.agentLeaseOwner,
  });
  assert.ok(firstClaim.invocation);
  await markOperationRunning({
    receiptId: first.receipt.id,
    invocationId: firstClaim.invocation.id,
    leaseOwner: firstLeaseOwner,
  });
  await markOperationUnknown({
    receiptId: first.receipt.id,
    invocationId: firstClaim.invocation.id,
    leaseOwner: firstLeaseOwner,
    failureKind: "synthetic_read_unknown",
    sanitizedError: "Synthetic task read response loss.",
  });
  await reconcileOperation({
    receiptId: first.receipt.id,
    decision: "confirmed_applied",
    note: "The prior observation happened, but no raw value is reusable.",
    actorId: "normalized-test-operator",
  });

  const nextLeaseOwner = `read-cycle-next-${randomUUID()}`;
  const nextAttemptId = randomUUID();
  const nextLogicalExecutionId = randomUUID();
  const nextExpiry = new Date(Date.now() + 120_000);
  await db
    .update(tasksTable)
    .set({
      status: "in_progress",
      blockedReason: null,
      leaseOwner: nextLeaseOwner,
      leaseExpiresAt: nextExpiry,
    })
    .where(eq(tasksTable.id, fixture.task.id));
  await db
    .update(agentsTable)
    .set({
      status: "working",
      currentTaskId: fixture.task.id,
      runLeaseOwner: nextLeaseOwner,
      runLeaseExpiresAt: nextExpiry,
    })
    .where(eq(agentsTable.id, fixture.agent.id));
  await db.insert(taskAttemptsTable).values({
    id: nextAttemptId,
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    workerInstanceId: fixture.context.operationIdentity!.runtimeInstanceId!,
    leaseOwner: nextLeaseOwner,
    attemptNumber: 2,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId: nextLogicalExecutionId,
  });

  const fresh = await reserveOperation({
    canonicalVersion: 1,
    executionKind: "task_step",
    logicalExecutionId: nextLogicalExecutionId,
    toolName: "vm_read_file",
    args,
    physical: {
      attemptId: nextAttemptId,
      workerInstanceId: fixture.context.operationIdentity!.runtimeInstanceId,
      modelToolCallId: `fresh-read-${randomUUID()}`,
      callSlot: "round:1:tool:read-cycle-b",
    },
    taskId: fixture.task.id,
    agentId: fixture.agent.id,
    approvalId: null,
    sourceMessageId: null,
    originAttemptId: nextAttemptId,
    sideEffectClass: "read_only",
  });
  assert.equal(fresh.execute, true);
  assert.notEqual(fresh.receipt.id, first.receipt.id);
});

test("read-only execution records physical evidence without persisting raw content and can retry safely", async (t) => {
  const fixture = await createFixture("round:0:tool:1");
  const relPath = `receipt-test-${randomUUID()}.txt`;
  const secret = `raw-read-secret-${randomUUID()}`;
  t.after(() => deleteEntry(fixture.agent.id, relPath).then(() => undefined));

  const failed = await executeTool(
    fixture.context,
    "vm_read_file",
    JSON.stringify({ path: relPath }),
  );
  assert.equal(failed.toolOutcome, "rejected");
  assert.ok(failed.receiptId);

  const [failedReceipt] = await db
    .select()
    .from(operationReceiptsTable)
    .where(eq(operationReceiptsTable.id, failed.receiptId!));
  const failedInvocations = await db
    .select()
    .from(operationInvocationsTable)
    .where(eq(operationInvocationsTable.receiptId, failed.receiptId!));
  assert.equal(failedReceipt.state, "reserved");
  assert.equal(
    failedInvocations.some((invocation) => invocation.state === "failed"),
    true,
  );

  await writeTextFile(fixture.agent.id, relPath, secret);
  const retry = await executeTool(
    fixture.context,
    "vm_read_file",
    JSON.stringify({ path: relPath }),
  );
  assert.equal(retry.toolOutcome, "succeeded");
  assert.equal(retry.receiptId, failed.receiptId);
  assert.match(retry.content, new RegExp(secret, "u"));

  const [[receipt], invocations] = await Promise.all([
    db
      .select()
      .from(operationReceiptsTable)
      .where(eq(operationReceiptsTable.id, retry.receiptId!)),
    db
      .select()
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.receiptId, retry.receiptId!)),
  ]);
  assert.equal(receipt.state, "succeeded");
  assert.deepEqual(receipt.resultData, { executionLocale: "tr" });
  assert.equal(JSON.stringify(receipt).includes(secret), false);
  assert.equal(
    invocations.filter((invocation) => invocation.state === "failed").length,
    1,
  );
  assert.equal(
    invocations.filter((invocation) => invocation.state === "succeeded").length,
    1,
  );

  const replay = await executeTool(
    fixture.context,
    "vm_read_file",
    JSON.stringify({ path: relPath }),
  );
  assert.equal(replay.toolOutcome, "deferred");
  assert.equal(replay.content.includes(secret), false);
});

test("transactional receipts distinguish distinct normalized call slots", async () => {
  const fixture = await createFixture("round:0:tool:2");
  const firstSummary = `slot-a-${randomUUID()}`;
  const first = await executeTool(
    fixture.context,
    "log_note",
    JSON.stringify({ summary: firstSummary }),
  );
  const secondContext: ToolRuntimeContext = {
    ...fixture.context,
    operationIdentity: {
      ...fixture.context.operationIdentity!,
      modelToolCallId: `${fixture.context.operationIdentity!.modelToolCallId}-2`,
      callSlot: "round:1:tool:0",
    },
  };
  const secondSummary = `slot-b-${randomUUID()}`;
  const second = await executeTool(
    secondContext,
    "log_note",
    JSON.stringify({ summary: secondSummary }),
  );
  assert.equal(first.toolOutcome, "succeeded");
  assert.equal(second.toolOutcome, "succeeded");
  assert.notEqual(first.receiptId, second.receiptId);
  const receipts = await db
    .select()
    .from(operationReceiptsTable)
    .where(
      and(
        eq(
          operationReceiptsTable.logicalExecutionId,
          fixture.context.operationIdentity!.logicalExecutionId,
        ),
        eq(operationReceiptsTable.toolName, "log_note"),
      ),
    );
  assert.equal(receipts.length, 2);
});
