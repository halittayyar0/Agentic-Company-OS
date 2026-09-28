import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  db,
  dbReady,
  defaultAgentPermissions,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { executeTool } from "./execute-tool";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { claimDueTasks } from "./scheduler";
import { startTaskLeaseHeartbeat } from "./task-lease-heartbeat";

test("delegation lifecycle persists real assignment and acceptance actors", async (t) => {
  await dbReady;
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  t.after(() => runtime.stopHeartbeat());
  const parentLease = "delegation-dialogue:parent";
  const [manager] = await db
    .insert(agentsTable)
    .values({
      name: "Dialogue test manager",
      role: "Manager",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: { ...defaultAgentPermissions, canDelegate: true },
      runLeaseOwner: parentLease,
      runLeaseExpiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  const [employee] = await db
    .insert(agentsTable)
    .values({
      name: "Dialogue test employee",
      role: "Employee",
      parentAgentId: manager.id,
      depth: 1,
      systemPrompt: "Test only",
      createdByAgentId: manager.id,
    })
    .returning();
  const [parentTask] = await db
    .insert(tasksTable)
    .values({
      title: "Parent command",
      brief: "Delegate one verified task.",
      ownerAgentId: manager.id,
      status: "in_progress",
      leaseOwner: parentLease,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      stepAttempts: 1,
      createdByUser: true,
    })
    .returning();
  const attemptId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: parentTask.id,
    agentId: manager.id,
    workerInstanceId: runtime.id,
    leaseOwner: parentLease,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "running",
    startedAt: new Date(),
    lastHeartbeatAt: new Date(),
  });
  const heartbeat = startTaskLeaseHeartbeat({
    taskId: parentTask.id,
    agentId: manager.id,
    attemptId,
    leaseOwner: parentLease,
    config,
  });
  t.after(() => heartbeat.stop());

  const delegated = await executeTool(
    {
      agent: manager,
      taskId: parentTask.id,
      taskLeaseOwner: parentLease,
      runtimeAttemptId: attemptId,
      assertTaskLease: (action) => heartbeat.assertOwned(action),
    },
    "delegate_task",
    JSON.stringify({
      agentId: employee.id,
      title: "Verify the market",
      brief: "Return three source-backed findings.",
      priority: "high",
    }),
  );
  assert.match(delegated.content, /devredildi/);

  const [childTask] = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.parentTaskId, parentTask.id),
        eq(tasksTable.ownerAgentId, employee.id),
      ),
    );
  assert.ok(childTask);
  assert.equal(childTask.assignedByAgentId, manager.id);

  const [assignment] = await db
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.taskId, childTask.id),
        eq(activityEventsTable.type, "task_delegated"),
      ),
    );
  assert.ok(assignment);
  assert.deepEqual(assignment.detail, {
    delegationLifecycle: "assigned",
    fromAgentId: manager.id,
    toAgentId: employee.id,
    parentTaskId: parentTask.id,
  });

  await heartbeat.stop();

  await db
    .update(tasksTable)
    .set({ status: "blocked", leaseOwner: null, leaseExpiresAt: null })
    .where(eq(tasksTable.id, parentTask.id));
  await db
    .update(agentsTable)
    .set({
      status: "idle",
      runLeaseOwner: null,
      runLeaseExpiresAt: null,
    })
    .where(eq(agentsTable.id, manager.id));

  const claimed = await claimDueTasks(runtime, config);
  assert.equal(
    claimed.some((task) => task.id === childTask.id),
    true,
  );

  const [acceptance] = await db
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.taskId, childTask.id),
        eq(activityEventsTable.type, "task_status_changed"),
      ),
    );
  assert.ok(acceptance);
  assert.deepEqual(acceptance.detail, {
    status: "in_progress",
    delegationLifecycle: "accepted",
    fromAgentId: employee.id,
    toAgentId: manager.id,
  });
});
