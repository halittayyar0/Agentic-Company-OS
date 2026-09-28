import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  approvalRequestsTable,
  db,
  dbReady,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import { executeApprovedAction, executeTool } from "./execute-tool";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { managerPermissionsPreset } from "./permission-presets";
import { closeAllSessions } from "../vm/browser";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { startTaskLeaseHeartbeat } from "./task-lease-heartbeat";

const runtimeOperationsConfig = readRuntimeOperationsConfig();

test("tool arguments must be a JSON object", async () => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Argument shape test agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const result = await executeTool({ agent, taskId: null }, "log_note", "null");
  assert.match(result.content, /JSON nesnesi/);
});

test("business approval categories are enforced from live agent permissions", async () => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Permission boundary test agent",
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

  const denied = await executeTool(
    { agent, taskId: null },
    "request_approval",
    JSON.stringify({
      category: "publish",
      title: "Publish untrusted content",
      description: "Must not create an approval capability.",
    }),
  );
  assert.match(denied.content, /yetkisi yok/);
  const laundered = await executeTool(
    { agent, taskId: null },
    "request_approval",
    JSON.stringify({
      category: "other",
      title: "Misclassified browser mutation",
      description: "Must not launder external-contact authority.",
      toolName: "browser_type",
      toolArgs: { ref: 1, text: "send this", submit: false },
    }),
  );
  assert.match(laundered.content, /category=external_contact/);
  const approvals = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.agentId, agent.id));
  assert.equal(approvals.length, 0);
});

test("revoking a business permission invalidates an already approved action", async () => {
  await dbReady;
  const commandArgs = { command: "echo permission-revoked" };
  const argsHash = createHash("sha256")
    .update(JSON.stringify(commandArgs))
    .digest("hex");
  const permissions = {
    canCreateSubAgents: false,
    canDelegate: false,
    canSpend: false,
    canDelete: false,
    canPublish: true,
    canContactExternal: false,
    canBrowse: false,
    canUseTerminal: true,
    canUseSudo: false,
  };
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approval revocation test agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Permission revocation",
      brief: "An old approval must not outlive authority.",
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
      category: "publish",
      title: "Publish through a command",
      description: "Synthetic authorization test",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      scope: { toolName: "vm_run_command", argsHash },
      actionPayload: { toolName: "vm_run_command", args: commandArgs },
    })
    .returning();
  await db
    .update(agentsTable)
    .set({ permissions: { ...permissions, canPublish: false } })
    .where(eq(agentsTable.id, agent.id));

  const result = await executeApprovedAction(
    approval.id,
    runtimeOperationsConfig,
  );
  assert.equal(result.claimed, false);
  const [persisted] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, approval.id));
  assert.equal(persisted.consumedAt, null);
});

test("a parent task cannot complete while a delegated subtask is unresolved", async (t) => {
  await dbReady;
  const workerConfig = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    workerConfig,
  );
  t.after(() => runtime.stopHeartbeat());
  const leaseOwner = "task:parent-completion-test";
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Parent completion test agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      runLeaseOwner: leaseOwner,
      runLeaseExpiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  const [parent] = await db
    .insert(tasksTable)
    .values({
      title: "Parent task",
      brief: "Must include the child result.",
      ownerAgentId: agent.id,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      stepAttempts: 1,
      createdByUser: true,
    })
    .returning();
  const attemptId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: parent.id,
    agentId: agent.id,
    workerInstanceId: runtime.id,
    leaseOwner,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "running",
    startedAt: new Date(),
    lastHeartbeatAt: new Date(),
  });
  const heartbeat = startTaskLeaseHeartbeat({
    taskId: parent.id,
    agentId: agent.id,
    attemptId,
    leaseOwner,
    config: workerConfig,
  });
  t.after(() => heartbeat.stop());
  const [child] = await db
    .insert(tasksTable)
    .values({
      title: "Unresolved child",
      brief: "Still working.",
      ownerAgentId: agent.id,
      status: "pending",
      parentTaskId: parent.id,
      createdByUser: false,
    })
    .returning();

  const result = await executeTool(
    {
      agent,
      taskId: parent.id,
      taskLeaseOwner: leaseOwner,
      runtimeAttemptId: attemptId,
      assertTaskLease: (action) => heartbeat.assertOwned(action),
    },
    "complete_task",
    JSON.stringify({ resultSummary: "Everything is done." }),
  );
  assert.match(result.content, new RegExp(`taskId=${child.id}.*pending`));
  const [persisted] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, parent.id));
  assert.equal(persisted.status, "in_progress");
});

