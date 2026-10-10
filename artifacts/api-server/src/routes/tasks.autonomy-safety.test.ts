import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  approvalRequestsTable,
  db,
  dbReady,
  tasksTable,
  type TaskBlockedReason,
} from "@workspace/db";
import app from "../app";
import { scrubExpiredApprovals } from "../lib/orchestrator/sudo-approval-retention";

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          Host: `127.0.0.1:${port}`,
          Origin: `http://127.0.0.1:${port}`,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (responseBody += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: responseBody }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function listen(): Promise<{
  port: number;
  close(): Promise<void>;
}> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    port: address.port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test("resume is fail-closed and accepts only a question-bound user_input wait", async (t) => {
  await dbReady;
  const server = await listen();
  t.after(() => server.close());
  const [owner, inactiveOwner] = await db
    .insert(agentsTable)
    .values([
      {
        name: "Resume safety owner",
        role: "Test",
        systemPrompt: "Test only",
        createdByUser: true,
      },
      {
        name: "Inactive resume owner",
        role: "Test",
        systemPrompt: "Test only",
        createdByUser: true,
        isActive: false,
        status: "archived",
      },
    ])
    .returning();

  const reasons: Array<TaskBlockedReason | null> = [
    "user_input",
    "budget",
    "runtime_failure",
    "approval_expired",
    "approval_rejected",
    "approval_outcome_unknown",
    "operation_outcome_unknown",
    null,
  ];
  const tasks = await db
    .insert(tasksTable)
    .values(
      reasons.map((blockedReason, index) => ({
        title: `Resume safety ${index}`,
        brief: "Only a typed human-input wait can be resumed.",
        ownerAgentId: owner.id,
        status: "blocked",
        blockedReason,
        userInputQuestionId: randomUUID(),
        userInputQuestion: "What should happen next?",
        userInputOwnerAgentId: owner.id,
        createdByUser: true,
      })),
    )
    .returning();

  const allowed = await request(
    server.port,
    "POST",
    `/api/tasks/${tasks[0]!.id}/resume`,
    {
      requestId: randomUUID(),
      questionId: tasks[0]!.userInputQuestionId,
      answer: "Continue with this verified answer.",
    },
  );
  assert.equal(allowed.status, 200, allowed.body);
  const [resumed] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, tasks[0]!.id));
  assert.equal(resumed.status, "in_progress");
  assert.equal(resumed.blockedReason, null);

  for (const blockedTask of tasks.slice(1)) {
    const detail = await request(
      server.port,
      "GET",
      `/api/tasks/${blockedTask.id}`,
    );
    assert.equal(detail.status, 200, detail.body);
    assert.equal(
      JSON.parse(detail.body).blockedReason,
      blockedTask.blockedReason,
    );
    const list = await request(
      server.port,
      "GET",
      `/api/tasks?ownerAgentId=${owner.id}`,
    );
    assert.equal(list.status, 200, list.body);
    assert.equal(
      JSON.parse(list.body).find(
        (task: { id: number }) => task.id === blockedTask.id,
      ).blockedReason,
      blockedTask.blockedReason,
    );
    const denied = await request(
      server.port,
      "POST",
      `/api/tasks/${blockedTask.id}/resume`,
      {
        requestId: randomUUID(),
        questionId: blockedTask.userInputQuestionId,
        answer: "This must not bypass the circuit breaker.",
      },
    );
    assert.equal(denied.status, 200, denied.body);
    assert.equal(JSON.parse(denied.body).outcome, "rejected");
    const [persisted] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, blockedTask.id));
    assert.equal(persisted.status, "blocked");
    assert.equal(persisted.blockedReason, blockedTask.blockedReason);
  }

  const [inactiveTask] = await db
    .insert(tasksTable)
    .values({
      title: "Inactive owner resume",
      brief: "Inactive owners cannot be restarted.",
      ownerAgentId: inactiveOwner.id,
      status: "blocked",
      blockedReason: "user_input",
      createdByUser: true,
    })
    .returning();
  const inactive = await request(
    server.port,
    "POST",
    `/api/tasks/${inactiveTask.id}/resume`,
    { requestId: randomUUID(), questionId: randomUUID(), answer: "No" },
  );
  assert.equal(inactive.status, 200, inactive.body);
  assert.equal(JSON.parse(inactive.body).outcome, "rejected");
});

