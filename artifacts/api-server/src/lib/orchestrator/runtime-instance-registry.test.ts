import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  activityEventsTable,
  db,
  dbReady,
  runtimeInstancesTable,
  type RuntimeInstance,
} from "@workspace/db";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";
import {
  heartbeatRuntimeInstance,
  markRuntimeDraining,
  markRuntimeStopped,
  markStaleRuntimeInstances,
  registerRuntimeInstance,
  type RuntimeInstanceHandle,
} from "./runtime-instance-registry";

type TimerCallback = () => void | Promise<void>;

interface ManualTimer {
  callback: TimerCallback;
  delayMs: number;
  cleared: boolean;
  fired: boolean;
  unrefCalled: boolean;
  unref(): ManualTimer;
}

function createManualRuntime(initialNow: Date) {
  let currentTimeMs = initialNow.getTime();
  const timers: ManualTimer[] = [];
  const runtime = {
    now: () => new Date(currentTimeMs),
    setTimeout(callback: TimerCallback, delayMs: number): ManualTimer {
      const timer: ManualTimer = {
        callback,
        delayMs,
        cleared: false,
        fired: false,
        unrefCalled: false,
        unref() {
          timer.unrefCalled = true;
          return timer;
        },
      };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer: ManualTimer): void {
      timer.cleared = true;
    },
  };

  return {
    runtime,
    timers,
    advanceBy(ms: number): void {
      currentTimeMs += ms;
    },
    beginNext(): { timer: ManualTimer; completion: Promise<void> } {
      const timer = timers.find((candidate) => {
        return !candidate.cleared && !candidate.fired;
      });
      assert.ok(timer, "expected a pending heartbeat timer");
      timer.fired = true;
      currentTimeMs += timer.delayMs;
      return {
        timer,
        completion: Promise.resolve(timer.callback()).then(() => undefined),
      };
    },
    async fireNext(): Promise<ManualTimer> {
      const { timer, completion } = this.beginNext();
      await completion;
      return timer;
    },
    pendingTimers(): ManualTimer[] {
      return timers.filter((timer) => !timer.cleared && !timer.fired);
    },
  };
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function forgeHandle(id: string, startedAt: Date): RuntimeInstanceHandle {
  return {
    id,
    startedAt: new Date(startedAt),
    stopHeartbeat: async () => undefined,
  };
}

async function readInstance(id: string): Promise<RuntimeInstance> {
  const [row] = await db
    .select()
    .from(runtimeInstancesTable)
    .where(eq(runtimeInstancesTable.id, id));
  assert.ok(row, `runtime instance ${id} should exist`);
  return row;
}

async function deleteInstances(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .delete(runtimeInstancesTable)
    .where(inArray(runtimeInstancesTable.id, ids));
}

const workerConfig = readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" });

test("rejects scheduler settings that contradict a dedicated runtime role", async (t) => {
  await dbReady;
  const clock = createManualRuntime(new Date("2026-09-01T07:00:00.000Z"));
  const buildVersion = `registry-role-test-${randomUUID()}`;
  t.after(async () => {
    await db
      .delete(runtimeInstancesTable)
      .where(eq(runtimeInstancesTable.buildVersion, buildVersion));
  });

  const invalidCases = [
    {
      role: "api" as const,
      schedulerEnabled: true,
      config: readRuntimeOperationsConfig({ RUNTIME_ROLE: "api" }),
    },
    {
      role: "worker" as const,
      schedulerEnabled: false,
      config: workerConfig,
    },
  ];
  for (const invalid of invalidCases) {
    await assert.rejects(
      registerRuntimeInstance(
        {
          role: invalid.role,
          schedulerEnabled: invalid.schedulerEnabled,
          buildVersion,
        },
        invalid.config,
        clock.runtime,
      ),
      /schedulerEnabled/,
    );
  }

  const combinedConfig = readRuntimeOperationsConfig({
    RUNTIME_ROLE: "combined",
  });
  for (const schedulerEnabled of [false, true]) {
    const handle = await registerRuntimeInstance(
      {
        role: "combined",
        schedulerEnabled,
        buildVersion,
      },
      combinedConfig,
      clock.runtime,
    );
    await handle.stopHeartbeat();
    assert.equal(
      (await readInstance(handle.id)).schedulerEnabled,
      schedulerEnabled,
    );
  }
});

test("registers a secure process identity and owns an unref'd five-second heartbeat", async (t) => {
  await dbReady;
  const clock = createManualRuntime(new Date("2026-09-01T08:00:00.000Z"));
  const handle = await registerRuntimeInstance(
    {
      role: "worker",
      schedulerEnabled: true,
      capabilities: { scheduler: true },
    },
    workerConfig,
    clock.runtime,
  );
  t.after(async () => {
    await handle.stopHeartbeat();
    await deleteInstances([handle.id]);
  });

  const registered = await readInstance(handle.id);
  assert.match(
    handle.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(registered.role, "worker");
  assert.equal(registered.state, "starting");
  assert.equal(
    registered.hostname,
    hostname().trim().toLowerCase() || "unknown-host",
  );
  assert.equal(registered.processId, process.pid);
  assert.equal(
    registered.buildVersion,
    process.env.BUILD_VERSION?.trim() ||
      process.env.GIT_COMMIT_SHA?.trim() ||
      process.env.npm_package_version?.trim() ||
      "development",
  );
  assert.deepEqual(registered.capabilities, { scheduler: true });
  assert.equal(registered.schedulerEnabled, true);
  assert.equal(registered.startedAt.getTime(), handle.startedAt.getTime());
  assert.equal(
    registered.lastHeartbeatAt.getTime(),
    handle.startedAt.getTime(),
  );
  assert.equal(clock.timers.length, 1);
  assert.equal(clock.timers[0]?.delayMs, 5_000);
  assert.equal(clock.timers[0]?.unrefCalled, true);

  await clock.fireNext();
  const healthy = await readInstance(handle.id);
  assert.equal(healthy.state, "healthy");
  assert.equal(
    healthy.lastHeartbeatAt.getTime(),
    new Date("2026-09-01T08:00:05.000Z").getTime(),
  );
  assert.equal(clock.timers.length, 2);
  assert.equal(clock.timers[1]?.delayMs, 5_000);
  assert.equal(clock.timers[1]?.unrefCalled, true);
  const operationsEvents = await db
    .select({ detail: activityEventsTable.detail })
    .from(activityEventsTable)
    .where(eq(activityEventsTable.type, "operations_changed"));
  assert.deepEqual(
    operationsEvents
      .map((event) => event.detail)
      .filter(
        (detail) =>
          (detail as { runtimeInstanceId?: string } | null)
            ?.runtimeInstanceId === handle.id,
      ),
    [
      {
        schemaVersion: 1,
        kind: "runtime_registered",
        runtimeInstanceId: handle.id,
        state: "starting",
      },
      {
        schemaVersion: 1,
        kind: "runtime_state_changed",
        runtimeInstanceId: handle.id,
        state: "healthy",
      },
    ],
  );

  const scheduledBeforeStop = clock.timers[1];
  assert.ok(scheduledBeforeStop);
  await Promise.all([handle.stopHeartbeat(), handle.stopHeartbeat()]);
  assert.equal(scheduledBeforeStop.cleared, true);
  assert.equal(clock.pendingTimers().length, 0);

  await scheduledBeforeStop.callback();
  const afterStoppedCallback = await readInstance(handle.id);
  assert.equal(
    afterStoppedCallback.lastHeartbeatAt.getTime(),
    healthy.lastHeartbeatAt.getTime(),
  );
  assert.equal(clock.timers.length, 2);
});

test("stopHeartbeat waits for an in-flight heartbeat write", async (t) => {
  await dbReady;
  const clock = createManualRuntime(new Date("2026-09-01T08:30:00.000Z"));
  const handle = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    workerConfig,
    clock.runtime,
  );
  t.after(() => deleteInstances([handle.id]));

  const order: string[] = [];
  const { completion } = clock.beginNext();
  const heartbeatCompleted = completion.then(() => {
    order.push("heartbeat");
  });
  const stopped = handle.stopHeartbeat().then(() => {
    order.push("stop");
  });
  await Promise.all([heartbeatCompleted, stopped, handle.stopHeartbeat()]);

  assert.deepEqual(order, ["heartbeat", "stop"]);
  const row = await readInstance(handle.id);
  assert.equal(row.state, "healthy");
  assert.equal(
    row.lastHeartbeatAt.getTime(),
    new Date("2026-09-01T08:30:05.000Z").getTime(),
  );
  assert.equal(clock.pendingTimers().length, 0);
});

test("a rejected heartbeat write is observed without a derived unhandled rejection", async (t) => {
  await dbReady;
  const clock = createManualRuntime(new Date("2026-09-01T08:45:00.000Z"));
  const handle = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    workerConfig,
    clock.runtime,
  );
  const writeFailure = new Error("simulated heartbeat database outage");
  const mutableDb = db as typeof db & {
    transaction: typeof db.transaction;
  };
  const originalTransaction = mutableDb.transaction;
  const unhandledReasons: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    unhandledReasons.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  mutableDb.transaction = (() => {
    throw writeFailure;
  }) as typeof db.transaction;
  t.after(async () => {
    mutableDb.transaction = originalTransaction;
    process.off("unhandledRejection", onUnhandledRejection);
    await handle.stopHeartbeat();
    await deleteInstances([handle.id]);
  });

  await assert.rejects(heartbeatRuntimeInstance(handle), writeFailure);
  await clock.fireNext();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(unhandledReasons, []);
  assert.equal(
    clock.pendingTimers().length,
    1,
    "a transient write rejection must retain normal retry scheduling",
  );
});

