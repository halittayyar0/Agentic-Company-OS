import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { agentsTable, db, dbReady, tasksTable } from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { claimDueTasks } from "./scheduler";

test("a parent sleeps without model work while its child is pending, then resumes", async (t) => {
  await dbReady;
  const config = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  t.after(() => runtime.stopHeartbeat());
  const [owner, specialist] = await db
    .insert(agentsTable)
    .values([
      { name: "Owner", role: "Test", systemPrompt: "Test" },
      { name: "Specialist", role: "Test", systemPrompt: "Test" },
    ])
    .returning();
  const [parent] = await db
    .insert(tasksTable)
    .values({
      ownerAgentId: owner.id,
      title: "Parent",
      brief: "Integrate child",
    })
    .returning();
  const [child] = await db
    .insert(tasksTable)
    .values({
      ownerAgentId: specialist.id,
      parentTaskId: parent.id,
      title: "Child",
      brief: "Deliver result",
      nextAttemptAt: new Date(Date.now() + 3600000),
    })
    .returning();
  assert.deepEqual(await claimDueTasks(runtime, config), []);
  await db
    .update(tasksTable)
    .set({
      status: "completed",
      completedAt: new Date(),
      resultSummary: "Verified result",
    })
    .where(eq(tasksTable.id, child.id));
  const claimed = await claimDueTasks(runtime, config);
  assert.deepEqual(
    claimed.map((task) => task.id),
    [parent.id],
  );
});