test("parent cancellation atomically revokes active descendants and approvals", async (t) => {
  await dbReady;
  const server = await listen();
  t.after(() => server.close());
  const future = new Date(Date.now() + 10 * 60_000);
  const [manager, worker] = await db
    .insert(agentsTable)
    .values([
      {
        name: "Cascade manager",
        role: "Manager",
        systemPrompt: "Test only",
        createdByUser: true,
      },
      {
        name: "Cascade worker",
        role: "Worker",
        systemPrompt: "Test only",
        createdByUser: true,
      },
    ])
    .returning();
  const lease = `task:cascade:${Date.now()}`;
  const [parent] = await db
    .insert(tasksTable)
    .values({
      title: "Cascade root",
      brief: "Cancel all active work below this root.",
      ownerAgentId: manager.id,
      status: "in_progress",
      leaseOwner: lease,
      leaseExpiresAt: future,
      createdByUser: true,
    })
    .returning();
  const [child] = await db
    .insert(tasksTable)
    .values({
      title: "Cascade child",
      brief: "This capability must become unclaimable.",
      ownerAgentId: worker.id,
      assignedByAgentId: manager.id,
      parentTaskId: parent.id,
      status: "awaiting_approval",
      createdByUser: false,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({
      status: "working",
      currentTaskId: parent.id,
      runLeaseOwner: lease,
      runLeaseExpiresAt: future,
    })
    .where(eq(agentsTable.id, manager.id));
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: child.id,
      agentId: worker.id,
      category: "external_contact",
      title: "Queued descendant action",
      description: "Must be revoked with the root.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: future,
      scope: { toolName: "browser_click", argsHash: "cascade" },
      actionPayload: { toolName: "browser_click", args: { ref: 1 } },
    })
    .returning();

  const response = await request(
    server.port,
    "POST",
    `/api/tasks/${parent.id}/cancel`,
  );
  assert.equal(response.status, 200, response.body);
  const [persistedParent] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, parent.id));
  const [persistedChild] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, child.id));
  const [persistedApproval] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, approval.id));
  assert.equal(persistedParent.status, "cancelled");
  assert.equal(persistedChild.status, "cancelled");
  assert.equal(persistedApproval.status, "rejected");
  assert.equal(persistedApproval.consumedAt, null);
  assert.equal(persistedApproval.actionPayload, null);
  assert.equal(persistedApproval.scope?.target, null);
  assert.match(persistedApproval.scope?.preview ?? "", /^CANCELLED:/);
  assert.equal(persistedParent.leaseOwner, null);
});

test("cancel and deactivation reject an actively leased approval", async (t) => {
  await dbReady;
  const server = await listen();
  t.after(() => server.close());
  const future = new Date(Date.now() + 5 * 60_000);
  const approvalLease = `approval:race:${Date.now()}`;
  const [owner] = await db
    .insert(agentsTable)
    .values({
      name: "Approval lease owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      status: "working",
      runLeaseOwner: approvalLease,
      runLeaseExpiresAt: future,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Approval lease protected",
      brief: "The at-most-once action must finish first.",
      ownerAgentId: owner.id,
      status: "awaiting_approval",
      leaseOwner: approvalLease,
      leaseExpiresAt: future,
      createdByUser: true,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id })
    .where(eq(agentsTable.id, owner.id));

  const cancelled = await request(
    server.port,
    "POST",
    `/api/tasks/${task.id}/cancel`,
  );
  assert.equal(cancelled.status, 409, cancelled.body);
  const deactivated = await request(
    server.port,
    "PATCH",
    `/api/agents/${owner.id}`,
    { isActive: false },
  );
  assert.equal(deactivated.status, 409, deactivated.body);
  const [persistedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  const [persistedOwner] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, owner.id));
  assert.equal(persistedTask.status, "awaiting_approval");
  assert.equal(persistedTask.leaseOwner, approvalLease);
  assert.equal(persistedOwner.isActive, true);
});

