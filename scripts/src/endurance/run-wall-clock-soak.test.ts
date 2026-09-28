import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  runWallClockSoak,
  type WallClockRuntimeDriver,
} from "./run-wall-clock-soak";
import { createSeededFaultSchedule } from "./fault-injector";

function testDriver(input: {
  directory: string;
  failMinute?: number;
  failMinuteOnce?: number;
  stopped: { count: number };
  now: () => Date;
  lifecycle?: string[];
  onStop?: () => void | Promise<void>;
  stoppedWith?: Array<{ keepData: boolean }>;
  omitIrreversibleReceipt?: boolean;
  expectedResponsibilities?: number;
}): WallClockRuntimeDriver {
  const minuteCalls = new Map<number, number>();
  return {
    start: async () => ({
      projectId: 7,
      expectedResponsibilities: input.expectedResponsibilities ?? 14_400,
    }),
    captureEvidence: async (observer, context) => {
      if (context.kind === "minute") {
        const call = (minuteCalls.get(context.minute) ?? 0) + 1;
        minuteCalls.set(context.minute, call);
        if (context.minute === input.failMinute)
          throw new Error("sample failed");
        if (context.minute === input.failMinuteOnce && call === 1)
          throw new Error("database connection unavailable");
        if (!input.omitIrreversibleReceipt) {
          observer.observeReceipt({
            receiptId: "receipt-wall-clock-proof",
            key: "op:v1:wall-clock-proof",
            irreversible: true,
            succeeded: true,
          });
        }
        observer.completeResponsibilities(10);
        observer.observeHealth({
          minute: context.minute,
          reportedState: "healthy",
          truthState: "healthy",
        });
      } else {
        const observedAt = new Date(
          new Date(context.scheduledAt).getTime() + 1_000,
        ).toISOString();
        observer.observeIncident({
          faultId: context.fault.id,
          incidentId: `incident:${context.fault.id}`,
          observedAt,
          sourceKind: "durable_event",
          sourceId: `durable:incident:${context.fault.id}`,
        });
        observer.observeRecovery({
          faultId: context.fault.id,
          recoveredAt: new Date(
            new Date(observedAt).getTime() + 60_000,
          ).toISOString(),
          sourceKind: "durable_event",
          sourceId: `durable:recovery:${context.fault.id}`,
        });
        if (context.fault.kind === "sse_disconnect") {
          observer.observeSseDisconnect("90");
          observer.observeSseReconnect("91");
        }
      }
    },
    createBrowserSession: async () => ({
      sample: async () => ({
        runtimeLabel: "Canlı",
        incidentVisible: true,
        reconnectCursorAdvanced: true,
        pageErrors: [],
      }),
      screenshot: async (target) => writeFile(target, "png", "utf8"),
      close: async () => undefined,
    }),
    provenance: async () => {
      input.lifecycle?.push("provenance");
      return {
        runner: {
          os: "test-os",
          node: "v24.19.0",
          postgres: "17",
          browser: "chromium-test",
        },
        workflowRunId: "test-workflow",
        configuration: { workers: 2, agents: 10 },
      };
    },
    stop: async (options) => {
      input.lifecycle?.push("stop");
      input.stoppedWith?.push(options);
      input.stopped.count += 1;
      await input.onStop?.();
    },
    listActiveWorkers: async () => ["worker-1", "worker-2"],
    killWorker: async () => undefined,
    restartWorker: async () => undefined,
    setProviderFault: async () => undefined,
    clearProviderFault: async () => undefined,
    pauseDatabase: async () => undefined,
    resumeDatabase: async () => undefined,
    disconnectObserverStream: async () => undefined,
    reconnectObserverStream: async () => undefined,
    enableEmergencyStop: async () => undefined,
    disableEmergencyStop: async () => undefined,
    sleep: async () => undefined,
    now: input.now,
  };
}