test("draining and stopped timestamps are owner-matched and remain terminal", async (t) => {
  await dbReady;
  const clock = createManualRuntime(new Date("2026-09-01T09:00:00.000Z"));
  const handle = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    workerConfig,
    clock.runtime,
  );
  t.after(() => deleteInstances([handle.id]));

  await clock.fireNext();
  clock.advanceBy(1_000);
  assert.equal(await markRuntimeDraining(handle), true);
  const draining = await readInstance(handle.id);
  assert.equal(draining.state, "draining");
  assert.equal(
    draining.drainingAt?.getTime(),
    new Date("2026-09-01T09:00:06.000Z").getTime(),
  );
  assert.equal(draining.stoppedAt, null);
  assert.equal(
    clock.pendingTimers().length,
    1,
    "draining retains its heartbeat while already-owned work settles",
  );
  assert.equal(await heartbeatRuntimeInstance(handle), true);
  assert.equal((await readInstance(handle.id)).state, "draining");

  clock.advanceBy(1_000);
  assert.equal(await markRuntimeStopped(handle), true);
  const stopped = await readInstance(handle.id);
  assert.equal(stopped.state, "stopped");
  assert.equal(clock.pendingTimers().length, 0);
  assert.equal(
    stopped.stoppedAt?.getTime(),
    new Date("2026-09-01T09:00:07.000Z").getTime(),
  );

  assert.equal(await markRuntimeDraining(handle), false);
  assert.equal(await markRuntimeStopped(handle), false);
  assert.equal(await heartbeatRuntimeInstance(handle), false);
  const stillStopped = await readInstance(handle.id);
  assert.equal(stillStopped.stoppedAt?.getTime(), stopped.stoppedAt?.getTime());
});

