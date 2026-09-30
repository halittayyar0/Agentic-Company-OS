import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  closeDatabase,
  db,
  dbReady,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
} from "@workspace/db";
import { wakeProviderWaitingTasks } from "./wake-provider-waiting-tasks";
import { readTaskSpendAdmission } from "./task-spend-admission";

test("saving a provider wakes only unleased tasks whose latest attempt needs setup", async (t) => {
  await dbReady;
  t.after(() => closeDatabase());
  const [worker] = await db
    .insert(runtimeInstancesTable)
    .values({
      id: randomUUID(),
      role: "worker",
      state: "healthy",
      hostname: "test-worker",
      processId: 1,
      buildVersion: "test",
    })
    .returning();
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: "Wake test", role: "Test", systemPrompt: "Test" })
    .returning();
  const later = new Date(Date.now() + 15 * 60_000);
  const now = new Date();
  const task = async (
    failureKind: string,
    options: { leased?: boolean; staleAttempt?: boolean } = {},
  ) => {
    const [created] = await db
      .insert(tasksTable)
      .values({
        title: "Pending project",
        brief: "Wait for a model",
        ownerAgentId: agent.id,
        status: "pending",
        stepAttempts: options.staleAttempt ? 2 : 1,
        nextAttemptAt: later,
        ...(options.leased
          ? { leaseOwner: "other-worker", leaseExpiresAt: later }
          : {}),
      })
      .returning();
    await db.insert(taskAttemptsTable).values({
      id: randomUUID(),
      taskId: created.id,
      agentId: agent.id,
      workerInstanceId: worker.id,
      leaseOwner: "old-worker",
      attemptNumber: 1,
      cycleNumber: 0,
      state: "retrying",
      failureKind,
    });
    return created.id;
  };
  const waitingId = await task("provider_setup_required");
  const outageId = await task("model_routes_exhausted");
  const staleId = await task("provider_setup_required", { staleAttempt: true });
  const leasedId = await task("provider_setup_required", { leased: true });

  const [waitingTask] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, waitingId));
  const admission = await readTaskSpendAdmission(
    waitingTask,
    { maxSteps: 1, maxTokens: 100, maxReportedCostUsd: 100 },
    "en",
  );
  assert.equal(admission.reason, null);

  assert.equal(await wakeProviderWaitingTasks(now), 1);
  const readDue = async (id: number) => {
    const [row] = await db
      .select({ nextAttemptAt: tasksTable.nextAttemptAt })
      .from(tasksTable)
      .where(eq(tasksTable.id, id));
    return row.nextAttemptAt?.getTime();
  };
  assert.equal(await readDue(waitingId), now.getTime());
  for (const id of [outageId, staleId, leasedId])
    assert.equal(await readDue(id), later.getTime());
  assert.equal(await wakeProviderWaitingTasks(now), 0);
});
