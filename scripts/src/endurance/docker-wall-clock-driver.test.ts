import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { BrowserMonitorSession } from "./browser-monitor";
import {
  createDockerWallClockEnvironment,
  DockerWallClockDriver,
  hasHealthyRuntimeTruth,
  isScheduledDisruptiveHealthWindow,
  type DockerWallClockHarness,
} from "./docker-wall-clock-driver";
import { createSeededFaultSchedule } from "./fault-injector";
import type { DurableEnduranceEvent } from "./postgres-harness";
import { SoakEvidenceObserver } from "./soak-observer";

class RecordingSoakEvidenceObserver extends SoakEvidenceObserver {
  readonly healthObservations: Array<{
    minute: number;
    reportedState: string;
    truthState: string;
  }> = [];

  override observeHealth(input: {
    minute: number;
    reportedState: string;
    truthState: string;
  }): void {
    this.healthObservations.push(input);
    super.observeHealth(input);
  }
}

function harness(log: string[]): DockerWallClockHarness {
  return {
    start: async () => {
      log.push("harness:start");
    },
    stop: async () => {
      log.push("harness:stop");
    },
    killWorker: async (worker) => {
      log.push(`harness:kill:${worker}`);
    },
    restartWorker: async (worker) => {
      log.push(`harness:restart:${worker}`);
    },
    pauseDatabase: async () => {
      log.push("harness:pause-db");
    },
    resumeDatabase: async () => {
      log.push("harness:resume-db");
    },
    listRunningServices: async () => ["app", "db", "worker-1", "worker-2"],
    postgresVersion: async () => "PostgreSQL 17.6",
    runtimeAttestation: async () => ({
      kind: "docker",
      serviceImageIds: {
        app: `sha256:${"a".repeat(64)}`,
        worker1: `sha256:${"a".repeat(64)}`,
        worker2: `sha256:${"a".repeat(64)}`,
        database: `sha256:${"b".repeat(64)}`,
      },
      applicationImageLabels: {
        sourceCommitSha: "1".repeat(40),
        sourceTreeSha256: "2".repeat(64),
      },
    }),
    readDurableEnduranceEvents: async () => [],
    makeContinuousTasksDue: async (projectId, taskIds) => {
      log.push(`harness:due:${projectId}:${taskIds.join(",")}`);
      return [...taskIds];
    },
    state: () => ({
      running: true,
      projectName: "agentic-os-soak-soak-test",
      runId: "soak-test",
    }),
  };
}

function operationsSnapshot(input: {
  cursor: string;
  generatedAt?: string;
  receipts?: unknown[];
  attempts?: unknown[];
  incidents?: unknown[];
  milestones?: unknown[];
  healthSamples?: unknown[];
}) {
  return {
    generatedAt: input.generatedAt ?? "2026-09-01T00:01:00.000Z",
    cursor: input.cursor,
    rootTask: { id: 7, title: "Endurance", status: "in_progress" },
    runtime: {
      state: "live",
      reasons: [],
      databaseBackend: "postgresql",
      durable: true,
      multiProcessCapable: true,
      emergencyStopEnabled: false,
      healthyWorkerCount: 2,
      staleWorkerCount: 0,
      schedulerTickAgeMs: 1_000,
    },
    members: Array.from({ length: 10 }, (_, index) => ({ agentId: index + 1 })),
    attempts: input.attempts ?? [],
    receipts: input.receipts ?? [],
    incidents: input.incidents ?? [],
    milestones: input.milestones ?? [],
    fleetHealthSamples: input.healthSamples ?? [],
    truncation: {
      attempts: false,
      receipts: false,
      incidents: false,
      milestones: false,
      fleetHealthSamples: false,
    },
  };
}

test("runtime truth accepts historical stale rows but not an unhealthy active fleet", () => {
  assert.equal(
    hasHealthyRuntimeTruth({
      runtimeTruthState: "live",
      healthyWorkerCount: 2,
      staleWorkerCount: 3,
    }),
    true,
  );
  assert.equal(
    hasHealthyRuntimeTruth({
      runtimeTruthState: "degraded",
      healthyWorkerCount: 2,
      staleWorkerCount: 1,
    }),
    false,
  );
  assert.equal(
    hasHealthyRuntimeTruth({
      runtimeTruthState: "live",
      healthyWorkerCount: 1,
      staleWorkerCount: 0,
    }),
    false,
  );
  assert.equal(
    hasHealthyRuntimeTruth({
      runtimeTruthState: "live",
      healthyWorkerCount: 3,
      staleWorkerCount: 0,
    }),
    false,
  );
});

test("commanded native smoke faults admit only bounded degraded health samples", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "agentic-commanded-health-"),
  );
  let now = new Date("2026-09-01T00:00:00.000Z");
  let snapshot = operationsSnapshot({ cursor: "1" });
  const fetchImpl: typeof fetch = async (input, init) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname === "/api/readyz") return Response.json({ status: "ready" });
    if (pathname === "/api/ops/instances") {
      return Response.json({
        instances: [
          {
            id: "api-1",
            role: "api",
            effectiveState: "healthy",
            schedulerEnabled: false,
          },
          {
            id: "worker-1",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
          {
            id: "worker-2",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
        ],
      });
    }
    if (pathname === "/api/tasks" && init?.method === "POST") {
      return Response.json({ id: 7 }, { status: 201 });
    }
    if (pathname === "/api/tasks/7/operations") return Response.json(snapshot);
    return Response.json({ error: "not found" }, { status: 404 });
  };
  const driver = new DockerWallClockDriver({
    runId: "commanded-health-test",
    seed: 240_901,
    durationHours: 1 / 60,
    workspaceRoot: process.cwd(),
    controlDirectory: directory,
    baseUrl: "http://127.0.0.1:5000",
    operatorToken: "local-operator-secret",
    harness: harness([]),
    fetchImpl,
    now: () => now,
    commandedFaultHealthWindowsOnly: true,
  });
  try {
    await driver.start();
    now = new Date("2026-09-01T00:00:10.000Z");
    await driver.killWorker("worker-1");
    now = new Date("2026-09-01T00:00:12.000Z");
    await driver.restartWorker("worker-1");
    now = new Date("2026-09-01T00:01:20.000Z");
    await driver.pauseDatabase();
    now = new Date("2026-09-01T00:01:22.000Z");
    await driver.resumeDatabase();
    snapshot = operationsSnapshot({
      cursor: "2",
      generatedAt: "2026-09-01T00:01:24.000Z",
      healthSamples: [
        {
          bucketAt: "2026-09-01T00:00:00.000Z",
          sampledAt: "2026-09-01T00:00:19.000Z",
          runtimeTruthState: "degraded",
          healthyWorkerCount: 1,
          staleWorkerCount: 1,
          schedulerTickAgeMs: 20_000,
        },
      ],
    });
    await assert.rejects(
      driver.captureEvidence(
        new RecordingSoakEvidenceObserver({ expectedResponsibilities: 10 }),
        { kind: "minute", minute: 1 },
      ),
      /unplanned degraded runtime truth/iu,
    );
    snapshot = operationsSnapshot({
      cursor: "3",
      generatedAt: "2026-09-01T00:01:25.000Z",
      healthSamples: [
        {
          bucketAt: "2026-09-01T00:00:00.000Z",
          sampledAt: "2026-09-01T00:00:11.000Z",
          runtimeTruthState: "degraded",
          healthyWorkerCount: 1,
          staleWorkerCount: 1,
          schedulerTickAgeMs: 20_000,
        },
        {
          bucketAt: "2026-09-01T00:01:00.000Z",
          sampledAt: "2026-09-01T00:01:21.000Z",
          runtimeTruthState: "degraded",
          healthyWorkerCount: 2,
          staleWorkerCount: 0,
          schedulerTickAgeMs: 20_000,
        },
      ],
    });
    const observer = new RecordingSoakEvidenceObserver({
      expectedResponsibilities: 10,
    });
    await driver.captureEvidence(observer, { kind: "minute", minute: 1 });
    assert.equal(observer.finalize().metrics.healthSampleBuckets, 2);
    assert.deepEqual(observer.finalize().metrics.healthTruthMismatches, []);

    snapshot = operationsSnapshot({
      cursor: "4",
      generatedAt: "2026-09-01T00:04:00.000Z",
      healthSamples: [
        {
          bucketAt: "2026-09-01T00:04:00.000Z",
          sampledAt: "2026-09-01T00:04:00.000Z",
          runtimeTruthState: "degraded",
          healthyWorkerCount: 1,
          staleWorkerCount: 1,
          schedulerTickAgeMs: 20_000,
        },
      ],
    });
    await assert.rejects(
      driver.captureEvidence(observer, { kind: "minute", minute: 1 }),
      /unplanned degraded runtime truth/iu,
    );
  } finally {
    await driver.stop({ keepData: false });
    await rm(directory, { recursive: true, force: true });
  }
});

