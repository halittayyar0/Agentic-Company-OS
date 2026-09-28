import {
  agentsTable,
  databaseBackend,
  db,
  runtimeControlsTable,
  runtimeHealthSamplesTable,
  runtimeInstancesTable,
  taskAttemptsTable,
  tasksTable,
  usageEventsTable,
} from "@workspace/db";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { RuntimeInstanceHandle } from "../orchestrator/runtime-instance-registry";
import type { RuntimeOperationsConfig } from "../runtime-operations-config";
import { logger, safeErrorForLog } from "../logger";
import { appendOperationsChanged } from "./operations-events";
import { deriveRuntimeTruth } from "./operations-state";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_CONSERVATIVE_BACKFILL_BUCKETS = 1_440;
const SAMPLER_ADVISORY_LOCK_CLASS = 1_330_662_995;

type SamplerTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SamplerExecutor = typeof db | SamplerTransaction;

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function completedOperationsMinute(now: Date): Date {
  if (!Number.isFinite(now.getTime()))
    throw new TypeError("Invalid sample time");
  return new Date(
    Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS - MINUTE_MS,
  );
}

async function collectSample(
  executor: SamplerExecutor,
  input: {
    now: Date;
    bucketAt: Date;
    config: RuntimeOperationsConfig;
  },
) {
  const bucketEnd = new Date(input.bucketAt.getTime() + MINUTE_MS);
  const runtimeRows = await executor
    .select({
      id: runtimeInstancesTable.id,
      role: runtimeInstancesTable.role,
      state: runtimeInstancesTable.state,
      schedulerEnabled: runtimeInstancesTable.schedulerEnabled,
      lastHeartbeatAt: runtimeInstancesTable.lastHeartbeatAt,
      lastSchedulerTickAt: runtimeInstancesTable.lastSchedulerTickAt,
    })
    .from(runtimeInstancesTable)
    .where(
      and(
        eq(runtimeInstancesTable.schedulerEnabled, true),
        inArray(runtimeInstancesTable.role, ["worker", "combined"]),
      ),
    );
  const [control] = await executor
    .select({ emergencyStopEnabled: runtimeControlsTable.emergencyStopEnabled })
    .from(runtimeControlsTable)
    .where(eq(runtimeControlsTable.id, 1))
    .limit(1);
  const backend: "postgresql" | "pglite" =
    databaseBackend === "postgresql" ? "postgresql" : "pglite";
  const runtime = deriveRuntimeTruth({
    now: input.now,
    databaseBackend: backend,
    emergencyStopEnabled: control?.emergencyStopEnabled ?? true,
    workerStaleAfterMs: input.config.workerStaleAfterMs,
    instances: runtimeRows,
  });

  const selectionCutoff = new Date(
    input.now.getTime() - input.config.schedulerTickMs,
  );
  const due = and(
    inArray(tasksTable.status, ["pending", "planning", "in_progress"]),
    or(
      isNull(tasksTable.lastSteppedAt),
      lt(tasksTable.lastSteppedAt, selectionCutoff),
    ),
    or(
      isNull(tasksTable.nextAttemptAt),
      lt(tasksTable.nextAttemptAt, input.now),
    ),
    or(
      isNull(tasksTable.leaseExpiresAt),
      lt(tasksTable.leaseExpiresAt, input.now),
    ),
    eq(agentsTable.isActive, true),
    or(
      isNull(agentsTable.runLeaseExpiresAt),
      lt(agentsTable.runLeaseExpiresAt, input.now),
    ),
  );
  const [tasks] = await executor
    .select({
      dueDepth: sql<number>`count(*) filter (where ${due})`,
      oldestDueAt: sql<Date | null>`min(coalesce(${tasksTable.nextAttemptAt}, ${tasksTable.lastSteppedAt}, ${tasksTable.createdAt})) filter (where ${due})`,
      active: sql<number>`count(*) filter (where ${tasksTable.status} in ('pending', 'planning', 'in_progress') and ${tasksTable.leaseExpiresAt} > ${input.now})`,
      sleeping: sql<number>`count(*) filter (where ${tasksTable.status} in ('pending', 'planning', 'in_progress') and ${tasksTable.autonomyMode} = 'continuous' and ${tasksTable.nextAttemptAt} > ${input.now} and (${tasksTable.leaseExpiresAt} is null or ${tasksTable.leaseExpiresAt} <= ${input.now}))`,
      recovering: sql<number>`count(*) filter (where ${tasksTable.status} in ('pending', 'planning', 'in_progress') and ${tasksTable.recoveryCount} > 0 and (${tasksTable.leaseExpiresAt} is null or ${tasksTable.leaseExpiresAt} <= ${input.now}) and (${tasksTable.nextAttemptAt} is null or ${tasksTable.nextAttemptAt} <= ${input.now}))`,
      blocked: sql<number>`count(*) filter (where ${tasksTable.status} = 'blocked')`,
      awaitingApproval: sql<number>`count(*) filter (where ${tasksTable.status} = 'awaiting_approval')`,
    })
    .from(tasksTable)
    .innerJoin(agentsTable, eq(agentsTable.id, tasksTable.ownerAgentId));

  const [usage] = await executor
    .select({
      events: sql<number>`count(*)`,
      tokens: sql<number>`coalesce(sum(${usageEventsTable.totalTokens}), 0)`,
      reportedCost: sql<string>`coalesce(sum(${usageEventsTable.reportedCostUsd}), 0)`,
    })
    .from(usageEventsTable)
    .where(
      and(
        eq(usageEventsTable.kind, "task_step"),
        gte(usageEventsTable.createdAt, input.bucketAt),
        lt(usageEventsTable.createdAt, bucketEnd),
      ),
    );

  const [attempts] = await executor
    .select({
      recoveryCount: sql<number>`count(*) filter (where ${isNotNull(taskAttemptsTable.recoveryOfAttemptId)} and ${taskAttemptsTable.startedAt} >= ${input.bucketAt} and ${taskAttemptsTable.startedAt} < ${bucketEnd})`,
      lostLeaseCount: sql<number>`count(*) filter (where ${taskAttemptsTable.state} = 'lost' and ${taskAttemptsTable.failureKind} in ('lease_expired', 'lease_lost') and ${taskAttemptsTable.finishedAt} >= ${input.bucketAt} and ${taskAttemptsTable.finishedAt} < ${bucketEnd})`,
    })
    .from(taskAttemptsTable);

  const oldestDueAt = tasks?.oldestDueAt ?? null;
  return {
    runtimeTruthState: runtime.state,
    providerMetricsCoverage: "partial" as const,
    healthyWorkerCount: runtime.healthyWorkerCount,
    staleWorkerCount: runtime.staleWorkerCount,
    schedulerTickAgeMs: runtime.schedulerTickAgeMs,
    dueQueueDepth: numberValue(tasks?.dueDepth),
    oldestDueAgeMs: oldestDueAt
      ? Math.max(0, input.now.getTime() - new Date(oldestDueAt).getTime())
      : null,
    activeTaskCount: numberValue(tasks?.active),
    sleepingTaskCount: numberValue(tasks?.sleeping),
    recoveringTaskCount: numberValue(tasks?.recovering),
    blockedTaskCount: numberValue(tasks?.blocked),
    approvalWaitingTaskCount: numberValue(tasks?.awaitingApproval),
    // The usage ledger records successful task completions but not provider
    // errors or latency, so these metrics must remain explicitly partial.
    providerSuccessCount: numberValue(usage?.events),
    providerErrorCount: 0,
    providerP50LatencyMs: null,
    providerP95LatencyMs: null,
    recoveryCount: numberValue(attempts?.recoveryCount),
    lostLeaseCount: numberValue(attempts?.lostLeaseCount),
    taskTokens: numberValue(usage?.tokens),
    reportedCostUsd: numberValue(usage?.reportedCost).toFixed(6),
  };
}