test("an old handle cannot mutate a newer row that reused its instance id", async (t) => {
  await dbReady;
  const clock = createManualRuntime(new Date("2026-09-01T10:00:00.000Z"));
  const handle = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    workerConfig,
    clock.runtime,
  );
  await handle.stopHeartbeat();
  t.after(() => deleteInstances([handle.id]));

  const replacementStartedAt = new Date("2026-09-01T10:01:00.000Z");
  await db
    .update(runtimeInstancesTable)
    .set({
      state: "healthy",
      startedAt: replacementStartedAt,
      lastHeartbeatAt: replacementStartedAt,
      drainingAt: null,
      stoppedAt: null,
    })
    .where(eq(runtimeInstancesTable.id, handle.id));

  assert.equal(await heartbeatRuntimeInstance(handle), false);
  assert.equal(await markRuntimeDraining(handle), false);
  assert.equal(await markRuntimeStopped(handle), false);
  const replacement = await readInstance(handle.id);
  assert.equal(replacement.state, "healthy");
  assert.equal(replacement.startedAt.getTime(), replacementStartedAt.getTime());
  assert.equal(replacement.drainingAt, null);
  assert.equal(replacement.stoppedAt, null);
});

test("structurally forged handles cannot mutate a current owned row", async (t) => {
  await dbReady;
  const clock = createManualRuntime(new Date("2026-09-01T10:30:00.000Z"));
  const handle = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    workerConfig,
    clock.runtime,
  );
  t.after(async () => {
    await handle.stopHeartbeat();
    await deleteInstances([handle.id]);
  });

  const forged = forgeHandle(handle.id, handle.startedAt);
  assert.equal(await heartbeatRuntimeInstance(forged), false);
  assert.equal(await markRuntimeDraining(forged), false);
  assert.equal(await markRuntimeStopped(forged), false);
  assert.equal((await readInstance(handle.id)).state, "starting");
});