test("only scheduled disruptive faults allow bounded degraded health", () => {
  const durationMs = 24 * 60 * 60 * 1_000;
  const schedule = createSeededFaultSchedule({
    seed: 240_901,
    durationMs,
  });
  const workerFault = schedule.find((fault) => fault.kind === "worker_loss");
  const providerFault = schedule.find(
    (fault) => fault.kind === "provider_timeout",
  );
  assert.ok(workerFault);
  assert.ok(providerFault);
  assert.equal(
    isScheduledDisruptiveHealthWindow(
      schedule,
      workerFault.atMs + workerFault.durationMs + 5_000,
    ),
    true,
  );
  assert.equal(
    isScheduledDisruptiveHealthWindow(
      schedule,
      workerFault.atMs + workerFault.durationMs + 5_001,
    ),
    false,
  );
  assert.equal(
    isScheduledDisruptiveHealthWindow(schedule, providerFault.atMs),
    false,
  );
  const databaseFault = schedule.find(
    (fault) => fault.kind === "database_unavailable",
  )!;
  assert.equal(
    isScheduledDisruptiveHealthWindow(
      schedule,
      databaseFault.atMs + databaseFault.durationMs + 120_000,
    ),
    true,
  );
  assert.equal(
    isScheduledDisruptiveHealthWindow(
      schedule,
      databaseFault.atMs + databaseFault.durationMs + 120_001,
    ),
    false,
  );
});