test("coordinator produces verified evidence only after a full virtual wall-clock day", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-soak-"));
  const stopped = { count: 0 };
  const origin = new Date("2026-09-01T00:00:00.000Z").getTime();
  let elapsed = 0;
  const now = () => new Date(origin + elapsed);
  const lifecycle: string[] = [];
  try {
    const result = await runWallClockSoak(
      {
        runId: "wall-clock-test",
        seed: 240_901,
        durationHours: 24,
        commitSha: "test-commit",
        browserOutputDirectory: directory,
      },
      testDriver({
        directory,
        stopped,
        now,
        lifecycle,
        onStop: () => {
          elapsed += 60_000;
        },
      }),
      {
        waitUntilOffset: async (offsetMs) => {
          elapsed = Math.max(elapsed, offsetMs);
        },
        browserSleep: async () => undefined,
      },
    );
    assert.equal(result.failure, null);
    assert.equal(result.report.pass, true);
    assert.equal(result.report.verified24h, true);
    assert.equal(result.report.metrics.completedResponsibilities, 14_400);
    assert.equal(result.report.metrics.healthSampleBuckets, 1_440);
    assert.equal(result.report.injections.length, 12);
    assert.equal(result.browser?.pass, true);
    assert.equal(result.report.provenance?.automatedSignOff.status, "passed");
    assert.equal(result.report.wallClockHours, 24);
    assert.equal(result.journal.at(-1)?.kind, "run_completed");
    assert.equal(stopped.count, 1);
    assert.deepEqual(lifecycle, ["provenance", "stop"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("database-outage minute capture is deferred until exact post-fault recovery", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-soak-"));
  const stopped = { count: 0 };
  const durationMs = 24 * 60 * 60 * 1_000;
  const databaseFault = createSeededFaultSchedule({
    seed: 240_901,
    durationMs,
  }).find((fault) => fault.kind === "database_unavailable");
  assert.ok(databaseFault);
  const affectedMinute = Math.ceil(databaseFault.atMs / 60_000);
  assert.ok(
    affectedMinute * 60_000 <= databaseFault.atMs + databaseFault.durationMs,
  );
  const origin = new Date("2026-09-01T00:00:00.000Z").getTime();
  let elapsed = 0;
  try {
    const result = await runWallClockSoak(
      {
        runId: "database-sample-retry",
        seed: 240_901,
        durationHours: 24,
        commitSha: "test-commit",
        browserOutputDirectory: directory,
      },
      testDriver({
        directory,
        stopped,
        failMinuteOnce: affectedMinute,
        now: () => new Date(origin + elapsed),
      }),
      {
        waitUntilOffset: async (offsetMs) => {
          elapsed = Math.max(elapsed, offsetMs);
        },
        browserSleep: async () => undefined,
      },
    );
    assert.equal(result.failure, null);
    assert.equal(result.report.pass, true);
    assert.equal(result.report.metrics.healthSampleBuckets, 1_440);
    assert.equal(
      result.journal.some(
        (event) =>
          event.kind === "health_sample_deferred" &&
          event.data.minute === affectedMinute &&
          event.data.faultId === databaseFault.id,
      ),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a wall-clock run cannot pass without irreversible receipt evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-soak-"));
  const stopped = { count: 0 };
  const origin = new Date("2026-09-01T00:00:00.000Z").getTime();
  let elapsed = 0;
  try {
    const result = await runWallClockSoak(
      {
        runId: "missing-receipt-proof",
        seed: 7,
        durationHours: 1 / 60,
        commitSha: "test-commit",
        browserOutputDirectory: directory,
      },
      testDriver({
        directory,
        stopped,
        omitIrreversibleReceipt: true,
        now: () => new Date(origin + elapsed),
      }),
      {
        waitUntilOffset: async (offsetMs) => {
          elapsed = Math.max(elapsed, offsetMs);
        },
        browserSleep: async () => undefined,
      },
    );
    assert.equal(result.failure, null);
    assert.equal(result.report.pass, false);
    assert.equal(
      result.report.assertions.find(
        (assertion) =>
          assertion.id === "irreversible_receipt_evidence_observed",
      )?.pass,
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a non-integral-minute smoke remains active through its exact requested horizon", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-soak-"));
  const stopped = { count: 0 };
  const origin = new Date("2026-09-01T00:00:00.000Z").getTime();
  let elapsed = 0;
  try {
    const result = await runWallClockSoak(
      {
        runId: "ninety-second-horizon",
        seed: 240_901,
        durationHours: 0.025,
        commitSha: "test-commit",
        browserOutputDirectory: directory,
      },
      testDriver({
        directory,
        stopped,
        expectedResponsibilities: 10,
        now: () => new Date(origin + elapsed),
      }),
      {
        waitUntilOffset: async (offsetMs) => {
          elapsed = Math.max(elapsed, offsetMs);
        },
        browserSleep: async () => undefined,
      },
    );
    assert.equal(result.failure, null);
    assert.equal(result.report.pass, true);
    assert.equal(result.report.metrics.healthSampleBuckets, 1);
    assert.equal(result.report.metrics.requiredHealthSampleBuckets, 1);
    assert.equal(result.report.wallClockHours, 0.025);
    assert.equal(result.report.completedAt, "2026-09-01T00:01:30.000Z");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("compressed-all remains smoke-only even after a full virtual wall-clock day", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-soak-"));
  const stopped = { count: 0 };
  const origin = new Date("2026-09-01T00:00:00.000Z").getTime();
  let elapsed = 0;
  try {
    const result = await runWallClockSoak(
      {
        runId: "compressed-all-smoke",
        seed: 240_901,
        durationHours: 24,
        faultProfile: "compressed-all",
        commitSha: "test-commit",
        browserOutputDirectory: directory,
      },
      testDriver({
        directory,
        stopped,
        expectedResponsibilities: 14_400,
        now: () => new Date(origin + elapsed),
      }),
      {
        waitUntilOffset: async (offsetMs) => {
          elapsed = Math.max(elapsed, offsetMs);
        },
        browserSleep: async () => undefined,
      },
    );
    assert.equal(result.failure, null);
    assert.equal(result.report.pass, true);
    assert.equal(result.report.verified24h, false);
    assert.deepEqual(
      new Set(result.report.injections.map((injection) => injection.kind)),
      new Set([
        "worker_loss",
        "provider_timeout",
        "provider_rate_limit",
        "provider_malformed_output",
        "database_unavailable",
        "sse_disconnect",
        "emergency_stop",
      ]),
    );
    assert.equal(result.journal[0].data.faultProfile, "compressed-all");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("coordinator emits failed partial evidence and always tears down", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-soak-"));
  const stopped = { count: 0 };
  const origin = new Date("2026-09-01T00:00:00.000Z").getTime();
  let elapsed = 0;
  const now = () => new Date(origin + elapsed);
  try {
    const result = await runWallClockSoak(
      {
        runId: "partial-test",
        seed: 1,
        durationHours: 1 / 60,
        commitSha: "test-commit",
        browserOutputDirectory: directory,
      },
      testDriver({ directory, stopped, now, failMinute: 1 }),
      {
        waitUntilOffset: async (offsetMs) => {
          elapsed = Math.max(elapsed, offsetMs);
        },
        browserSleep: async () => undefined,
      },
    );
    assert.match(result.failure ?? "", /sample failed/);
    assert.equal(result.report.pass, false);
    assert.equal(result.report.verified24h, false);
    assert.equal(result.report.provenance?.automatedSignOff.status, "failed");
    assert.equal(result.journal.at(-1)?.kind, "run_failed");
    assert.equal(stopped.count, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("external cancellation fails closed and still tears down", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-soak-"));
  const stopped = { count: 0 };
  const cancellation = new AbortController();
  cancellation.abort(new Error("operator interrupted soak"));
  try {
    const result = await runWallClockSoak(
      {
        runId: "cancelled-test",
        seed: 2,
        durationHours: 1 / 60,
        commitSha: "test-commit",
        browserOutputDirectory: directory,
      },
      testDriver({
        directory,
        stopped,
        now: () => new Date("2026-09-01T00:00:00.000Z"),
      }),
      {
        signal: cancellation.signal,
        waitUntilOffset: async (_offsetMs, signal) => signal.throwIfAborted(),
        browserSleep: async (_milliseconds, signal) => signal?.throwIfAborted(),
      },
    );
    assert.match(result.failure ?? "", /operator interrupted soak/);
    assert.equal(result.report.pass, false);
    assert.equal(result.report.verified24h, false);
    assert.equal(result.journal.at(-1)?.kind, "run_failed");
    assert.equal(stopped.count, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("coordinator bounds a hung cleanup without losing the failure evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-soak-"));
  const stopped = { count: 0 };
  const startedAt = Date.now();
  try {
    const result = await runWallClockSoak(
      {
        runId: "hung-cleanup-test",
        seed: 2,
        durationHours: 1 / 60,
        commitSha: "test-commit",
        browserOutputDirectory: directory,
      },
      testDriver({
        directory,
        stopped,
        now: () => new Date("2026-09-01T00:01:00.000Z"),
        onStop: () => new Promise<void>(() => undefined),
      }),
      {
        waitUntilOffset: async () => undefined,
        browserSleep: async () => undefined,
        cleanupTimeoutMs: 20,
      },
    );
    assert.match(result.failure ?? "", /cleanup timed out after 20ms/iu);
    assert.equal(result.report.pass, false);
    assert.equal(stopped.count, 1);
    assert.equal(Date.now() - startedAt < 2_000, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keep-on-failure preserves data for invariant failures without a thrown job", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-wall-soak-"));
  const stopped = { count: 0 };
  const stoppedWith: Array<{ keepData: boolean }> = [];
  const driver = testDriver({
    directory,
    stopped,
    stoppedWith,
    now: () => new Date("2026-09-01T00:01:00.000Z"),
  });
  driver.createBrowserSession = async () => ({
    sample: async () => ({
      runtimeLabel: "Canlı",
      incidentVisible: false,
      reconnectCursorAdvanced: false,
      pageErrors: [],
      mismatch: "synthetic false green",
    }),
    screenshot: async (target) => writeFile(target, "png", "utf8"),
    close: async () => undefined,
  });
  try {
    const result = await runWallClockSoak(
      {
        runId: "keep-failed-test",
        seed: 3,
        durationHours: 1 / 60,
        commitSha: "test-commit",
        browserOutputDirectory: directory,
        keepOnFailure: true,
      },
      driver,
      {
        waitUntilOffset: async () => undefined,
        browserSleep: async () => undefined,
      },
    );
    assert.equal(result.failure, null);
    assert.equal(result.report.pass, false);
    assert.deepEqual(stoppedWith, [{ keepData: true }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
