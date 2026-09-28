import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  activityEventsTable,
  databaseBackend,
  db,
  dbReady,
  runtimeHealthSamplesTable,
  runtimeInstancesTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { RuntimeInstanceHandle } from "../orchestrator/runtime-instance-registry";
import { readRuntimeOperationsConfig } from "../runtime-operations-config";

test("sampler targets only the last completed UTC minute", async () => {
  const modulePath = "./operations-sampler";
  const sampler = await import(modulePath).catch(() => null);
  assert.ok(
    sampler?.completedOperationsMinute,
    "completedOperationsMinute must exist",
  );
  assert.equal(
    sampler
      .completedOperationsMinute(new Date("2026-09-01T12:35:00.000Z"))
      .toISOString(),
    "2026-09-01T12:34:00.000Z",
  );
  assert.equal(
    sampler
      .completedOperationsMinute(new Date("2026-09-01T12:35:59.999Z"))
      .toISOString(),
    "2026-09-01T12:34:00.000Z",
  );
});

test("database ownership records one sample and one safe event per bucket", async () => {
  await dbReady;
  const sampler = await import("./operations-sampler");
  const suffix = randomUUID();
  const runtimeId = `sampler-${suffix}`;
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "sampler-private-host",
    processId: 321,
    buildVersion: "test",
    schedulerEnabled: true,
    startedAt: new Date("2026-09-01T12:00:00.000Z"),
    lastHeartbeatAt: new Date("2026-09-01T12:35:00.000Z"),
    lastSchedulerTickAt: new Date("2026-09-01T12:35:00.000Z"),
  });
  const now = new Date("2026-09-01T12:35:01.000Z");
  const config = readRuntimeOperationsConfig({
    RUNTIME_ROLE: "worker",
    OPS_SAMPLE_RETENTION_DAYS: "3650",
  });

  assert.equal(
    await sampler.recordOperationsHealthSample({
      runtimeInstanceId: runtimeId,
      now,
      config,
    }),
    true,
  );
  assert.equal(
    await sampler.recordOperationsHealthSample({
      runtimeInstanceId: runtimeId,
      now: new Date(now.getTime() + 10_000),
      config,
    }),
    false,
  );

  const bucketAt = new Date("2026-09-01T12:34:00.000Z");
  const samples = await db
    .select()
    .from(runtimeHealthSamplesTable)
    .where(eq(runtimeHealthSamplesTable.bucketAt, bucketAt));
  assert.equal(samples.length, 1);
  assert.equal(samples[0]?.sampledByInstanceId, runtimeId);
  assert.equal(samples[0]?.providerMetricsCoverage, "partial");
  assert.equal(samples[0]?.providerP50LatencyMs, null);
  assert.equal(samples[0]?.providerP95LatencyMs, null);

  const events = await db
    .select()
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.type, "operations_changed"),
        eq(activityEventsTable.summary, "Operational health sample recorded."),
      ),
    );
  assert.equal(
    events.filter(
      (event) =>
        (event.detail as { bucketAt?: string } | null)?.bucketAt ===
        bucketAt.toISOString(),
    ).length,
    1,
  );
});

test("sampler conservatively backfills missed completed minutes as offline", async () => {
  await dbReady;
  const sampler = await import("./operations-sampler");
  const suffix = randomUUID();
  const runtimeId = `sampler-gap-${suffix}`;
  const base = new Date(
    Date.UTC(2042, 0, 1) +
      (Number.parseInt(suffix.slice(0, 8), 16) % 500_000) * 60_000,
  );
  await db.insert(runtimeInstancesTable).values({
    id: runtimeId,
    role: "worker",
    state: "healthy",
    hostname: "sampler-gap-test",
    processId: 322,
    buildVersion: "test",
    schedulerEnabled: true,
    startedAt: new Date(base.getTime() - 60_000),
    lastHeartbeatAt: base,
    lastSchedulerTickAt: base,
  });
  const config = readRuntimeOperationsConfig({
    RUNTIME_ROLE: "worker",
    OPS_SAMPLE_RETENTION_DAYS: "3650",
  });

  await sampler.recordOperationsHealthSample({
    runtimeInstanceId: runtimeId,
    now: new Date(base.getTime() + 60_001),
    config,
  });
  const recoveredAt = new Date(base.getTime() + 4 * 60_000 + 1);
  await sampler.recordOperationsHealthSample({
    runtimeInstanceId: runtimeId,
    now: recoveredAt,
    config,
  });

  const samples = await db
    .select()
    .from(runtimeHealthSamplesTable)
    .where(
      and(
        sql`${runtimeHealthSamplesTable.bucketAt} >= ${base}`,
        sql`${runtimeHealthSamplesTable.bucketAt} < ${new Date(base.getTime() + 4 * 60_000)}`,
      ),
    );
  assert.equal(samples.length, 4);
  const byBucket = new Map(
    samples.map((sample) => [sample.bucketAt.toISOString(), sample]),
  );
  for (const minute of [1, 2]) {
    const bucket = new Date(base.getTime() + minute * 60_000).toISOString();
    assert.equal(byBucket.get(bucket)?.runtimeTruthState, "offline");
    assert.equal(
      byBucket.get(bucket)?.sampledAt?.toISOString(),
      recoveredAt.toISOString(),
    );
    assert.equal(byBucket.get(bucket)?.sampledByInstanceId, runtimeId);
  }
});

