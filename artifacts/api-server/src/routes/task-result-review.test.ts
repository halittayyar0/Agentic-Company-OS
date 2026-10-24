import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  tasksTable,
  approvalRequestsTable,
  activityEventsTable,
  taskAttemptsTable,
  operationReceiptsTable,
  runtimeInstancesTable,
  runtimeControlsTable,
} from "@workspace/db";
import { createOperatorAuth } from "../lib/operator-auth";
import { withAgentConfigVersion } from "../lib/agent-config-version";
import {
  completionProposalContextHash,
  completionProposalDigest,
  readCompletionProposal,
} from "../lib/task-result-review-proposal";
import { createApprovalsRouter } from "./approvals";
import tasksRouter from "./tasks";
import agentsRouter from "./agents";
import { scrubExpiredApprovals } from "../lib/orchestrator/sudo-approval-retention";
import { resumeResolvedApprovalTasks } from "../lib/orchestrator/scheduler";
import {
  readExecutionPolicy,
  updateExecutionPolicy,
} from "../lib/execution-policy";
import { approvePolicyActions } from "../lib/orchestrator/policy-approvals";

test.after(() => closeDatabase());
async function fixture(
  t: TestContext,
  options: { auth?: boolean; continuous?: boolean } = {},
) {
  await dbReady;
  const now = new Date();
  const [owner] = await db
    .insert(agentsTable)
    .values({
      name: "Result review fixture",
      role: "Test",
      systemPrompt: "No inference",
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
      title: "Review proposed result",
      brief: "Read the file and report only.",
      ownerAgentId: owner!.id,
      status: "awaiting_approval",
      autonomyMode: options.continuous ? "continuous" : "finite",
      cadenceSeconds: options.continuous ? 60 : null,
      completionRequirements: [
        { kind: "tool_succeeded", tool: "vm_read_file" },
      ],
      resultFormat: { kind: "table", columns: ["Owner", "Due"] },
    })
    .returning();
  const workerId = randomUUID(),
    attemptId = randomUUID(),
    logicalExecutionId = randomUUID(),
    receiptId = randomUUID();
  await db.insert(runtimeInstancesTable).values({
    id: workerId,
    role: "worker",
    state: "stopped",
    hostname: "fixture",
    processId: process.pid,
    buildVersion: "fixture",
  });
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: task!.id,
    agentId: owner!.id,
    workerInstanceId: workerId,
    leaseOwner: randomUUID(),
    attemptNumber: 1,
    cycleNumber: 0,
    state: "blocked",
    logicalExecutionId,
    finishedAt: now,
  });
  await db.insert(operationReceiptsTable).values({
    id: receiptId,
    operationKey: receiptId,
    executionKind: "task_step",
    logicalExecutionId,
    taskId: task!.id,
    agentId: owner!.id,
    originAttemptId: attemptId,
    sideEffectClass: "read_only",
    state: "succeeded",
    toolName: "vm_read_file",
    argumentHash: "a".repeat(64),
    reservedAt: now,
    finishedAt: now,
  });
  const [review] = await db
    .insert(activityEventsTable)
    .values({
      agentId: owner!.id,
      taskId: task!.id,
      type: "judge_review",
      summary: "Model rejected the result",
      severity: "critical",
      detail: {
        verdict: "block",
        sourceReview: {
          scope: "current_task_step_reads",
          contentRetained: false,
          reasonCode: "missing_required_action",
          documentCount: 1,
        },
      },
    })
    .returning();
  const resultSummary = "| Owner | Due |\n| --- | --- |\n| Mira | 2026-10-26 |";
  const proposal = readCompletionProposal({
    schemaVersion: 1,
    taskId: task!.id,
    ownerAgentId: owner!.id,
    ownerConfigVersion: withAgentConfigVersion(owner!).configVersion,
    cycleNumber: 0,
    cycleStartedAt: task!.createdAt.toISOString(),
    originAttemptId: attemptId,
    judgeReviewId: review!.id,
    judgeReasonCode: "missing_required_action",
    contextHash: completionProposalContextHash(
      task!,
      withAgentConfigVersion(owner!),
    ),
    resultSummary,
    resultSummaryHash: createHash("sha256").update(resultSummary).digest("hex"),
    sourceReceipts: [
      {
        receiptId,
        argumentHash: "a".repeat(64),
        fileSha256: "b".repeat(64),
        byteCount: 73,
      },
    ],
  })!;
  assert.ok(proposal);
  const digest = completionProposalDigest(proposal);
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task!.id,
      agentId: owner!.id,
      category: "other",
      title: "Review result",
      description: "Proposed result awaits review",
      scope: {
        toolName: "operator_confirm_task_result",
        argsHash: digest,
        preview: "Review the proposed result",
      },
      completionProposal: proposal,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 86400000),
    })
    .returning();
  const credential = randomUUID();
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createApprovalsRouter({
      resultReviewAuth: createOperatorAuth({
        token: options.auth === false ? null : credential,
        secureCookies: false,
      }),
    }),
  );
  app.use("/api", tasksRouter);
  app.use("/api", agentsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = "http://127.0.0.1:" + address.port + "/api";
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: false })
      .where(eq(runtimeControlsTable.id, 1));
    await db
      .update(approvalRequestsTable)
      .set({ status: "rejected", completionProposal: null })
      .where(eq(approvalRequestsTable.id, approval!.id));
    await db
      .update(tasksTable)
      .set({
        status: "cancelled",
        blockedReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(tasksTable.ownerAgentId, owner!.id));
    await db
      .update(taskAttemptsTable)
      .set({ state: "blocked", finishedAt: new Date() })
      .where(eq(taskAttemptsTable.id, attemptId));
    await db
      .update(agentsTable)
      .set({
        isActive: false,
        currentTaskId: null,
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(eq(agentsTable.id, owner!.id));
  });
  const request = async (
    path: string,
    body?: Record<string, unknown>,
    authenticated = true,
    method?: string,
  ) => {
    const response = await fetch(base + path, {
      method: method ?? (body ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { Authorization: "Bearer " + credential } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
      cache: response.headers.get("cache-control"),
    };
  };
  const decide = (
    body: Record<string, unknown> = {
      decision: "approved",
      confirmTaskResult: true,
      expectedArgsHash: digest,
    },
    authenticated = true,
  ) => request("/approvals/" + approval!.id + "/decision", body, authenticated);
  const read = (authenticated = true) =>
    request(
      "/approvals/" + approval!.id + "/result-review",
      undefined,
      authenticated,
    );
  const saved = async () =>
    (await db.select().from(tasksTable).where(eq(tasksTable.id, task!.id)))[0]!;
  return {
    owner: owner!,
    task: task!,
    approval: approval!,
    proposal,
    digest,
    review: review!,
    receiptId,
    attemptId,
    request,
    decide,
    read,
    saved,
  };
}
test("proposed output requires configured credential authentication even when generic API auth is disabled", async (t) => {
  const f = await fixture(t, { auth: false });
  assert.equal((await f.read()).status, 503);
  assert.equal((await f.decide()).status, 503);
  assert.equal((await f.saved()).status, "awaiting_approval");
});
test("credential authentication gates both reading and resolving a result review", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.read(false)).status, 401);
  assert.equal((await f.decide(undefined, false)).status, 401);
  const read = await f.read();
  assert.equal(read.status, 200);
  assert.equal(read.cache, "no-store");
  assert.equal(read.body.resultSummary, f.proposal.resultSummary);
  assert.equal(read.body.proposalHash, f.digest);
  const list = await f.request("/approvals");
  assert.ok(!JSON.stringify(list.body).includes(f.proposal.resultSummary));
  assert.ok(!JSON.stringify(list.body).includes("completionProposal"));
});
test("ordinary approval and missing or different digests never confirm the result", async (t) => {
  const f = await fixture(t);
  for (const body of [
    { decision: "approved" },
    { decision: "approved", expectedArgsHash: f.digest },
    { decision: "approved", confirmTaskResult: true },
    {
      decision: "approved",
      confirmTaskResult: true,
      expectedArgsHash: "c".repeat(64),
    },
  ]) {
    assert.ok([400, 409].includes((await f.decide(body)).status));
    assert.equal((await f.saved()).status, "awaiting_approval");
  }
  const policy = await readExecutionPolicy();
  const changed = await updateExecutionPolicy({
    mode: "full_access",
    expectedRevision: policy.revision,
  });
  try {
    assert.equal(await approvePolicyActions(), 0);
    assert.equal((await f.saved()).status, "awaiting_approval");
    const [row] = await db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, f.approval.id));
    assert.equal(row!.status, "pending");
    assert.equal(row!.automaticPolicyRevision, null);
  } finally {
    await updateExecutionPolicy({
      mode: policy.mode,
      expectedRevision: changed.revision,
    });
  }
});
for (const continuous of [false, true])
  test(
    "operator result confirmation is atomic and advances once, recurring=" +
      continuous,
    async (t) => {
      const f = await fixture(t, { continuous });
      let parentId: number | undefined;
      if (!continuous) {
        const [parent] = await db
          .insert(tasksTable)
          .values({
            title: "Waiting parent",
            brief: "No inference",
            ownerAgentId: f.owner.id,
          })
          .returning();
        parentId = parent!.id;
        await db
          .update(tasksTable)
          .set({ parentTaskId: parentId })
          .where(eq(tasksTable.id, f.task.id));
      }
      assert.equal((await f.decide()).status, 200);
      const saved = await f.saved();
      assert.equal(saved.status, continuous ? "in_progress" : "completed");
      assert.equal(saved.completionAuthority, "operator");
      assert.equal(saved.resultSummary, f.proposal.resultSummary);
      assert.equal(saved.cycleCount, continuous ? 1 : 0);
      if (continuous)
        assert.equal(
          saved.nextAttemptAt!.getTime() -
            saved.lastCycleCompletedAt!.getTime(),
          60000,
        );
      assert.equal((await f.decide()).status, 200);
      assert.equal((await f.saved()).cycleCount, saved.cycleCount);
      const [resolved] = await db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, f.approval.id));
      assert.equal(resolved!.completionProposal, null);
      assert.ok(resolved!.consumedAt);
      assert.equal((await f.read()).status, 409);
      const [original] = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.id, f.review.id));
      assert.equal(original!.detail!.verdict, "block");
      const events = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.taskId, f.task.id));
      assert.equal(
        events.filter(
          (event) =>
            event.detail?.runtimeEvent === "task_result_review_resolved",
        ).length,
        1,
      );
      assert.equal(
        events.filter(
          (event) =>
            event.detail?.runtimeEvent === "task_result_operator_confirmed",
        ).length,
        1,
      );
      if (parentId) {
        const parentEvents = await db
          .select()
          .from(activityEventsTable)
          .where(eq(activityEventsTable.taskId, parentId));
        assert.equal(
          parentEvents.filter(
            (event) =>
              event.detail?.completedSubtaskId === f.task.id &&
              event.detail?.completionAuthority === "operator",
          ).length,
          1,
        );
      }
    },
  );