export async function recordOperationsHealthSample(input: {
  runtimeInstanceId: string;
  now?: Date;
  config: RuntimeOperationsConfig;
  unavailableSamples?: readonly { bucketAt: Date; sampledAt: Date }[];
  monotonicNow?: () => number;
}): Promise<boolean> {
  if (input.config.role === "api") return false;
  const now = input.now ?? new Date();
  const bucketAt = completedOperationsMinute(now);
  const bucketNumber = Math.floor(bucketAt.getTime() / MINUTE_MS);
  const monotonicNow = input.monotonicNow ?? (() => performance.now());
  const observationStarted = monotonicNow();
  const requireFreshObservation = () => {
    if (monotonicNow() - observationStarted > input.config.workerStaleAfterMs) {
      throw new Error(
        "Operations health observation exceeded its freshness deadline",
      );
    }
  };
  return db.transaction(async (transaction) => {
    if (databaseBackend === "postgresql") {
      // Transaction-scoped ownership serializes replicas for one bucket. The
      // PK remains the final authority if a process dies around lock release.
      await transaction.execute(
        sql`select pg_advisory_xact_lock(${SAMPLER_ADVISORY_LOCK_CLASS}, ${bucketNumber})`,
      );
    }
    requireFreshObservation();
    // Failed observations can recover inside the same completed-minute bucket.
    // Preserve those observations before considering a current healthy sample;
    // the ordinary missing-bucket backfill cannot detect this shorter outage.
    if (input.unavailableSamples?.length) {
      const insertedUnavailable = await transaction
        .insert(runtimeHealthSamplesTable)
        .values(
          input.unavailableSamples.map((sample) => ({
            bucketAt: sample.bucketAt,
            sampledAt: sample.sampledAt,
            sampledByInstanceId: input.runtimeInstanceId,
            runtimeTruthState: "offline" as const,
          })),
        )
        .onConflictDoNothing({ target: runtimeHealthSamplesTable.bucketAt })
        .returning({ bucketAt: runtimeHealthSamplesTable.bucketAt });
      for (const sample of insertedUnavailable) {
        await appendOperationsChanged(transaction, {
          kind: "health_sample_recorded",
          runtimeInstanceId: input.runtimeInstanceId,
          bucketAt: sample.bucketAt,
          createdAt: now,
        });
      }
    }
    const [existing] = await transaction
      .select({ bucketAt: runtimeHealthSamplesTable.bucketAt })
      .from(runtimeHealthSamplesTable)
      .where(eq(runtimeHealthSamplesTable.bucketAt, bucketAt))
      .limit(1);
    requireFreshObservation();
    if (existing) return false;

    const [latest] = await transaction
      .select({ bucketAt: runtimeHealthSamplesTable.bucketAt })
      .from(runtimeHealthSamplesTable)
      .where(lt(runtimeHealthSamplesTable.bucketAt, bucketAt))
      .orderBy(desc(runtimeHealthSamplesTable.bucketAt))
      .limit(1);
    if (latest) {
      const firstMissingAt = Math.max(
        latest.bucketAt.getTime() + MINUTE_MS,
        bucketAt.getTime() - MAX_CONSERVATIVE_BACKFILL_BUCKETS * MINUTE_MS,
      );
      const missedBuckets: Date[] = [];
      for (
        let missedAt = firstMissingAt;
        missedAt < bucketAt.getTime();
        missedAt += MINUTE_MS
      ) {
        missedBuckets.push(new Date(missedAt));
      }
      if (missedBuckets.length > 0) {
        // A minute that no worker could sample is itself durable evidence of
        // lost observability. Never reconstruct it as healthy from recovery-
        // time state: persist a conservative offline marker instead.
        const insertedGaps = await transaction
          .insert(runtimeHealthSamplesTable)
          .values(
            missedBuckets.map((missedBucketAt) => ({
              bucketAt: missedBucketAt,
              sampledAt: now,
              sampledByInstanceId: input.runtimeInstanceId,
              runtimeTruthState: "offline" as const,
            })),
          )
          .onConflictDoNothing({ target: runtimeHealthSamplesTable.bucketAt })
          .returning({ bucketAt: runtimeHealthSamplesTable.bucketAt });
        for (const gap of insertedGaps) {
          await appendOperationsChanged(transaction, {
            kind: "health_sample_recorded",
            runtimeInstanceId: input.runtimeInstanceId,
            bucketAt: gap.bucketAt,
            createdAt: now,
          });
        }
      }
    }

    const sample = await collectSample(transaction, {
      now,
      bucketAt,
      config: input.config,
    });
    requireFreshObservation();
    const inserted = await transaction
      .insert(runtimeHealthSamplesTable)
      .values({
        bucketAt,
        sampledAt: now,
        sampledByInstanceId: input.runtimeInstanceId,
        ...sample,
      })
      .onConflictDoNothing({ target: runtimeHealthSamplesTable.bucketAt })
      .returning({ bucketAt: runtimeHealthSamplesTable.bucketAt });
    if (inserted.length === 0) return false;

    await appendOperationsChanged(transaction, {
      kind: "health_sample_recorded",
      runtimeInstanceId: input.runtimeInstanceId,
      bucketAt,
      createdAt: now,
    });
    const retentionCutoff = new Date(
      bucketAt.getTime() - input.config.opsSampleRetentionDays * DAY_MS,
    );
    await transaction
      .delete(runtimeHealthSamplesTable)
      .where(lt(runtimeHealthSamplesTable.bucketAt, retentionCutoff));
    return true;
  });
}

