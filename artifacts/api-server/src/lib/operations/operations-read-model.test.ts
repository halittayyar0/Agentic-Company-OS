import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  activityEventsTable,
  agentsTable,
  db,
  dbReady,
  operationInvocationsTable,
  operationReceiptsTable,
  projectMembersTable,
  runtimeHealthSamplesTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
  usageEventsTable,
} from "@workspace/db";

test("project operations is bounded to the root subtree and never projects raw audit text", async () => {
  await dbReady;
  const modulePath = "./operations-read-model";
  const readModel = await import(modulePath).catch(() => null);
  assert.ok(readModel?.getProjectOperations, "getProjectOperations must exist");

  const suffix = randomUUID();
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Ops member ${suffix}`,
      role: "Specialist",
      systemPrompt: "PRIVATE-PROMPT-SENTINEL",
      createdByUser: true,
      status: "working",
      lastActiveAt: new Date("2026-09-01T11:59:00.000Z"),
    })
    .returning();
  assert.ok(agent);
  const [root] = await db
    .insert(tasksTable)
    .values({
      title: `Operations root ${suffix}`,
      brief: "PRIVATE-BRIEF-SENTINEL",
      ownerAgentId: agent.id,
      createdByUser: true,
      status: "in_progress",
    })
    .returning();
  const [child] = await db
    .insert(tasksTable)
    .values({
      title: `Operations child ${suffix}`,
      brief: "Child",
      ownerAgentId: agent.id,
      parentTaskId: root.id,
      status: "in_progress",
      leaseOwner: `lease-${suffix}`,
      leaseExpiresAt: new Date("2026-09-01T12:01:00.000Z"),
      stepAttempts: 1,
    })
    .returning();
  const [otherRoot] = await db
    .insert(tasksTable)
    .values({
      title: `Other project ${suffix}`,
      brief: "OTHER-PROJECT-SECRET",
      ownerAgentId: agent.id,
      createdByUser: true,
    })
    .returning();
  assert.ok(root && child && otherRoot);
  await db.insert(projectMembersTable).values({
    taskId: root.id,
    agentId: agent.id,
    memberRole: "coordinator",
  });
  const runtimeId = `ops-read-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "PRIVATE-HOST-SENTINEL",
    processId: 999,
    buildVersion: "test",
    schedulerEnabled: true,
    lastHeartbeatAt: new Date("2026-09-01T11:59:59.000Z"),
    lastSchedulerTickAt: new Date("2026-09-01T11:59:59.000Z"),
  });
  const attemptId = randomUUID();
  const logicalExecutionId = randomUUID();
  await db.insert(taskAttemptsTable).values({
    id: attemptId,
    taskId: child.id,
    agentId: agent.id,
    workerInstanceId: runtimeId,
    leaseOwner: `lease-${suffix}`,
    attemptNumber: 1,
    cycleNumber: 0,
    state: "running",
    logicalExecutionId,
    startedAt: new Date("2026-08-20T00:00:00.000Z"),
    lastHeartbeatAt: new Date("2026-09-01T11:59:59.000Z"),
    sanitizedError: "PRIVATE-ERROR-SENTINEL",
  });
  const receiptId = randomUUID();
  const operationKey = `op:v1:${suffix.replaceAll("-", "").padEnd(64, "a")}`;
  await db.insert(operationReceiptsTable).values({
    id: receiptId,
    canonicalVersion: 1,
    operationKey,
    executionKind: "task_step",
    logicalExecutionId,
    taskId: child.id,
    agentId: agent.id,
    originAttemptId: attemptId,
    sideEffectClass: "read_only",
    state: "reserved",
    toolName: "vm_read_file",
    argumentHash: "PRIVATE-HASH-SENTINEL",
  });
  await db.insert(operationInvocationsTable).values({
    id: randomUUID(),
    receiptId,
    executionKind: "task_step",
    state: "claimed",
    attemptId,
    workerInstanceId: runtimeId,
    leaseOwner: `PRIVATE-INVOCATION-LEASE-${suffix}`,
    leaseExpiresAt: new Date("2026-09-01T12:01:00.000Z"),
    taskLeaseOwner: `lease-${suffix}`,
    agentLeaseOwner: `lease-${suffix}`,
  });
  await db.insert(usageEventsTable).values({
    agentId: agent.id,
    taskId: child.id,
    kind: "task_step",
    modelId: "test-model",
    provider: "openrouter",
    totalTokens: 123,
    reportedCostUsd: "0.125000",
    createdAt: new Date("2026-09-01T11:55:00.000Z"),
  });
  await db.insert(activityEventsTable).values([
    {
      taskId: child.id,
      agentId: agent.id,
      type: "note",
      summary: "PRIVATE-ACTIVITY-SENTINEL",
      detail: { command: "PRIVATE-COMMAND-SENTINEL" },
    },
    {
      taskId: child.id,
      agentId: agent.id,
      type: "operations_changed",
      summary: "Operational attempt state changed.",
      detail: {
        schemaVersion: 1,
        kind: "attempt_state_changed",
        attemptId,
        state: "running",
      },
    },
    {
      taskId: otherRoot.id,
      agentId: agent.id,
      type: "operations_changed",
      summary: "Operational state changed.",
      detail: {
        schemaVersion: 1,
        kind: "attempt_state_changed",
        attemptId: "OTHER-PROJECT-ATTEMPT",
        state: "failed",
      },
    },
  ]);
  await db.insert(runtimeHealthSamplesTable).values({
    bucketAt: new Date("2026-09-01T11:59:00.000Z"),
    sampledAt: new Date("2026-09-01T12:00:01.000Z"),
    sampledByInstanceId: runtimeId,
    runtimeTruthState: "local_demo",
    providerMetricsCoverage: "partial",
    healthyWorkerCount: 1,
    providerP50LatencyMs: null,
    providerP95LatencyMs: null,
  });

  const snapshot = await readModel.getProjectOperations({
    rootTaskId: root.id,
    now: new Date("2026-09-01T12:00:00.000Z"),
    windowHours: 24,
    workerStaleAfterMs: 15_000,
    schedulerTickMs: 5_000,
  });
  assert.equal(snapshot.rootTask.id, root.id);
  assert.equal(snapshot.runtime.state, "local_demo");
  assert.deepEqual(
    snapshot.attempts.map((attempt: { id: string }) => attempt.id),
    [attemptId],
  );
  assert.deepEqual(
    snapshot.receipts.map((receipt: { id: string }) => receipt.id),
    [receiptId],
  );
  assert.equal(snapshot.receipts[0]?.operationKey, operationKey);
  assert.equal(snapshot.usage.taskTokens, 123);
  assert.equal(snapshot.fleetHealthSamples[0]?.providerP50LatencyMs, null);
  assert.match(snapshot.cursor, /^\d+$/u);

  const serialized = JSON.stringify(snapshot);
  for (const sentinel of [
    "PRIVATE-PROMPT-SENTINEL",
    "PRIVATE-BRIEF-SENTINEL",
    "PRIVATE-HOST-SENTINEL",
    "PRIVATE-ERROR-SENTINEL",
    "PRIVATE-HASH-SENTINEL",
    "PRIVATE-INVOCATION-LEASE",
    "PRIVATE-ACTIVITY-SENTINEL",
    "PRIVATE-COMMAND-SENTINEL",
    "OTHER-PROJECT-ATTEMPT",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(sentinel));
  }

  await assert.rejects(
    readModel.getProjectOperations({
      rootTaskId: child.id,
      now: new Date("2026-09-01T12:00:00.000Z"),
      windowHours: 24,
      workerStaleAfterMs: 15_000,
      schedulerTickMs: 5_000,
    }),
    (error: { name?: string }) => error.name === "OperationsRootRequiredError",
  );
});