for (const change of [
  "brief",
  "format",
  "owner settings",
  "cycle",
  "required operation",
  "source receipt",
  "judge verdict",
  "child",
  "task lease",
  "agent lease",
  "active attempt",
  "cancelled",
])
  test("confirmation rejects changed " + change, async (t) => {
    const f = await fixture(t);
    if (change === "brief")
      await db
        .update(tasksTable)
        .set({ brief: "Changed brief" })
        .where(eq(tasksTable.id, f.task.id));
    if (change === "format")
      await db
        .update(tasksTable)
        .set({ resultFormat: { kind: "table", columns: ["Due", "Owner"] } })
        .where(eq(tasksTable.id, f.task.id));
    if (change === "owner settings")
      await db
        .update(agentsTable)
        .set({ systemPrompt: "Changed instructions" })
        .where(eq(agentsTable.id, f.owner.id));
    if (change === "cycle")
      await db
        .update(tasksTable)
        .set({ cycleCount: 1 })
        .where(eq(tasksTable.id, f.task.id));
    if (change === "required operation")
      await db
        .update(tasksTable)
        .set({
          completionRequirements: [
            { kind: "tool_succeeded", tool: "calculate" },
          ],
        })
        .where(eq(tasksTable.id, f.task.id));
    if (change === "source receipt")
      await db
        .update(operationReceiptsTable)
        .set({ state: "failed" })
        .where(eq(operationReceiptsTable.id, f.receiptId));
    if (change === "judge verdict")
      await db
        .update(activityEventsTable)
        .set({ detail: { verdict: "pass" } })
        .where(eq(activityEventsTable.id, f.review.id));
    if (change === "child")
      await db.insert(tasksTable).values({
        title: "Unfinished child",
        brief: "No inference",
        ownerAgentId: f.owner.id,
        parentTaskId: f.task.id,
      });
    if (change === "task lease")
      await db
        .update(tasksTable)
        .set({
          leaseOwner: "some-worker",
          leaseExpiresAt: new Date(Date.now() + 60000),
        })
        .where(eq(tasksTable.id, f.task.id));
    if (change === "agent lease")
      await db
        .update(agentsTable)
        .set({
          runLeaseOwner: "chat-worker",
          runLeaseExpiresAt: new Date(Date.now() + 60000),
        })
        .where(eq(agentsTable.id, f.owner.id));
    if (change === "active attempt")
      await db
        .update(taskAttemptsTable)
        .set({ state: "running", finishedAt: null })
        .where(eq(taskAttemptsTable.id, f.attemptId));
    if (change === "cancelled")
      await db
        .update(tasksTable)
        .set({ status: "cancelled" })
        .where(eq(tasksTable.id, f.task.id));
    assert.equal((await f.decide()).status, 409);
    assert.notEqual((await f.saved()).completionAuthority, "operator");
  });