test("approved non-sudo tool output is not copied into the durable activity ledger", async (t) => {
  await dbReady;
  const runtime = await registerRuntimeInstance(
    { role: "combined", schedulerEnabled: true },
    runtimeOperationsConfig,
  );
  t.after(() => runtime.stopHeartbeat());
  const secretOutput = "activity-must-not-store-this-secret";
  const args = { command: `echo ${secretOutput}` };
  const argsHash = createHash("sha256")
    .update(JSON.stringify(args))
    .digest("hex");
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approved output minimization agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Output minimization",
      brief: "Run one exact built-in command.",
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
      title: "Exact command",
      description: "Test only",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      scope: { toolName: "vm_run_command", argsHash },
      actionPayload: { toolName: "vm_run_command", args },
    })
    .returning();

  const result = await executeApprovedAction(
    approval.id,
    runtimeOperationsConfig,
    { runtimeInstanceId: runtime.id },
  );
  assert.equal(result.claimed, true);
  assert.match(
    result.output ?? "",
    new RegExp(secretOutput),
    JSON.stringify(result),
  );

  const events = await db
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.taskId, task.id),
        eq(activityEventsTable.type, "approval_resolved"),
      ),
    );
  const durable = JSON.stringify(events);
  assert.doesNotMatch(durable, new RegExp(secretOutput));
  assert.match(durable, /"outputStored":false/);
});

test("failed approved VM action after dispatch never completes its task", async (t) => {
  await dbReady;
  const previousProcessExec = process.env.ALLOW_AGENT_PROCESS_EXEC;
  process.env.ALLOW_AGENT_PROCESS_EXEC = "true";
  t.after(() => {
    if (previousProcessExec === undefined) {
      delete process.env.ALLOW_AGENT_PROCESS_EXEC;
    } else {
      process.env.ALLOW_AGENT_PROCESS_EXEC = previousProcessExec;
    }
  });
  const runtime = await registerRuntimeInstance(
    { role: "combined", schedulerEnabled: true },
    runtimeOperationsConfig,
  );
  t.after(() => runtime.stopHeartbeat());
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approved failure truth agent",
      role: "Test",
      systemPrompt: "Test only",
      permissions: managerPermissionsPreset,
      createdByUser: true,
    })
    .returning();
  const args = { command: "node --definitely-invalid-option" };
  const argsHash = createHash("sha256")
    .update(JSON.stringify(args))
    .digest("hex");
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Approved VM failure",
      brief: "A failed approved side effect must fail closed.",
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
      title: "Approved VM failure",
      description: "Expected failure after process dispatch",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      scope: { toolName: "vm_run_command", argsHash },
      actionPayload: {
        toolName: "vm_run_command",
        args,
        taskDisposition: "complete",
      },
    })
    .returning();

  const result = await executeApprovedAction(
    approval.id,
    runtimeOperationsConfig,
    { runtimeInstanceId: runtime.id },
  );
  assert.equal(result.claimed, true);
  assert.equal(result.status, "failed");

  const [persistedApproval] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, approval.id));
  const [persistedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.ok(persistedApproval.consumedAt, JSON.stringify(result));
  assert.equal(persistedTask.status, "blocked");
  assert.equal(persistedTask.blockedReason, "approval_action_failed");
  assert.equal(persistedTask.completedAt, null);
});

test("approved browser action without immutable affinity remains unclaimed", async (t) => {
  await dbReady;
  const runtime = await registerRuntimeInstance(
    { role: "combined", schedulerEnabled: true },
    runtimeOperationsConfig,
  );
  t.after(() => runtime.stopHeartbeat());
  t.after(() => closeAllSessions());
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Approved browser affinity agent",
      role: "Test",
      systemPrompt: "Test only",
      permissions: managerPermissionsPreset,
      createdByUser: true,
    })
    .returning();
  const args = { ref: 999_999 };
  const argsHash = createHash("sha256")
    .update(JSON.stringify(args))
    .digest("hex");
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Approved browser binding failure",
      brief:
        "Missing browser affinity must fail before capability consumption.",
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
      category: "external_contact",
      title: "Approved browser binding failure",
      description: "Expected pre-effect rejection",
      status: "approved",
      resolvedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      scope: { toolName: "browser_click", argsHash },
      actionPayload: {
        toolName: "browser_click",
        args,
        taskDisposition: "complete",
      },
    })
    .returning();

  const result = await executeApprovedAction(
    approval.id,
    runtimeOperationsConfig,
    { runtimeInstanceId: runtime.id },
  );
  assert.equal(result.claimed, false);
  assert.equal(result.status, "queued");

  const [persistedApproval] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, approval.id));
  const [persistedTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.equal(persistedApproval.consumedAt, null);
  assert.equal(persistedTask.status, "awaiting_approval");
  assert.equal(persistedTask.completedAt, null);
});