test("a forged handle matching a replacement row still fails closed", async (t) => {
  await dbReady;
  const clock = createManualRuntime(new Date("2026-09-01T11:00:00.000Z"));
  const handle = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    workerConfig,
    clock.runtime,
  );
  await handle.stopHeartbeat();
  t.after(() => deleteInstances([handle.id]));

  const replacementStartedAt = new Date("2026-09-01T11:01:00.000Z");
  await db
    .update(runtimeInstancesTable)
    .set({
      state: "healthy",
      startedAt: replacementStartedAt,
      lastHeartbeatAt: replacementStartedAt,
    })
    .where(eq(runtimeInstancesTable.id, handle.id));

  const forged = forgeHandle(handle.id, replacementStartedAt);
  assert.equal(await heartbeatRuntimeInstance(forged), false);
  assert.equal(await markRuntimeDraining(forged), false);
  assert.equal(await markRuntimeStopped(forged), false);
  const replacement = await readInstance(handle.id);
  assert.equal(replacement.state, "healthy");
  assert.equal(replacement.startedAt.getTime(), replacementStartedAt.getTime());
});

test("heartbeat ownership loss clears local scheduling permanently", async (t) => {
  await dbReady;
  const clock = createManualRuntime(new Date("2026-09-01T11:30:00.000Z"));
  const handle = await registerRuntimeInstance(
    { role: "worker", schedulerEnabled: true },
    workerConfig,
    clock.runtime,
  );
  t.after(() => deleteInstances([handle.id]));

  const replacementStartedAt = new Date("2026-09-01T11:31:00.000Z");
  await db
    .update(runtimeInstancesTable)
    .set({
      state: "healthy",
      startedAt: replacementStartedAt,
      lastHeartbeatAt: replacementStartedAt,
    })
    .where(eq(runtimeInstancesTable.id, handle.id));

  const firedTimer = await clock.fireNext();
  assert.equal(clock.pendingTimers().length, 0);
  const timerCountAfterOwnershipLoss = clock.timers.length;
  await firedTimer.callback();
  assert.equal(clock.timers.length, timerCountAfterOwnershipLoss);
  await Promise.all([handle.stopHeartbeat(), handle.stopHeartbeat()]);
});