test("Docker driver starts the exact topology and derives minute evidence from durable operations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-driver-test-"));
  const log: string[] = [];
  const requests: Array<{ path: string; authorization: string | null }> = [];
  let snapshot = operationsSnapshot({ cursor: "40" });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({
      path: url.pathname,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (url.pathname === "/api/readyz") {
      return Response.json({ status: "ready" });
    }
    if (url.pathname === "/api/ops/instances") {
      return Response.json({
        instances: [
          {
            id: "api-1",
            role: "api",
            effectiveState: "healthy",
            schedulerEnabled: false,
          },
          {
            id: "worker-1",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
          {
            id: "worker-2",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
        ],
      });
    }
    if (url.pathname === "/api/tasks" && init?.method === "POST") {
      return Response.json({ id: 7 }, { status: 201 });
    }
    if (url.pathname === "/api/tasks/7/operations") {
      return Response.json(snapshot);
    }
    if (url.pathname === "/api/ops/control" && init?.method === "PUT") {
      return Response.json({ emergencyStopEnabled: false });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };
  try {
    const driver = new DockerWallClockDriver({
      runId: "soak-test",
      seed: 240_901,
      durationHours: 1 / 60,
      workspaceRoot: process.cwd(),
      controlDirectory: directory,
      baseUrl: "http://127.0.0.1:5000",
      operatorToken: "local-operator-secret",
      harness: harness(log),
      fetchImpl,
      topologyTimeoutMs: 100,
      now: () => new Date("2026-09-01T00:01:00.000Z"),
    });

    assert.deepEqual(await driver.start(), {
      projectId: 7,
      expectedResponsibilities: 10,
    });
    snapshot = operationsSnapshot({
      cursor: "41",
      receipts: [
        {
          id: "receipt-1",
          operationKey: `op:v1:${"1".repeat(64)}`,
          originAttemptId: "attempt-1",
          state: "succeeded",
          toolName: "synthetic_fixture_write",
          sideEffectClass: "idempotent",
          reservedAt: "2026-09-01T00:00:30.000Z",
          finishedAt: "2026-09-01T00:00:31.000Z",
          invocations: [
            {
              id: "invocation-1",
              state: "succeeded",
              effectStartedAt: "2026-09-01T00:00:30.500Z",
              finishedAt: "2026-09-01T00:00:31.000Z",
            },
          ],
        },
        {
          id: "receipt-duplicate-cycle",
          operationKey: `op:v1:${"2".repeat(64)}`,
          originAttemptId: "attempt-1",
          state: "succeeded",
          toolName: "synthetic_fixture_write",
          sideEffectClass: "idempotent",
          reservedAt: "2026-09-01T00:00:32.000Z",
          finishedAt: "2026-09-01T00:00:33.000Z",
          invocations: [
            {
              id: "invocation-duplicate-cycle",
              state: "succeeded",
              effectStartedAt: "2026-09-01T00:00:32.500Z",
              finishedAt: "2026-09-01T00:00:33.000Z",
            },
          ],
        },
      ],
      attempts: [
        {
          id: "attempt-1",
          taskId: 7,
          agentId: 1,
          attemptNumber: 1,
          cycleNumber: 0,
          state: "succeeded",
          finishedAt: "2026-09-01T00:00:32.000Z",
        },
        ...Array.from({ length: 10 }, (_, index) => ({
          id: `unreceipted-attempt-${index + 1}`,
          taskId: index + 20,
          agentId: index + 1,
          attemptNumber: 3,
          cycleNumber: 2,
          state: "succeeded",
          finishedAt: "2026-09-01T00:00:40.000Z",
        })),
      ],
      healthSamples: [
        {
          bucketAt: "2026-09-01T00:00:00.000Z",
          sampledAt: "2026-09-01T00:00:00.000Z",
          runtimeTruthState: "live",
          healthyWorkerCount: 2,
          staleWorkerCount: 0,
          schedulerTickAgeMs: 1_000,
        },
        {
          bucketAt: "2026-09-01T00:01:00.000Z",
          sampledAt: "2026-09-01T00:01:00.000Z",
          runtimeTruthState: "live",
          healthyWorkerCount: 2,
          staleWorkerCount: 1,
          schedulerTickAgeMs: 1_000,
        },
        {
          bucketAt: "2026-09-01T00:02:00.000Z",
          sampledAt: "2026-09-01T00:02:00.000Z",
          runtimeTruthState: "live",
          healthyWorkerCount: 2,
          staleWorkerCount: 0,
          schedulerTickAgeMs: 1_000,
        },
      ],
    });
    // Match the production API's newest-first batch after delayed observation.
    snapshot.receipts.reverse();
    const observer = new RecordingSoakEvidenceObserver({
      expectedResponsibilities: 10,
    });
    // A receipt can commit before its attempt is finalized. Do not freeze the
    // joined running attempt into immutable evidence or count coverage early.
    const completedAttempt = structuredClone(
      snapshot.attempts[0] as Record<string, unknown>,
    );
    snapshot.attempts[0] = {
      ...completedAttempt,
      state: "running",
      finishedAt: null,
    };
    await driver.captureEvidence(observer, { kind: "minute", minute: 1 });
    assert.equal(observer.finalize().metrics.completedResponsibilities, 0);
    assert.equal(
      observer
        .finalize()
        .primaryEvidence.filter((row) => row.kind === "receipt_observed")
        .length,
      0,
    );
    snapshot.attempts[0] = completedAttempt;
    await driver.captureEvidence(observer, { kind: "minute", minute: 1 });
    await driver.captureEvidence(observer, { kind: "minute", minute: 2 });
    const evidence = observer.finalize();
    assert.equal(evidence.metrics.completedResponsibilities, 1);
    assert.equal(
      evidence.primaryEvidence.find(
        (row) => row.kind === "responsibility_completed",
      )?.data.receiptId,
      "receipt-1",
    );
    assert.equal(evidence.metrics.maxResponsibilityCycleLag, 2);
    assert.equal(evidence.metrics.healthSampleBuckets, 2);
    assert.deepEqual(evidence.metrics.healthTruthMismatches, []);
    assert.deepEqual(observer.healthObservations, [
      {
        minute: 1,
        reportedState: "healthy",
        truthState: "healthy",
        bucketAt: "2026-09-01T00:01:00.000Z",
        sampledAt: "2026-09-01T00:01:00.000Z",
        runtimeTruthState: "live",
        healthyWorkerCount: 2,
        staleWorkerCount: 1,
        schedulerTickAgeMs: 1_000,
      },
      {
        minute: 2,
        reportedState: "healthy",
        truthState: "healthy",
        bucketAt: "2026-09-01T00:02:00.000Z",
        sampledAt: "2026-09-01T00:02:00.000Z",
        runtimeTruthState: "live",
        healthyWorkerCount: 2,
        staleWorkerCount: 0,
        schedulerTickAgeMs: 1_000,
      },
    ]);

    snapshot = operationsSnapshot({
      cursor: "42",
      attempts: snapshot.attempts,
      healthSamples: [
        {
          bucketAt: "2026-09-01T00:10:00.000Z",
          sampledAt: "2026-09-01T00:10:00.000Z",
          runtimeTruthState: "degraded",
          healthyWorkerCount: 1,
          staleWorkerCount: 1,
          schedulerTickAgeMs: 20_000,
        },
      ],
    });
    await assert.rejects(
      driver.captureEvidence(observer, { kind: "minute", minute: 2 }),
      /unplanned degraded runtime truth/iu,
    );
    snapshot = operationsSnapshot({
      cursor: "43",
      attempts: snapshot.attempts,
    });
    await assert.rejects(
      driver.captureEvidence(observer, { kind: "minute", minute: 3 }),
      /responsibility cycle lag 3 exceeds/iu,
    );

    const provenance = await driver.provenance();
    assert.equal(provenance.runner.postgres, "PostgreSQL 17.6");
    assert.equal(provenance.configuration.workers, 2);
    assert.equal(provenance.configuration.runtime, "docker-compose");
    assert.equal(
      requests.every(
        (request) => request.authorization === "Bearer local-operator-secret",
      ),
      true,
    );
    await driver.stop({ keepData: false });
    assert.deepEqual(log, ["harness:start", "harness:stop"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Docker driver controls only run-scoped faults and proves SSE recovery by cursor advance", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-driver-test-"));
  const log: string[] = [];
  let now = new Date("2026-09-01T00:03:00.000Z");
  let expectedDatabaseOutage = () => false;
  let emergencyEnabled = false;
  let emergencyVersion = 1;
  let emergencyUpdatedAt = "2026-09-01T00:00:00.000Z";
  let snapshot = operationsSnapshot({
    cursor: "90",
    attempts: [
      {
        id: "attempt-3",
        taskId: 7,
        agentId: 1,
        attemptNumber: 3,
        cycleNumber: 2,
        state: "succeeded",
        finishedAt: "2026-09-01T00:02:00.000Z",
      },
    ],
  });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/readyz") {
      return Response.json({ status: "ready" });
    }
    if (url.pathname === "/api/ops/instances") {
      return Response.json({
        instances: [
          {
            id: "api-1",
            role: "api",
            effectiveState: "healthy",
            schedulerEnabled: false,
          },
          {
            id: "worker-1",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
          {
            id: "worker-2",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
        ],
      });
    }
    if (url.pathname === "/api/tasks" && init?.method === "POST") {
      return Response.json({ id: 7 }, { status: 201 });
    }
    if (url.pathname === "/api/tasks/7/operations") {
      return Response.json(snapshot);
    }
    if (url.pathname === "/api/ops/control" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      log.push(`emergency:${String(body.emergencyStopEnabled)}`);
      emergencyEnabled = body.emergencyStopEnabled === true;
      emergencyVersion += 1;
      emergencyUpdatedAt = emergencyEnabled
        ? "2026-09-01T00:04:00.000Z"
        : "2026-09-01T00:04:30.000Z";
      return Response.json({
        ...body,
        version: emergencyVersion,
        updatedAt: emergencyUpdatedAt,
      });
    }
    if (url.pathname === "/api/ops/control") {
      return Response.json({
        emergencyStopEnabled: emergencyEnabled,
        version: emergencyVersion,
        updatedAt: emergencyUpdatedAt,
      });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };
  const session = {
    browserVersion: "Chromium 140.0",
    sample: async () => ({
      runtimeLabel: "Canlı",
      incidentVisible: true,
      reconnectCursorAdvanced: true,
      pageErrors: [],
    }),
    screenshot: async () => undefined,
    setOffline: async (offline: boolean) => {
      log.push(`browser:offline:${String(offline)}`);
      if (!offline) {
        snapshot = operationsSnapshot({
          cursor: "91",
          generatedAt: "2026-09-01T00:03:00.000Z",
          milestones: [
            {
              id: "91",
              kind: "attempt_state_changed",
              occurredAt: "2026-09-01T00:02:30.000Z",
            },
          ],
        });
      }
    },
    close: async () => {
      log.push("browser:close");
    },
  } satisfies BrowserMonitorSession & {
    browserVersion: string;
    setOffline(offline: boolean): Promise<void>;
  };
  try {
    const driver = new DockerWallClockDriver({
      runId: "soak-faults",
      seed: 7,
      durationHours: 24,
      workspaceRoot: process.cwd(),
      controlDirectory: directory,
      baseUrl: "http://localhost:5000",
      operatorToken: "operator-token",
      harness: harness(log),
      fetchImpl,
      topologyTimeoutMs: 100,
      browserSessionFactory: async (input) => {
        expectedDatabaseOutage =
          input.isExpectedDatabaseOutage ?? (() => false);
        return session;
      },
      sleep: async () => undefined,
      now: () => now,
    });
    await driver.start();
    const activeSession = await driver.createBrowserSession();
    assert.equal(expectedDatabaseOutage(), false);
    assert.deepEqual(await driver.listActiveWorkers(), [
      "worker-1",
      "worker-2",
    ]);
    await driver.killWorker("worker-1");
    await driver.restartWorker("worker-1");
    await driver.pauseDatabase();
    assert.equal(expectedDatabaseOutage(), true);
    await driver.resumeDatabase();
    assert.equal(expectedDatabaseOutage(), true);
    now = new Date(now.getTime() + 30_001);
    assert.equal(expectedDatabaseOutage(), false);

    await driver.setProviderFault("provider_rate_limit", "provider-fault-1");
    assert.equal(log.includes("harness:due:7:7"), true);
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(directory, "fault-control.json"), "utf8"),
      ).entries,
      [
        {
          taskId: 7,
          attemptNumber: 4,
          step: 3,
          outcome: "rate_limit",
        },
      ],
    );
    await driver.clearProviderFault("provider-fault-1");
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(directory, "fault-control.json"), "utf8"),
      ).entries,
      [],
    );

    await driver.disconnectObserverStream();
    await driver.reconnectObserverStream();
    const observer = new SoakEvidenceObserver({ expectedResponsibilities: 10 });
    observer.scheduleFault({
      id: "sse-fault-1",
      kind: "sse_disconnect",
      scheduledAt: "2026-09-01T00:02:00.000Z",
    });
    await driver.captureEvidence(observer, {
      kind: "post_fault",
      fault: {
        id: "sse-fault-1",
        kind: "sse_disconnect",
        atMs: 1,
        durationMs: 1,
        targetIndex: 0,
      },
      scheduledAt: "2026-09-01T00:02:00.000Z",
    });
    const evidence = observer.finalize();
    assert.equal(evidence.metrics.sseReconnectObserved, true);
    assert.equal(evidence.injections[0].pass, true);

    await driver.enableEmergencyStop();
    await driver.disableEmergencyStop();
    const emergencyObserver = new SoakEvidenceObserver({
      expectedResponsibilities: 10,
    });
    emergencyObserver.scheduleFault({
      id: "emergency-fault-1",
      kind: "emergency_stop",
      scheduledAt: "2026-09-01T00:04:00.000Z",
    });
    await driver.captureEvidence(emergencyObserver, {
      kind: "post_fault",
      fault: {
        id: "emergency-fault-1",
        kind: "emergency_stop",
        atMs: 1,
        durationMs: 1,
        targetIndex: 0,
      },
      scheduledAt: "2026-09-01T00:04:00.000Z",
    });
    assert.equal(emergencyObserver.finalize().injections[0]?.pass, true);
    await activeSession.close();
    assert.equal((await driver.provenance()).runner.browser, "Chromium 140.0");
    await driver.stop({ keepData: true });
    assert.equal(log.includes("harness:stop"), false);
    assert.deepEqual(
      log.filter((item) => item.startsWith("browser:offline")),
      ["browser:offline:true", "browser:offline:false"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Docker driver rejects non-loopback APIs before a token can be sent", () => {
  let requests = 0;
  assert.throws(
    () =>
      new DockerWallClockDriver({
        runId: "soak-safe",
        seed: 1,
        durationHours: 1,
        workspaceRoot: process.cwd(),
        controlDirectory: process.cwd(),
        baseUrl: "https://example.com",
        operatorToken: "must-not-leak",
        fetchImpl: async () => {
          requests += 1;
          return Response.json({});
        },
      }),
    /loopback/,
  );
  assert.equal(requests, 0);
});

test("Docker driver stop closes an active browser session before the runtime", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-driver-test-"));
  const log: string[] = [];
  let receivedSignal: AbortSignal | undefined;
  let receivedCleanupTimeoutMs: number | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/readyz") {
      return Response.json({ status: "ready" });
    }
    if (url.pathname === "/api/ops/instances") {
      return Response.json({
        instances: [
          {
            id: "api-1",
            role: "api",
            effectiveState: "healthy",
            schedulerEnabled: false,
          },
          {
            id: "worker-1",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
          {
            id: "worker-2",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
        ],
      });
    }
    if (url.pathname === "/api/tasks" && init?.method === "POST") {
      return Response.json({ id: 7 }, { status: 201 });
    }
    if (url.pathname === "/api/tasks/7/operations") {
      return Response.json(operationsSnapshot({ cursor: "1" }));
    }
    return Response.json({ emergencyStopEnabled: false });
  };
  try {
    const driver = new DockerWallClockDriver({
      runId: "stop-active-browser",
      seed: 1,
      durationHours: 1 / 60,
      workspaceRoot: process.cwd(),
      controlDirectory: directory,
      baseUrl: "http://127.0.0.1:5000",
      operatorToken: "token",
      harness: harness(log),
      fetchImpl,
      topologyTimeoutMs: 100,
      browserSessionFactory: async (input) => {
        receivedSignal = input.signal;
        receivedCleanupTimeoutMs = input.cleanupTimeoutMs;
        return {
          sample: async () => ({
            runtimeLabel: "Canlı",
            incidentVisible: false,
            reconnectCursorAdvanced: false,
            pageErrors: [],
          }),
          screenshot: async () => undefined,
          close: async () => {
            log.push("browser:close");
          },
        };
      },
    });
    await driver.start();
    const creationController = new AbortController();
    await driver.createBrowserSession(creationController.signal, 1_234);
    assert.equal(receivedSignal, creationController.signal);
    assert.equal(receivedCleanupTimeoutMs, 1_234);
    await driver.stop({ keepData: false });
    assert.ok(log.indexOf("browser:close") >= 0);
    assert.ok(log.indexOf("browser:close") < log.indexOf("harness:stop"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Docker driver retries cleanup authority retained by a partial harness start", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-driver-test-"));
  let stopCalls = 0;
  const partialHarness = harness([]);
  partialHarness.start = async () => {
    throw new Error("simulated partial harness start");
  };
  partialHarness.stop = async () => {
    stopCalls += 1;
    if (stopCalls === 1) throw new Error("simulated harness cleanup failure");
  };
  try {
    const driver = new DockerWallClockDriver({
      runId: "partial-harness-start",
      seed: 1,
      durationHours: 1 / 60,
      workspaceRoot: process.cwd(),
      controlDirectory: directory,
      baseUrl: "http://127.0.0.1:5000",
      operatorToken: "token",
      harness: partialHarness,
      fetchImpl: async () =>
        Response.json({ error: "unused" }, { status: 500 }),
      topologyTimeoutMs: 100,
    });
    await assert.rejects(
      driver.start(),
      (error: unknown) =>
        error instanceof AggregateError &&
        error.errors.some((item) => String(item).includes("partial harness")) &&
        error.errors.some((item) => String(item).includes("cleanup failure")),
    );
    assert.equal(stopCalls, 1);
    await driver.stop({ keepData: false });
    await driver.stop({ keepData: false });
    assert.equal(stopCalls, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Docker harness environment binds one control directory and four exact secret files", () => {
  const workspaceRoot = path.resolve("D:/agentic-os-test");
  const controlDirectory = path.resolve("D:/agentic-os-test-control");
  const environment = createDockerWallClockEnvironment({
    runId: "soak-env",
    seed: 11,
    workspaceRoot,
    controlDirectory,
    environment: { KEEP_ME: "yes" },
  });
  assert.equal(
    environment.AGENTIC_SECRET_GID,
    String(process.getgid?.() ?? 1000),
  );
  assert.deepEqual(
    {
      keep: environment.KEEP_ME,
      runId: environment.ENDURANCE_RUN_ID,
      seed: environment.ENDURANCE_SEED,
      agents: environment.ENDURANCE_EXPECTED_AGENTS,
      control: environment.ENDURANCE_CONTROL_DIR_HOST,
      database: environment.ENDURANCE_DATABASE_URL_SECRET_FILE,
      operator: environment.ENDURANCE_OPERATOR_TOKEN_SECRET_FILE,
      controlKey: environment.ENDURANCE_RUNTIME_CONTROL_KEY_SECRET_FILE,
      postgres: environment.ENDURANCE_POSTGRES_PASSWORD_SECRET_FILE,
    },
    {
      keep: "yes",
      runId: "soak-env",
      seed: "11",
      agents: "10",
      control: controlDirectory,
      database: path.join(workspaceRoot, ".secrets", "database_url"),
      operator: path.join(workspaceRoot, ".secrets", "operator_auth_token"),
      controlKey: path.join(workspaceRoot, ".secrets", "runtime_control_key"),
      postgres: path.join(workspaceRoot, ".secrets", "postgres_password"),
    },
  );
});

test("Docker driver fails closed when irreversible receipts lack a normalized effect key", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-driver-test-"));
  let snapshot = operationsSnapshot({ cursor: "1" });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/readyz")
      return Response.json({ status: "ready" });
    if (url.pathname === "/api/ops/instances") {
      return Response.json({
        instances: [
          {
            id: "api-1",
            role: "api",
            effectiveState: "healthy",
            schedulerEnabled: false,
          },
          {
            id: "worker-1",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
          {
            id: "worker-2",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
        ],
      });
    }
    if (url.pathname === "/api/tasks" && init?.method === "POST") {
      return Response.json({ id: 7 }, { status: 201 });
    }
    if (url.pathname === "/api/tasks/7/operations")
      return Response.json(snapshot);
    return Response.json({ emergencyStopEnabled: false });
  };
  try {
    const driver = new DockerWallClockDriver({
      runId: "soak-irreversible",
      seed: 1,
      durationHours: 1 / 60,
      workspaceRoot: process.cwd(),
      controlDirectory: directory,
      baseUrl: "http://127.0.0.1:5000",
      operatorToken: "token",
      harness: harness([]),
      fetchImpl,
      topologyTimeoutMs: 100,
    });
    await driver.start();
    snapshot = operationsSnapshot({
      cursor: "2",
      attempts: [
        {
          id: "attempt-risk",
          taskId: 7,
          agentId: 1,
          attemptNumber: 1,
          cycleNumber: 0,
          state: "succeeded",
          finishedAt: "2026-09-01T00:00:10.000Z",
        },
      ],
      receipts: [
        {
          id: "opaque-receipt-id",
          originAttemptId: "attempt-risk",
          state: "succeeded",
          toolName: "browser_click",
          sideEffectClass: "at_most_once",
          reservedAt: "2026-09-01T00:00:05.000Z",
          finishedAt: "2026-09-01T00:00:09.000Z",
          invocations: [
            {
              id: "invocation-risk",
              state: "succeeded",
              effectStartedAt: "2026-09-01T00:00:08.000Z",
              finishedAt: "2026-09-01T00:00:09.000Z",
            },
          ],
        },
      ],
    });
    await assert.rejects(
      driver.captureEvidence(
        new SoakEvidenceObserver({ expectedResponsibilities: 10 }),
        { kind: "minute", minute: 1 },
      ),
      /normalized operation key/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Docker driver ingests each succeeded irreversible receipt once and detects duplicate effect keys", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-driver-test-"));
  let snapshot = operationsSnapshot({ cursor: "1" });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/readyz")
      return Response.json({ status: "ready" });
    if (url.pathname === "/api/ops/instances") {
      return Response.json({
        instances: [
          {
            id: "api-1",
            role: "api",
            effectiveState: "healthy",
            schedulerEnabled: false,
          },
          {
            id: "worker-1",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
          {
            id: "worker-2",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
        ],
      });
    }
    if (url.pathname === "/api/tasks" && init?.method === "POST") {
      return Response.json({ id: 7 }, { status: 201 });
    }
    if (url.pathname === "/api/tasks/7/operations")
      return Response.json(snapshot);
    return Response.json({ emergencyStopEnabled: false });
  };
  const duplicateKey = `op:v1:${"c".repeat(64)}`;
  const receipt = (input: {
    id: string;
    state: string;
    sideEffectClass: string;
    invocations?: unknown[];
  }) => ({
    ...input,
    operationKey: duplicateKey,
    originAttemptId: "attempt-risk",
    toolName: "browser_click",
    reservedAt: "2026-09-01T00:00:05.000Z",
    finishedAt: input.state === "succeeded" ? "2026-09-01T00:00:09.000Z" : null,
    invocations:
      input.invocations ??
      (input.state === "succeeded"
        ? [
            {
              id: `invocation-${input.id}`,
              state: "succeeded",
              effectStartedAt: "2026-09-01T00:00:08.000Z",
              finishedAt: "2026-09-01T00:00:09.000Z",
            },
          ]
        : []),
  });
  try {
    const driver = new DockerWallClockDriver({
      runId: "soak-irreversible-proof",
      seed: 1,
      durationHours: 1 / 60,
      workspaceRoot: process.cwd(),
      controlDirectory: directory,
      baseUrl: "http://127.0.0.1:5000",
      operatorToken: "token",
      harness: harness([]),
      fetchImpl,
      topologyTimeoutMs: 100,
    });
    await driver.start();
    snapshot = operationsSnapshot({
      cursor: "2",
      attempts: [
        {
          id: "attempt-risk",
          taskId: 7,
          agentId: 1,
          attemptNumber: 1,
          cycleNumber: 0,
          state: "succeeded",
          finishedAt: "2026-09-01T00:00:10.000Z",
        },
      ],
      receipts: [
        receipt({
          id: "receipt-risk-1",
          state: "succeeded",
          sideEffectClass: "at_most_once",
        }),
        receipt({
          id: "receipt-risk-2",
          state: "succeeded",
          sideEffectClass: "approval_at_most_once",
        }),
        receipt({
          id: "receipt-idempotent",
          state: "succeeded",
          sideEffectClass: "idempotent",
        }),
        receipt({
          id: "receipt-running",
          state: "running",
          sideEffectClass: "at_most_once",
        }),
      ],
    });
    const observer = new SoakEvidenceObserver({ expectedResponsibilities: 10 });
    snapshot.attempts[0] = {
      ...(snapshot.attempts[0] as Record<string, unknown>),
      state: "running",
      finishedAt: null,
    };
    await driver.captureEvidence(observer, { kind: "minute", minute: 1 });
    assert.equal(
      observer.finalize().metrics.irreversibleReceiptSuccessCount,
      2,
    );
    assert.equal(
      observer
        .finalize()
        .primaryEvidence.filter((row) => row.kind === "receipt_observed")
        .length,
      0,
    );
    snapshot.attempts[0] = {
      ...(snapshot.attempts[0] as Record<string, unknown>),
      state: "lost",
      finishedAt: "2026-09-01T00:00:08.500Z",
    };
    await driver.captureEvidence(observer, { kind: "minute", minute: 2 });
    const evidence = observer.finalize();
    assert.equal(evidence.metrics.irreversibleReceiptSuccessCount, 2);
    assert.equal(evidence.metrics.staleOwnerCommits, 3);
    assert.ok(
      evidence.primaryEvidence
        .filter((row) => row.kind === "receipt_observed")
        .every(
          (row) =>
            (row.data.originAttempt as { state: string }).state === "lost",
        ),
    );
    assert.deepEqual(evidence.metrics.duplicateIrreversibleReceiptKeys, [
      duplicateKey,
    ]);

    snapshot = operationsSnapshot({
      cursor: "3",
      receipts: [
        receipt({
          id: "receipt-double-effect",
          state: "succeeded",
          sideEffectClass: "at_most_once",
          invocations: [
            {
              id: "invocation-double-effect-1",
              state: "succeeded",
              effectStartedAt: "2026-09-01T00:00:07.000Z",
              finishedAt: "2026-09-01T00:00:08.000Z",
            },
            {
              id: "invocation-double-effect-2",
              state: "succeeded",
              effectStartedAt: "2026-09-01T00:00:08.000Z",
              finishedAt: "2026-09-01T00:00:09.000Z",
            },
          ],
        }),
      ],
    });
    await assert.rejects(
      driver.captureEvidence(observer, { kind: "minute", minute: 3 }),
      /exactly one succeeded invocation/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("provider faults reject unrelated incidents and timestamp-only recovery", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-driver-test-"));
  let snapshot = operationsSnapshot({ cursor: "1" });
  let permitEventualRecovery = false;
  let evidenceSleeps = 0;
  let durableEvents: DurableEnduranceEvent[] = [];
  const evidenceHarness = harness([]);
  evidenceHarness.readDurableEnduranceEvents = async () =>
    structuredClone(durableEvents);
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/readyz")
      return Response.json({ status: "ready" });
    if (url.pathname === "/api/ops/instances") {
      return Response.json({
        instances: [
          {
            id: "api-1",
            role: "api",
            effectiveState: "healthy",
            schedulerEnabled: false,
          },
          {
            id: "worker-1",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
          {
            id: "worker-2",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
        ],
      });
    }
    if (url.pathname === "/api/tasks" && init?.method === "POST") {
      return Response.json({ id: 7 }, { status: 201 });
    }
    if (url.pathname === "/api/tasks/7/operations")
      return Response.json(snapshot);
    return Response.json({ emergencyStopEnabled: false });
  };
  try {
    const driver = new DockerWallClockDriver({
      runId: "soak-correlation",
      seed: 1,
      durationHours: 1 / 60,
      workspaceRoot: process.cwd(),
      controlDirectory: directory,
      baseUrl: "http://127.0.0.1:5000",
      operatorToken: "token",
      harness: evidenceHarness,
      fetchImpl,
      topologyTimeoutMs: 100,
      faultEvidenceTimeoutMs: 2_000,
      sleep: async () => {
        evidenceSleeps += 1;
        if (permitEventualRecovery && evidenceSleeps === 1) {
          durableEvents = [
            ...durableEvents,
            {
              id: "101",
              eventType: "error",
              kind: "task_retry_scheduled",
              state: null,
              taskId: 7,
              attemptId: "eventual-provider-incident",
              attemptNumber: 4,
              occurredAt: "2026-09-01T00:03:05.000Z",
              providerFailureKinds: ["timeout"],
            },
            {
              id: "102",
              eventType: "operations_changed",
              kind: "attempt_state_changed",
              state: "succeeded",
              taskId: 7,
              attemptId: "eventual-provider-recovery",
              attemptNumber: 5,
              occurredAt: "2026-09-01T00:03:20.000Z",
              providerFailureKinds: [],
            },
          ];
          snapshot = operationsSnapshot({
            cursor: "5",
            generatedAt: "2026-09-01T00:03:30.000Z",
            incidents: [
              {
                id: "eventual-provider-incident",
                kind: "attempt_state_changed",
                occurredAt: "2026-09-01T00:03:05.000Z",
              },
            ],
            milestones: [
              {
                id: "eventual-provider-recovery",
                kind: "attempt_state_changed",
                occurredAt: "2026-09-01T00:03:20.000Z",
              },
            ],
          });
        }
      },
    });
    await driver.start();
    snapshot = operationsSnapshot({
      cursor: "6",
      attempts: [
        {
          id: "attempt-1",
          taskId: 7,
          agentId: 1,
          attemptNumber: 1,
          cycleNumber: 0,
          state: "succeeded",
          finishedAt: "2026-09-01T00:00:50.000Z",
        },
      ],
    });
    await driver.setProviderFault("provider_timeout", "provider-timeout-1");
    await driver.clearProviderFault("provider-timeout-1");
    const durableReader = evidenceHarness.readDurableEnduranceEvents;
    evidenceHarness.readDurableEnduranceEvents = undefined;
    snapshot = operationsSnapshot({
      cursor: "7",
      incidents: [
        {
          id: "generic-provider-incident",
          kind: "attempt_state_changed",
          occurredAt: "2026-09-01T00:01:05.000Z",
        },
      ],
      milestones: [
        {
          id: "generic-provider-recovery",
          kind: "attempt_state_changed",
          occurredAt: "2026-09-01T00:01:20.000Z",
        },
      ],
    });
    const genericObserver = new SoakEvidenceObserver({
      expectedResponsibilities: 10,
    });
    genericObserver.scheduleFault({
      id: "provider-timeout-1",
      kind: "provider_timeout",
      scheduledAt: "2026-09-01T00:01:00.000Z",
    });
    await assert.rejects(
      driver.captureEvidence(genericObserver, {
        kind: "post_fault",
        fault: {
          id: "provider-timeout-1",
          kind: "provider_timeout",
          atMs: 1,
          durationMs: 1,
          targetIndex: 0,
        },
        scheduledAt: "2026-09-01T00:01:00.000Z",
      }),
      /durable provider evidence/iu,
    );
    evidenceHarness.readDurableEnduranceEvents = durableReader;
    snapshot = operationsSnapshot({
      cursor: "2",
      generatedAt: "2026-09-01T00:01:30.000Z",
      incidents: [
        {
          id: "wrong-kind",
          kind: "runtime_control_changed",
          occurredAt: "2026-09-01T00:01:05.000Z",
        },
      ],
    });
    durableEvents = [
      {
        id: "99",
        eventType: "error",
        kind: "task_retry_scheduled",
        state: null,
        taskId: 8,
        attemptId: "wrong-provider-target",
        attemptNumber: 2,
        occurredAt: "2026-09-01T00:01:05.000Z",
        providerFailureKinds: ["timeout"],
      },
    ];
    const observer = new SoakEvidenceObserver({ expectedResponsibilities: 10 });
    observer.scheduleFault({
      id: "provider-timeout-1",
      kind: "provider_timeout",
      scheduledAt: "2026-09-01T00:01:00.000Z",
    });
    await assert.rejects(
      driver.captureEvidence(observer, {
        kind: "post_fault",
        fault: {
          id: "provider-timeout-1",
          kind: "provider_timeout",
          atMs: 1,
          durationMs: 1,
          targetIndex: 0,
        },
        scheduledAt: "2026-09-01T00:01:00.000Z",
      }),
      /matching durable Operations incident/,
    );

    durableEvents = [
      {
        id: "100",
        eventType: "error",
        kind: "task_retry_scheduled",
        state: null,
        taskId: 7,
        attemptId: "wrong-provider-kind",
        attemptNumber: 2,
        occurredAt: "2026-09-01T00:01:05.000Z",
        providerFailureKinds: ["rate_limit"],
      },
    ];
    await assert.rejects(
      driver.captureEvidence(observer, {
        kind: "post_fault",
        fault: {
          id: "provider-timeout-1",
          kind: "provider_timeout",
          atMs: 1,
          durationMs: 1,
          targetIndex: 0,
        },
        scheduledAt: "2026-09-01T00:01:00.000Z",
      }),
      /matching durable Operations incident/,
    );

    durableEvents = [
      {
        id: "101",
        eventType: "error",
        kind: "task_retry_scheduled",
        state: null,
        taskId: 7,
        attemptId: "wrong-provider-attempt",
        attemptNumber: 99,
        occurredAt: "2026-09-01T00:01:05.000Z",
        providerFailureKinds: ["timeout"],
      },
    ];
    await assert.rejects(
      driver.captureEvidence(observer, {
        kind: "post_fault",
        fault: {
          id: "provider-timeout-1",
          kind: "provider_timeout",
          atMs: 1,
          durationMs: 1,
          targetIndex: 0,
        },
        scheduledAt: "2026-09-01T00:01:00.000Z",
      }),
      /matching durable Operations incident/,
    );

    snapshot = operationsSnapshot({
      cursor: "3",
      generatedAt: "2026-09-01T00:02:30.000Z",
      attempts: [
        {
          id: "attempt-2",
          taskId: 7,
          agentId: 1,
          attemptNumber: 2,
          cycleNumber: 0,
          state: "retrying",
          finishedAt: "2026-09-01T00:01:05.000Z",
        },
      ],
      incidents: [
        {
          id: "right-kind-without-recovery",
          kind: "attempt_state_changed",
          occurredAt: "2026-09-01T00:02:05.000Z",
        },
      ],
    });
    await driver.setProviderFault("provider_timeout", "provider-timeout-2");
    await driver.clearProviderFault("provider-timeout-2");
    durableEvents = [
      {
        id: "100",
        eventType: "error",
        kind: "task_retry_scheduled",
        state: null,
        taskId: 7,
        attemptId: "right-kind-without-recovery",
        attemptNumber: 3,
        occurredAt: "2026-09-01T00:02:05.000Z",
        providerFailureKinds: ["timeout"],
      },
    ];
    const recoveryObserver = new SoakEvidenceObserver({
      expectedResponsibilities: 10,
    });
    evidenceSleeps = 0;
    recoveryObserver.scheduleFault({
      id: "provider-timeout-2",
      kind: "provider_timeout",
      scheduledAt: "2026-09-01T00:02:00.000Z",
    });
    await assert.rejects(
      driver.captureEvidence(recoveryObserver, {
        kind: "post_fault",
        fault: {
          id: "provider-timeout-2",
          kind: "provider_timeout",
          atMs: 1,
          durationMs: 1,
          targetIndex: 0,
        },
        scheduledAt: "2026-09-01T00:02:00.000Z",
      }),
      /durable recovery evidence/,
    );
    assert.equal(evidenceSleeps, 2);

    evidenceSleeps = 0;
    permitEventualRecovery = true;
    snapshot = operationsSnapshot({
      cursor: "4",
      generatedAt: "2026-09-01T00:03:10.000Z",
      attempts: [
        {
          id: "attempt-3",
          taskId: 7,
          agentId: 1,
          attemptNumber: 3,
          cycleNumber: 0,
          state: "retrying",
          finishedAt: "2026-09-01T00:02:05.000Z",
        },
      ],
      incidents: [
        {
          id: "eventual-provider-incident",
          kind: "attempt_state_changed",
          occurredAt: "2026-09-01T00:03:05.000Z",
        },
      ],
    });
    await driver.setProviderFault("provider_timeout", "provider-timeout-3");
    await driver.clearProviderFault("provider-timeout-3");
    // A timeline entry can precede the exact provider incident. Keep polling
    // within the evidence budget instead of treating unrelated activity as failure.
    durableEvents = [];
    const eventualObserver = new SoakEvidenceObserver({
      expectedResponsibilities: 10,
    });
    eventualObserver.scheduleFault({
      id: "provider-timeout-3",
      kind: "provider_timeout",
      scheduledAt: "2026-09-01T00:03:00.000Z",
    });
    await driver.captureEvidence(eventualObserver, {
      kind: "post_fault",
      fault: {
        id: "provider-timeout-3",
        kind: "provider_timeout",
        atMs: 1,
        durationMs: 1,
        targetIndex: 0,
      },
      scheduledAt: "2026-09-01T00:03:00.000Z",
    });
    assert.equal(evidenceSleeps, 1);
    assert.equal(eventualObserver.finalize().injections[0]?.pass, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("database recovery uses a fresh healthy observation before the next minute bucket", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-db-recovery-"));
  const snapshot = operationsSnapshot({ cursor: "2" });
  let sleeps = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/readyz")
      return Response.json({ status: "ready" });
    if (url.pathname === "/api/ops/instances")
      return Response.json({
        instances: [
          {
            id: "api-1",
            role: "api",
            effectiveState: "healthy",
            schedulerEnabled: false,
          },
          {
            id: "worker-1",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
          {
            id: "worker-2",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
        ],
      });
    if (url.pathname === "/api/tasks" && init?.method === "POST")
      return Response.json({ id: 7 });
    if (url.pathname === "/api/tasks/7/operations")
      return Response.json(snapshot);
    return Response.json({ emergencyStopEnabled: false });
  };
  const driver = new DockerWallClockDriver({
    runId: "soak-database-recovery",
    seed: 1,
    durationHours: 1 / 60,
    workspaceRoot: process.cwd(),
    controlDirectory: directory,
    baseUrl: "http://127.0.0.1:5000",
    operatorToken: "token",
    harness: harness([]),
    fetchImpl,
    topologyTimeoutMs: 100,
    faultEvidenceTimeoutMs: 1_000,
    sleep: async () => {
      sleeps += 1;
      snapshot.generatedAt = "2026-09-01T00:02:21.000Z";
      snapshot.runtime.schedulerTickAgeMs = 1_000;
    },
    now: () => new Date("2026-09-01T00:00:00.000Z"),
  });
  try {
    await driver.start();
    snapshot.generatedAt = "2026-09-01T00:02:20.000Z";
    snapshot.runtime.schedulerTickAgeMs = 6_000;
    snapshot.fleetHealthSamples.push({
      bucketAt: "2026-09-01T00:00:00.000Z",
      sampledAt: "2026-09-01T00:01:03.000Z",
      runtimeTruthState: "offline",
      healthyWorkerCount: 0,
      staleWorkerCount: 0,
      schedulerTickAgeMs: null,
    });
    const observer = new SoakEvidenceObserver({ expectedResponsibilities: 10 });
    observer.scheduleFault({
      id: "database-unavailable-1",
      kind: "database_unavailable",
      scheduledAt: "2026-09-01T00:01:00.000Z",
    });
    await driver.captureEvidence(observer, {
      kind: "post_fault",
      fault: {
        id: "database-unavailable-1",
        kind: "database_unavailable",
        atMs: 1,
        durationMs: 75_000,
        targetIndex: 0,
      },
      scheduledAt: "2026-09-01T00:01:00.000Z",
    });
    const result = observer.finalize();
    assert.equal(result.injections[0]?.pass, true);
    assert.equal(result.injections[0]?.recoveredAt, "2026-09-01T00:02:21.000Z");
    assert.equal(
      sleeps,
      1,
      "stale scheduler truth must not establish recovery",
    );
    assert.equal(
      snapshot.fleetHealthSamples.length,
      1,
      "the historical offline bucket remains intact",
    );
    const recovery = result.primaryEvidence.find(
      (event) => event.kind === "fault_recovered",
    );
    assert.equal(recovery?.data.sourceKind, "runtime_snapshot");
    assert.equal(
      (recovery?.data.runtimeEvidence as any)?.healthyWorkerCount,
      2,
    );
  } finally {
    await driver.stop({ keepData: false });
    await rm(directory, { recursive: true, force: true });
  }
});

test("worker replacement healthy runtime event is durable recovery for a stale runtime incident", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentic-driver-test-"));
  const snapshot = operationsSnapshot({
    cursor: "2",
    generatedAt: "2026-09-01T00:01:10.000Z",
  });
  let healthSleeps = 0;
  const evidenceHarness = harness([]);
  evidenceHarness.readDurableEnduranceEvents = async () => [
    {
      id: "201",
      eventType: "operations_changed",
      kind: "runtime_state_changed",
      state: "stale",
      taskId: null,
      attemptId: null,
      attemptNumber: null,
      occurredAt: "2026-09-01T00:01:05.000Z",
      providerFailureKinds: [],
    },
    {
      id: "202",
      eventType: "operations_changed",
      kind: "runtime_state_changed",
      state: "healthy",
      taskId: null,
      attemptId: null,
      attemptNumber: null,
      occurredAt: "2026-09-01T00:01:08.000Z",
      providerFailureKinds: [],
    },
  ];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/readyz")
      return Response.json({ status: "ready" });
    if (url.pathname === "/api/ops/instances") {
      return Response.json({
        instances: [
          {
            id: "api-1",
            role: "api",
            effectiveState: "healthy",
            schedulerEnabled: false,
          },
          {
            id: "worker-replacement",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
          {
            id: "worker-survivor",
            role: "worker",
            effectiveState: "healthy",
            schedulerEnabled: true,
          },
        ],
      });
    }
    if (url.pathname === "/api/tasks" && init?.method === "POST") {
      return Response.json({ id: 7 }, { status: 201 });
    }
    if (url.pathname === "/api/tasks/7/operations") {
      return Response.json(snapshot);
    }
    return Response.json({ emergencyStopEnabled: false });
  };
  const driver = new DockerWallClockDriver({
    runId: "soak-worker-runtime-recovery",
    seed: 1,
    durationHours: 1 / 60,
    workspaceRoot: process.cwd(),
    controlDirectory: directory,
    baseUrl: "http://127.0.0.1:5000",
    operatorToken: "token",
    harness: evidenceHarness,
    fetchImpl,
    topologyTimeoutMs: 100,
    faultEvidenceTimeoutMs: 1_000,
    sleep: async () => {
      healthSleeps += 1;
      snapshot.runtime.state = "live";
    },
    now: () => new Date("2026-09-01T00:00:00.000Z"),
  });
  try {
    await driver.start();
    snapshot.runtime.state = "degraded";
    const observer = new SoakEvidenceObserver({ expectedResponsibilities: 10 });
    observer.scheduleFault({
      id: "worker-loss-1",
      kind: "worker_loss",
      scheduledAt: "2026-09-01T00:01:00.000Z",
    });
    await driver.captureEvidence(observer, {
      kind: "post_fault",
      fault: {
        id: "worker-loss-1",
        kind: "worker_loss",
        atMs: 1,
        durationMs: 8_000,
        targetIndex: 0,
      },
      scheduledAt: "2026-09-01T00:01:00.000Z",
    });
    const injection = observer.finalize().injections[0];
    assert.equal(injection?.pass, true);
    assert.equal(injection?.incidentId?.includes("postgres:201"), true);
    assert.equal(injection?.recoveredAt, "2026-09-01T00:01:08.000Z");
    assert.equal(
      healthSleeps,
      1,
      "a fresh healthy fleet snapshot is required before recording recovery",
    );
  } finally {
    await driver.stop({ keepData: false });
    await rm(directory, { recursive: true, force: true });
  }
});