test("permission revocation serializes with task and approval leases", async (t) => {
  await dbReady;
  const server = await listen();
  t.after(() => server.close());
  const future = new Date(Date.now() + 5 * 60_000);
  const owners = await db
    .insert(agentsTable)
    .values([
      {
        name: "Task permission lease owner",
        role: "Test",
        systemPrompt: "Test only",
        createdByUser: true,
        status: "working",
        runLeaseOwner: `task:permission-race:${Date.now()}`,
        runLeaseExpiresAt: future,
      },
      {
        name: "Approval permission lease owner",
        role: "Test",
        systemPrompt: "Test only",
        createdByUser: true,
        status: "working",
        runLeaseOwner: `approval:permission-race:${Date.now()}`,
        runLeaseExpiresAt: future,
      },
    ])
    .returning();

  for (const owner of owners) {
    const revokedPermissions = { ...owner.permissions, canBrowse: false };
    const denied = await request(
      server.port,
      "PATCH",
      `/api/agents/${owner.id}`,
      { permissions: revokedPermissions },
    );
    assert.equal(denied.status, 409, denied.body);
    const [stillLeased] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, owner.id));
    assert.equal(stillLeased.permissions.canBrowse, true);
    assert.equal(stillLeased.runLeaseOwner, owner.runLeaseOwner);

    await db
      .update(agentsTable)
      .set({
        status: "idle",
        runLeaseOwner: null,
        runLeaseExpiresAt: null,
      })
      .where(eq(agentsTable.id, owner.id));
    const allowed = await request(
      server.port,
      "PATCH",
      `/api/agents/${owner.id}`,
      { permissions: revokedPermissions },
    );
    assert.equal(allowed.status, 200, allowed.body);
    const [persisted] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, owner.id));
    assert.equal(persisted.permissions.canBrowse, false);
    assert.equal(persisted.runLeaseOwner, null);
  }
});

test("generic scoped expiry resolves capacity rows and blocks their tasks", async () => {
  await dbReady;
  const [owner] = await db
    .insert(agentsTable)
    .values({
      name: "Generic expiry owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const expiredAt = new Date(Date.now() - 1_000);
  const tasks = await db
    .insert(tasksTable)
    .values(
      [
        "pending scoped expiry",
        "approved scoped expiry",
        "consumed expiry",
      ].map((title) => ({
        title,
        brief: "Expired capabilities must have a terminal approval state.",
        ownerAgentId: owner.id,
        status: "awaiting_approval",
        createdByUser: true,
      })),
    )
    .returning();
  const approvals = await db
    .insert(approvalRequestsTable)
    .values([
      {
        taskId: tasks[0]!.id,
        agentId: owner.id,
        category: "external_contact",
        title: "Pending expired click",
        description: "Expired",
        status: "pending",
        expiresAt: expiredAt,
        scope: {
          toolName: "browser_click",
          argsHash: "pending-expired",
          target: "https://private.invalid/PENDING-EXPIRED-SENTINEL",
          preview: "PENDING-EXPIRED-SENTINEL page context",
        },
        actionPayload: { toolName: "browser_click", args: { ref: 1 } },
      },
      {
        taskId: tasks[1]!.id,
        agentId: owner.id,
        category: "external_contact",
        title: "Approved expired click",
        description: "Expired",
        status: "approved",
        resolvedAt: new Date(Date.now() - 2_000),
        expiresAt: expiredAt,
        scope: {
          toolName: "browser_click",
          argsHash: "approved-expired",
          target: "https://private.invalid/APPROVED-EXPIRED-SENTINEL",
          preview: "APPROVED-EXPIRED-SENTINEL page context",
        },
        actionPayload: { toolName: "browser_click", args: { ref: 2 } },
      },
      {
        taskId: tasks[2]!.id,
        agentId: owner.id,
        category: "external_contact",
        title: "Consumed expired click",
        description: "At-most-once recovery owns this row",
        status: "approved",
        resolvedAt: new Date(Date.now() - 3_000),
        consumedAt: new Date(Date.now() - 2_000),
        expiresAt: expiredAt,
        scope: { toolName: "browser_click", argsHash: "consumed-expired" },
        actionPayload: null,
      },
    ])
    .returning();

  assert.equal(await scrubExpiredApprovals(), 2);
  for (const approval of approvals.slice(0, 2)) {
    const [persistedApproval] = await db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approval.id));
    const [persistedTask] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, approval.taskId));
    assert.equal(persistedApproval.status, "rejected");
    assert.equal(persistedApproval.actionPayload, null);
    assert.equal(persistedApproval.scope?.target, null);
    assert.doesNotMatch(
      JSON.stringify(persistedApproval),
      /PENDING-EXPIRED-SENTINEL|APPROVED-EXPIRED-SENTINEL/,
    );
    assert.match(
      persistedApproval.scope?.preview ?? "",
      new RegExp(persistedApproval.scope?.argsHash ?? "never"),
    );
    assert.equal(persistedTask.status, "blocked");
    assert.equal(persistedTask.blockedReason, "approval_expired");
  }
  const [consumed] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, approvals[2]!.id));
  assert.equal(consumed.status, "approved");
  assert.ok(consumed.consumedAt);
});
