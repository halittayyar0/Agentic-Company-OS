import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  approvalRequestsTable,
  db,
  dbReady,
  operationInvocationsTable,
  operationReceiptsTable,
  tasksTable,
  defaultAgentPermissions,
} from "@workspace/db";
import app from "./app";

function request(
  port: number,
  options: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path ?? "/api/healthz",
        headers: options.headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

test("operator API rejects DNS-rebinding hosts and cross-site mutations", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;

  const rebound = await request(port, {
    path: "/api/healthz",
    headers: { Host: `attacker.example:${port}` },
  });
  assert.equal(rebound.status, 421);

  const crossSite = await request(port, {
    method: "POST",
    path: "/api/settings",
    headers: {
      Host: `127.0.0.1:${port}`,
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
      "Content-Type": "application/json",
    },
  });
  assert.equal(crossSite.status, 403);

  const preflight = await request(port, {
    method: "OPTIONS",
    path: "/api/settings",
    headers: {
      Host: `127.0.0.1:${port}`,
      Origin: "http://127.0.0.1:5173",
      "Access-Control-Request-Method": "PUT",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers["access-control-allow-origin"],
    "http://127.0.0.1:5173",
  );

  const invalidId = await request(port, {
    path: "/api/agents/not-a-number",
    headers: { Host: `127.0.0.1:${port}` },
  });
  assert.equal(invalidId.status, 400);
  assert.match(invalidId.headers["content-type"] ?? "", /application\/json/);
  assert.doesNotMatch(invalidId.body, /stack|select|query/i);

  const malformedJson = await request(port, {
    method: "POST",
    path: "/api/agents",
    headers: {
      Host: `127.0.0.1:${port}`,
      Origin: `http://127.0.0.1:${port}`,
      "Content-Type": "application/json",
    },
    body: "{",
  });
  assert.equal(malformedJson.status, 400);
  assert.deepEqual(JSON.parse(malformedJson.body), {
    error: "Malformed JSON request body",
  });
});

test("VM and browser routes reject nonexistent agent ids", async (t) => {
  await dbReady;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  const response = await request(port, {
    method: "POST",
    path: "/api/agents/999999/vm/files-list",
    headers: {
      Host: `127.0.0.1:${port}`,
      Origin: `http://127.0.0.1:${port}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: "" }),
  });

  assert.equal(response.status, 404);
  assert.deepEqual(JSON.parse(response.body), { error: "Ajan bulunamadi." });
});

test("task cancellation revokes leases and queued approvals", async (t) => {
  await dbReady;
  const future = new Date(Date.now() + 10 * 60_000);
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Cancellation test agent",
      role: "Test",
      systemPrompt: "Test only",
      status: "working",
      createdByUser: true,
      runLeaseOwner: "task:test-lease",
      runLeaseExpiresAt: future,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Cancellation test task",
      brief: "Cancelling must revoke every active capability.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
      leaseOwner: "task:test-lease",
      leaseExpiresAt: future,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: task.id, currentAction: "Waiting for approval" })
    .where(eq(agentsTable.id, agent.id));
  const [approval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: task.id,
      agentId: agent.id,
      category: "external_contact",
      title: "Queued action",
      description: "This action must be revoked by cancellation.",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: future,
      scope: { toolName: "browser_click", argsHash: "test" },
      actionPayload: { toolName: "browser_click", args: { ref: 1 } },
    })
    .returning();

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const cancelled = await request(address.port, {
    method: "POST",
    path: `/api/tasks/${task.id}/cancel`,
    headers: {
      Host: `127.0.0.1:${address.port}`,
      Origin: `http://127.0.0.1:${address.port}`,
      "Content-Type": "application/json",
    },
  });
  assert.equal(cancelled.status, 200);

  const [persistedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  const [persistedAgent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, agent.id));
  const [persistedApproval] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, approval.id));
  assert.equal(persistedTask.status, "cancelled");
  assert.equal(persistedTask.leaseOwner, null);
  assert.equal(persistedAgent.status, "idle");
  assert.equal(persistedAgent.runLeaseOwner, null);
  assert.equal(persistedApproval.status, "rejected");
  assert.equal(persistedApproval.actionPayload, null);
  assert.equal(persistedApproval.scope?.target, null);
  assert.match(persistedApproval.scope?.preview ?? "", /^CANCELLED:/);
});

