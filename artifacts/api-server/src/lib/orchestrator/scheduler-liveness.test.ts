import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  runtimeInstancesTable,
  tasksTable,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import { registerRuntimeInstance } from "./runtime-instance-registry";
import { startScheduler, stopScheduler } from "./scheduler";

test("scheduler polling stays live during an owned task wait and stops on drain", async () => {
  await dbReady;
  const config = {
    ...readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" }),
    schedulerTickMs: 20,
  };
  const runtime = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    config,
  );
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Liveness test",
      role: "Test",
      systemPrompt: "Test",
      createdByUser: true,
    })
    .returning();
  await db.insert(tasksTable).values({
    title: "Wait for a provider",
    brief: "The scheduler must remain observable while an owned task waits.",
    ownerAgentId: agent.id,
    status: "pending",
    createdByUser: true,
  });
  let release!: () => void;
  let started!: () => void;
  let admit!: () => void;
  let owned!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const admission = new Promise<void>((resolve) => {
    admit = resolve;
  });
  const ownership = new Promise<void>((resolve) => {
    owned = resolve;
  });
  let calls = 0;
  const lastTick = async () => {
    const [row] = await db
      .select({ tick: runtimeInstancesTable.lastSchedulerTickAt })
      .from(runtimeInstancesTable)
      .where(eq(runtimeInstancesTable.id, runtime.id));
    return row.tick?.getTime() ?? 0;
  };
  try {
    startScheduler(runtime, config, {
      runClaimedTask: async (_task, lifecycle) => {
        calls += 1;
        started();
        await admission;
        lifecycle.afterInitialLeaseHeartbeat();
        owned();
        await waiting;
      },
    });
    await Promise.race([
      entered,
      delay(3_000).then(() => {
        throw new Error("Task did not start");
      }),
    ]);
    const unownedTick = await lastTick();
    await delay(100);
    assert.equal(
      await lastTick(),
      unownedTick,
      "blocked initial lease admission must not be reported as healthy polling",
    );
    admit();
    await ownership;
    const before = await lastTick();
    await delay(100);
    assert.ok(
      (await lastTick()) > before,
      "an active owned provider wait must not freeze scheduler liveness",
    );
    assert.equal(
      calls,
      1,
      "liveness updates must not start overlapping task batches",
    );
    const draining = stopScheduler();
    await delay(60);
    const drainedTick = await lastTick();
    await delay(60);
    assert.equal(
      await lastTick(),
      drainedTick,
      "draining must stop scheduler liveness updates",
    );
    release();
    await draining;
  } finally {
    admit();
    release();
    await stopScheduler();
    await runtime.stopHeartbeat();
  }
});