test("emergency stop allows rejection but never confirms a result", async (t) => {
  const f = await fixture(t);
  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: true })
    .where(eq(runtimeControlsTable.id, 1));
  assert.equal((await f.decide()).status, 423);
  assert.equal((await f.decide({ decision: "rejected" })).status, 200);
  assert.equal((await f.saved()).blockedReason, "approval_rejected");
});
test("expiry clears proposed content and cannot complete work", async (t) => {
  const f = await fixture(t);
  await scrubExpiredApprovals(new Date(f.approval.expiresAt!.getTime() + 1));
  const [row] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, f.approval.id));
  assert.equal(row!.completionProposal, null);
  assert.equal(row!.status, "rejected");
  assert.equal((await f.saved()).blockedReason, "approval_expired");
  assert.equal((await f.decide()).status, 410);
});
test("a confirmed result history cannot resume an unrelated waiting cycle", async (t) => {
  const f = await fixture(t, { continuous: true });
  assert.equal((await f.decide()).status, 200);
  await db
    .update(tasksTable)
    .set({ status: "awaiting_approval" })
    .where(eq(tasksTable.id, f.task.id));
  await resumeResolvedApprovalTasks(new Date());
  assert.equal((await f.saved()).status, "awaiting_approval");
});
for (const action of ["cancel", "deactivate"])
  test(
    action + " clears pending proposed content without confirming it",
    async (t) => {
      const f = await fixture(t);
      const response =
        action === "cancel"
          ? await f.request("/tasks/" + f.task.id + "/cancel", {})
          : await f.request(
              "/agents/" + f.owner.id,
              { isActive: false },
              true,
              "PATCH",
            );
      assert.equal(response.status, 200);
      const [row] = await db
        .select()
        .from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, f.approval.id));
      assert.equal(row!.status, "rejected");
      assert.equal(row!.completionProposal, null);
      assert.equal(row!.scope?.toolName, "operator_confirm_task_result");
      assert.equal((await f.decide()).status, 409);
      assert.notEqual((await f.saved()).completionAuthority, "operator");
    },
  );
test("concurrent result decisions cannot advance a cycle twice", async (t) => {
  const f = await fixture(t, { continuous: true });
  const results = await Promise.all([f.decide(), f.decide()]);
  assert.ok(results.every((result) => [200, 409].includes(result.status)));
  assert.ok(results.some((result) => result.status === 200));
  assert.equal((await f.saved()).cycleCount, 1);
});