test("stale marking respects the threshold, excludes terminal rows, and compare-and-sets the selected owner", async (t) => {
  await dbReady;
  const now = new Date("2026-09-01T12:00:00.000Z");
  const clock = createManualRuntime(now);
  const ids = {
    healthyStale: randomUUID(),
    startingStale: randomUUID(),
    healthyFresh: randomUUID(),
    draining: randomUUID(),
    stale: randomUUID(),
    stopped: randomUUID(),
    replaced: randomUUID(),
  };
  t.after(() => deleteInstances(Object.values(ids)));

  const common = {
    role: "worker" as const,
    hostname: "registry-test",
    processId: process.pid,
    buildVersion: "test",
    schedulerEnabled: true,
  };
  await db.insert(runtimeInstancesTable).values([
    {
      ...common,
      id: ids.healthyStale,
      state: "healthy",
      startedAt: new Date("2026-09-01T11:00:00.000Z"),
      lastHeartbeatAt: new Date("2026-09-01T11:59:44.999Z"),
    },
    {
      ...common,
      id: ids.startingStale,
      state: "starting",
      startedAt: new Date("2026-09-01T11:30:00.000Z"),
      lastHeartbeatAt: new Date("2026-09-01T11:59:44.999Z"),
    },
    {
      ...common,
      id: ids.healthyFresh,
      state: "healthy",
      startedAt: new Date("2026-09-01T11:30:00.000Z"),
      lastHeartbeatAt: new Date("2026-09-01T11:59:45.001Z"),
    },
    ...(["draining", "stale", "stopped"] as const).map((state) => ({
      ...common,
      id: ids[state],
      state,
      startedAt: new Date("2026-09-01T11:00:00.000Z"),
      lastHeartbeatAt: new Date("2026-09-01T11:59:00.000Z"),
      drainingAt:
        state === "draining" ? new Date("2026-09-01T11:59:30.000Z") : null,
      stoppedAt:
        state === "stopped" ? new Date("2026-09-01T11:59:30.000Z") : null,
    })),
    {
      ...common,
      id: ids.replaced,
      state: "healthy",
      startedAt: new Date("2026-09-01T10:00:00.000Z"),
      lastHeartbeatAt: new Date("2026-09-01T11:58:00.000Z"),
    },
  ]);

  const selected = createDeferred<void>();
  const resumeMutation = createDeferred<void>();
  const marking = markStaleRuntimeInstances(workerConfig, {
    now: clock.runtime.now,
    async afterStaleCandidatesSelected(
      candidates: ReadonlyArray<{
        id: string;
        startedAt: Date;
      }>,
    ) {
      const replacementCandidate = candidates.find(
        (candidate) => candidate.id === ids.replaced,
      );
      assert.equal(
        replacementCandidate?.startedAt.getTime(),
        new Date("2026-09-01T10:00:00.000Z").getTime(),
      );
      selected.resolve();
      await resumeMutation.promise;
    },
  });
  const selectionWonRace = await Promise.race([
    selected.promise.then(() => true),
    marking.then(() => false),
  ]);
  assert.equal(
    selectionWonRace,
    true,
    "stale marking must expose the selected candidates before CAS mutation",
  );
  const replacementStartedAt = new Date("2026-09-01T11:30:00.000Z");
  try {
    await db
      .update(runtimeInstancesTable)
      .set({
        state: "healthy",
        startedAt: replacementStartedAt,
        lastHeartbeatAt: new Date("2026-09-01T11:59:30.000Z"),
      })
      .where(eq(runtimeInstancesTable.id, ids.replaced));
  } finally {
    resumeMutation.resolve();
  }
  const markedCount = await marking;

  const rows = await db
    .select()
    .from(runtimeInstancesTable)
    .where(
      and(
        inArray(runtimeInstancesTable.id, Object.values(ids)),
        inArray(runtimeInstancesTable.state, [
          "starting",
          "healthy",
          "draining",
          "stale",
          "stopped",
        ]),
      ),
    );
  const states = Object.fromEntries(rows.map((row) => [row.id, row.state]));
  assert.equal(markedCount, 2);
  assert.equal(states[ids.healthyStale], "stale");
  assert.equal(states[ids.startingStale], "stale");
  assert.equal(states[ids.healthyFresh], "healthy");
  assert.equal(states[ids.draining], "draining");
  assert.equal(states[ids.stale], "stale");
  assert.equal(states[ids.stopped], "stopped");
  assert.equal(states[ids.replaced], "healthy");
  const replacement = rows.find((row) => row.id === ids.replaced);
  assert.equal(
    replacement?.startedAt.getTime(),
    replacementStartedAt.getTime(),
  );
});