export interface OperationsHealthSamplerController {
  readonly started: boolean;
  trigger(): Promise<void>;
  stop(): Promise<void>;
}

export function startOperationsHealthSampler(
  runtime: RuntimeInstanceHandle,
  config: RuntimeOperationsConfig,
  options: {
    autoTrigger?: boolean;
    recordSample?: typeof recordOperationsHealthSample;
    now?: () => Date;
  } = {},
): OperationsHealthSamplerController {
  if (config.role === "api") {
    return Object.freeze({
      started: false,
      trigger: async () => undefined,
      stop: async () => undefined,
    });
  }
  const recordSample = options.recordSample ?? recordOperationsHealthSample;
  const nowImpl = options.now ?? (() => new Date());
  const unavailableSamples = new Map<
    number,
    { bucketAt: Date; sampledAt: Date }
  >();
  let stopped = false;
  let pending = false;
  let inFlight: Promise<void> | null = null;
  const run = async (): Promise<void> => {
    do {
      pending = false;
      const now = nowImpl();
      try {
        await recordSample({
          runtimeInstanceId: runtime.id,
          config,
          now,
          unavailableSamples: [...unavailableSamples.values()],
        });
        unavailableSamples.clear();
      } catch (error) {
        const failedAt = nowImpl();
        const lastBucket = completedOperationsMinute(failedAt).getTime();
        const firstBucket = Math.max(
          completedOperationsMinute(now).getTime(),
          lastBucket - (MAX_CONSERVATIVE_BACKFILL_BUCKETS - 1) * MINUTE_MS,
        );
        // Paused PostgreSQL can resume a queued query without disconnecting.
        // A stale observation must retain every minute missed while awaiting it.
        for (
          let bucket = firstBucket;
          bucket <= lastBucket;
          bucket += MINUTE_MS
        ) {
          if (!unavailableSamples.has(bucket)) {
            unavailableSamples.set(bucket, {
              bucketAt: new Date(bucket),
              sampledAt: failedAt,
            });
          }
        }
        while (unavailableSamples.size > MAX_CONSERVATIVE_BACKFILL_BUCKETS) {
          unavailableSamples.delete(unavailableSamples.keys().next().value!);
        }
        logger.warn(
          { error: safeErrorForLog(error), runtimeId: runtime.id },
          "Operations health sample failed",
        );
      }
    } while (pending && !stopped);
  };
  const trigger = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    pending = true;
    if (!inFlight) {
      inFlight = run().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
  const timer = setInterval(() => void trigger(), config.opsSampleMs);
  timer.unref?.();
  if (options.autoTrigger ?? true) void trigger();
  return Object.freeze({
    started: true,
    trigger,
    async stop(): Promise<void> {
      if (stopped) return inFlight ?? Promise.resolve();
      stopped = true;
      pending = false;
      clearInterval(timer);
      await inFlight;
    },
  });
}