test(
  "PostgreSQL advisory ownership serializes competing worker replicas",
  { skip: databaseBackend !== "postgresql" },
  async () => {
    await dbReady;
    const sampler = await import("./operations-sampler");
    const suffix = randomUUID();
    const bucketOffset = Number.parseInt(suffix.slice(0, 8), 16) % 500_000;
    const bucketAt = new Date(Date.UTC(2040, 0, 1) + bucketOffset * 60_000);
    const now = new Date(bucketAt.getTime() + 60_001);
    const runtimeIds = [`sampler-a-${suffix}`, `sampler-b-${suffix}`];
    await db.insert(runtimeInstancesTable).values(
      runtimeIds.map((id) => ({
        id,
        role: "worker" as const,
        state: "healthy" as const,
        hostname: "redacted-test-host",
        processId: 321,
        buildVersion: "test",
        schedulerEnabled: true,
        startedAt: new Date(now.getTime() - 60_000),
        lastHeartbeatAt: now,
        lastSchedulerTickAt: now,
      })),
    );
    const config = readRuntimeOperationsConfig({
      RUNTIME_ROLE: "worker",
      OPS_SAMPLE_RETENTION_DAYS: "3650",
    });

    const results = await Promise.all(
      runtimeIds.map((runtimeInstanceId) =>
        sampler.recordOperationsHealthSample({
          runtimeInstanceId,
          now,
          config,
        }),
      ),
    );
    assert.equal(results.filter((result) => result).length, 1);
    assert.equal(results.filter((result) => !result).length, 1);

    const samples = await db
      .select({
        sampledByInstanceId: runtimeHealthSamplesTable.sampledByInstanceId,
      })
      .from(runtimeHealthSamplesTable)
      .where(eq(runtimeHealthSamplesTable.bucketAt, bucketAt));
    assert.equal(samples.length, 1);
    assert.ok(runtimeIds.includes(samples[0]?.sampledByInstanceId ?? ""));

    const events = await db
      .select({ id: activityEventsTable.id })
      .from(activityEventsTable)
      .where(
        and(
          eq(activityEventsTable.type, "operations_changed"),
          eq(
            activityEventsTable.summary,
            "Operational health sample recorded.",
          ),
          eq(
            sql`${activityEventsTable.detail} ->> 'bucketAt'`,
            bucketAt.toISOString(),
          ),
        ),
      );
    assert.equal(events.length, 1);
  },
);

test("API roles never schedule samples and worker triggers are serialized", async () => {
  const sampler = await import("./operations-sampler");
  const runtime: RuntimeInstanceHandle = {
    id: "sampler-controller-test",
    startedAt: new Date(),
    stopHeartbeat: async () => undefined,
  };
  let workerCalls = 0;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const worker = sampler.startOperationsHealthSampler(
    runtime,
    readRuntimeOperationsConfig({ RUNTIME_ROLE: "worker" }),
    {
      autoTrigger: false,
      recordSample: async () => {
        workerCalls += 1;
        if (workerCalls === 1) await firstGate;
        return true;
      },
    },
  );
  const first = worker.trigger();
  const second = worker.trigger();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(workerCalls, 1);
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(
    workerCalls,
    2,
    "overlapping ticks coalesce to one follow-up sample",
  );
  await worker.stop();

  let apiCalls = 0;
  const api = sampler.startOperationsHealthSampler(
    runtime,
    readRuntimeOperationsConfig({
      RUNTIME_ROLE: "api",
      DATABASE_URL: "postgresql://unused/unused",
    }),
    {
      recordSample: async () => {
        apiCalls += 1;
        return true;
      },
    },
  );
  await api.trigger();
  await api.stop();
  assert.equal(api.started, false);
  assert.equal(apiCalls, 0);
});