test("approval expiry and agent deactivation are atomic kill switches", async (t) => {
  await dbReady;
  const [approvalAgent] = await db
    .insert(agentsTable)
    .values({
      name: "Expired approval test agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [approvalTask] = await db
    .insert(tasksTable)
    .values({
      title: "Expired approval test task",
      brief: "An expired approval must never resume this task.",
      ownerAgentId: approvalAgent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const [expiredApproval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: approvalTask.id,
      agentId: approvalAgent.id,
      category: "other",
      title: "Expired approval",
      description: "This request is already expired.",
      status: "pending",
      scope: { toolName: "browser_click", argsHash: "expired" },
      expiresAt: new Date(Date.now() - 1_000),
    })
    .returning();

  const future = new Date(Date.now() + 10 * 60_000);
  const [activeAgent] = await db
    .insert(agentsTable)
    .values({
      name: "Deactivate test agent",
      role: "Test",
      systemPrompt: "Test only",
      status: "working",
      createdByUser: true,
      runLeaseOwner: "task:deactivate-test",
      runLeaseExpiresAt: future,
    })
    .returning();
  const [activeTask] = await db
    .insert(tasksTable)
    .values({
      title: "Deactivate test task",
      brief: "Deactivation must revoke this run.",
      ownerAgentId: activeAgent.id,
      status: "in_progress",
      createdByUser: true,
      leaseOwner: "task:deactivate-test",
      leaseExpiresAt: future,
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ currentTaskId: activeTask.id, currentAction: "Running" })
    .where(eq(agentsTable.id, activeAgent.id));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const sameOriginHeaders = {
    Host: `127.0.0.1:${address.port}`,
    Origin: `http://127.0.0.1:${address.port}`,
    "Content-Type": "application/json",
  };

  const expiryDecision = await request(address.port, {
    method: "POST",
    path: `/api/approvals/${expiredApproval.id}/decision`,
    headers: sameOriginHeaders,
    body: JSON.stringify({ decision: "approved" }),
  });
  assert.equal(expiryDecision.status, 410);

  const deactivated = await request(address.port, {
    method: "PATCH",
    path: `/api/agents/${activeAgent.id}`,
    headers: sameOriginHeaders,
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(deactivated.status, 200);

  const [persistedApproval] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, expiredApproval.id));
  const [persistedApprovalTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, approvalTask.id));
  const [persistedAgent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, activeAgent.id));
  const [persistedActiveTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, activeTask.id));
  assert.equal(persistedApproval.status, "rejected");
  assert.equal(persistedApprovalTask.status, "blocked");
  assert.equal(persistedApprovalTask.blockedReason, "approval_expired");
  assert.equal(persistedAgent.isActive, false);
  assert.equal(persistedAgent.runLeaseOwner, null);
  assert.equal(persistedActiveTask.status, "blocked");
  assert.equal(persistedActiveTask.blockedReason, "owner_inactive");
  assert.equal(persistedActiveTask.leaseOwner, null);
});

