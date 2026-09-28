import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  activityEventsTable,
  agentsTable,
  db,
  dbReady,
  runtimeInstancesTable,
  tasksTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import {
  createTaskAttempt,
  transitionTaskAttempt,
} from "../orchestrator/task-attempt-store";

test("attempt creation and material transitions append cursor events in their transaction", async () => {
  await dbReady;
  const suffix = randomUUID();
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Ops attempt ${suffix}`,
      role: "Specialist",
      systemPrompt: "Test fixture",
      createdByUser: true,
    })
    .returning();
  assert.ok(agent);
  const leaseOwner = `lease-${suffix}`;
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Ops attempt ${suffix}`,
      brief: "Verify durable invalidation evidence.",
      ownerAgentId: agent.id,
      createdByUser: true,
      status: "in_progress",
      leaseOwner,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      stepAttempts: 1,
    })
    .returning();
  assert.ok(task);
  const runtimeId = `ops-attempt-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "test-host",
    processId: 1,
    buildVersion: "test",
    schedulerEnabled: true,
  });

  const attempt = await createTaskAttempt({
    task: { ...task, leaseOwner },
    workerInstanceId: runtimeId,
  });
  const running = await transitionTaskAttempt({
    attemptId: attempt.id,
    taskId: task.id,
    agentId: agent.id,
    leaseOwner,
    from: ["claimed"],
    state: "running",
  });
  assert.equal(running?.state, "running");

  const events = await db
    .select({ detail: activityEventsTable.detail })
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.taskId, task.id),
        eq(activityEventsTable.type, "operations_changed"),
      ),
    )
    .orderBy(asc(activityEventsTable.id));
  assert.deepEqual(
    events.map((event) => event.detail),
    [
      {
        schemaVersion: 1,
        kind: "attempt_created",
        attemptId: attempt.id,
        runtimeInstanceId: runtimeId,
        state: "claimed",
      },
      {
        schemaVersion: 1,
        kind: "attempt_state_changed",
        attemptId: attempt.id,
        state: "running",
      },
    ],
  );
});