test("sudo API cannot be spoofed, bypassed, or approved without digest confirmation", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Non-root sudo API test agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const command = "echo approval-confirmation-test";
  const argsHash = createHash("sha256")
    .update(JSON.stringify({ command }))
    .digest("hex");
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Sudo confirmation test",
      brief: "Route must demand a digest confirmation.",
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
      title: "CEO Host Shell",
      description: "Test only",
      expiresAt: new Date(Date.now() + 5 * 60_000),
      scope: {
        toolName: "vm_run_sudo_command",
        argsHash,
        target: "host=test;cwd=test",
        preview: command,
      },
      actionPayload: {
        toolName: "vm_run_sudo_command",
        args: { command },
      },
    })
    .returning();

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const headers = {
    Host: `127.0.0.1:${address.port}`,
    Origin: `http://127.0.0.1:${address.port}`,
    "Content-Type": "application/json",
  };

  const directSudo = await request(address.port, {
    method: "POST",
    path: `/api/agents/${agent.id}/vm/exec`,
    headers,
    body: JSON.stringify({ as: "agent_sudo", command: "echo bypass" }),
  });
  assert.equal(directSudo.status, 403);

  const forgedRoot = await request(address.port, {
    method: "POST",
    path: "/api/agents",
    headers,
    body: JSON.stringify({
      name: "Forged CEO",
      role: "Chief Executive Officer",
      templateKey: "ceo",
    }),
  });
  assert.equal(forgedRoot.status, 403);

  const forgedPermission = await request(address.port, {
    method: "PATCH",
    path: `/api/agents/${agent.id}`,
    headers,
    body: JSON.stringify({
      permissions: { ...defaultAgentPermissions, canUseSudo: true },
    }),
  });
  assert.equal(forgedPermission.status, 403);

  const wrongDigest = await request(address.port, {
    method: "POST",
    path: `/api/approvals/${approval.id}/decision`,
    headers,
    body: JSON.stringify({ decision: "approved", confirmation: "deadbeef" }),
  });
  assert.equal(wrongDigest.status, 400);
  const [stillPending] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, approval.id));
  assert.equal(stillPending.status, "pending");

  const rightDigest = await request(address.port, {
    method: "POST",
    path: `/api/approvals/${approval.id}/decision`,
    headers,
    body: JSON.stringify({
      decision: "approved",
      confirmation: argsHash.slice(0, 8).toUpperCase(),
    }),
  });
  assert.equal(rightDigest.status, 200);
  const [
    [approvedCapability],
    [reservedReceipt],
    approvalInvocations,
    [queuedTask],
  ] = await Promise.all([
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
      .from(operationInvocationsTable)
      .where(eq(operationInvocationsTable.executionKind, "approved_action")),
    db.select().from(tasksTable).where(eq(tasksTable.id, task.id)),
  ]);
  assert.equal(approvedCapability.status, "approved");
  assert.equal(approvedCapability.consumedAt, null);
  assert.ok(approvedCapability.actionPayload);
  assert.equal(reservedReceipt.state, "reserved");
  assert.equal(reservedReceipt.executionKind, "approved_action");
  assert.equal(
    approvalInvocations.some(
      (invocation) => invocation.receiptId === reservedReceipt.id,
    ),
    false,
    "the HTTP decision endpoint may reserve work but must never dispatch an effect",
  );
  assert.equal(queuedTask.status, "awaiting_approval");
  assert.equal(queuedTask.leaseOwner, null);

  const rejectCommand = "echo must-be-scrubbed";
  const rejectHash = createHash("sha256")
    .update(JSON.stringify({ command: rejectCommand }))
    .digest("hex");
  const [rejectTask] = await db
    .insert(tasksTable)
    .values({
      title: "Rejected sudo",
      brief: "Raw payload must be scrubbed.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const [rejectedApproval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: rejectTask.id,
      agentId: agent.id,
      category: "other",
      title: "CEO Host Shell",
      description: "Reject and scrub",
      expiresAt: new Date(Date.now() + 5 * 60_000),
      scope: {
        toolName: "vm_run_sudo_command",
        argsHash: rejectHash,
        target: "host=test;cwd=test",
        preview: rejectCommand,
      },
      actionPayload: {
        toolName: "vm_run_sudo_command",
        args: { command: rejectCommand },
      },
    })
    .returning();
  const rejected = await request(address.port, {
    method: "POST",
    path: `/api/approvals/${rejectedApproval.id}/decision`,
    headers,
    body: JSON.stringify({ decision: "rejected" }),
  });
  assert.equal(rejected.status, 200);
  assert.doesNotMatch(rejected.body, /must-be-scrubbed/);
  const [scrubbed] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, rejectedApproval.id));
  assert.equal(scrubbed.actionPayload, null);
  assert.doesNotMatch(scrubbed.scope?.preview ?? "", /must-be-scrubbed/);
  assert.match(scrubbed.scope?.preview ?? "", new RegExp(rejectHash));

  const browserSentinel = "BROWSER-TEXT-SENTINEL-DO-NOT-RETAIN";
  const browserTargetSentinel =
    "https://private.example.invalid/account?secret=PAGE-SENTINEL";
  const browserArgs = {
    ref: 17,
    text: browserSentinel,
    submit: false,
  };
  const browserHash = createHash("sha256")
    .update(JSON.stringify(browserArgs))
    .digest("hex");
  const [browserTask] = await db
    .insert(tasksTable)
    .values({
      title: "Rejected browser capability retention",
      brief: "Exact browser text and page context must be forgotten.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const [browserApproval] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: browserTask.id,
      agentId: agent.id,
      category: "external_contact",
      title: "Type exact private text",
      description: "Reject and retain only a capability digest.",
      expiresAt: new Date(Date.now() + 5 * 60_000),
      scope: {
        toolName: "browser_type",
        argsHash: browserHash,
        target: browserTargetSentinel,
        preview: `${browserTargetSentinel}\n${browserSentinel}`,
      },
      actionPayload: { toolName: "browser_type", args: browserArgs },
    })
    .returning();
  const browserRejected = await request(address.port, {
    method: "POST",
    path: `/api/approvals/${browserApproval.id}/decision`,
    headers,
    body: JSON.stringify({ decision: "rejected" }),
  });
  assert.equal(browserRejected.status, 200);
  assert.doesNotMatch(
    browserRejected.body,
    /BROWSER-TEXT-SENTINEL|PAGE-SENTINEL/,
  );
  const [[scrubbedBrowserApproval], browserEvents] = await Promise.all([
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, browserApproval.id)),
    db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.taskId, browserTask.id)),
  ]);
  const retainedBrowserEvidence = JSON.stringify({
    approval: scrubbedBrowserApproval,
    events: browserEvents,
  });
  assert.equal(scrubbedBrowserApproval.actionPayload, null);
  assert.equal(scrubbedBrowserApproval.scope?.target, null);
  assert.doesNotMatch(
    retainedBrowserEvidence,
    /BROWSER-TEXT-SENTINEL|PAGE-SENTINEL/,
  );
  assert.match(retainedBrowserEvidence, new RegExp(browserHash));

  const expiredCommand = "echo expired-must-be-scrubbed";
  const expiredHash = createHash("sha256")
    .update(JSON.stringify({ command: expiredCommand }))
    .digest("hex");
  const [expiredTask] = await db
    .insert(tasksTable)
    .values({
      title: "Expired sudo",
      brief: "GET must scrub abandoned approvals.",
      ownerAgentId: agent.id,
      status: "awaiting_approval",
      createdByUser: true,
    })
    .returning();
  const [expired] = await db
    .insert(approvalRequestsTable)
    .values({
      taskId: expiredTask.id,
      agentId: agent.id,
      category: "other",
      title: "CEO Host Shell",
      description: "Expire and scrub",
      expiresAt: new Date(Date.now() - 1_000),
      scope: {
        toolName: "vm_run_sudo_command",
        argsHash: expiredHash,
        target: "host=test;cwd=test",
        preview: expiredCommand,
      },
      actionPayload: {
        toolName: "vm_run_sudo_command",
        args: { command: expiredCommand },
      },
    })
    .returning();
  const list = await request(address.port, {
    path: "/api/approvals",
    headers,
  });
  assert.equal(list.status, 200);
  const [scrubbedExpired] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, expired.id));
  const [blockedExpiredTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, expiredTask.id));
  assert.equal(scrubbedExpired.status, "rejected");
  assert.equal(scrubbedExpired.actionPayload, null);
  assert.doesNotMatch(
    scrubbedExpired.scope?.preview ?? "",
    /expired-must-be-scrubbed/,
  );
  assert.equal(blockedExpiredTask.status, "blocked");
  assert.equal(blockedExpiredTask.lastError, "Sudo approval expired");
});
