import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createEnduranceSpendConfiguration } from "./spend-configuration";

import type { SoakEvidenceObserver } from "./soak-observer";
import {
  runNativePostgresSmoke,
  type NativePostgresSmokeDriver,
} from "./native-postgres-smoke";

test("native smoke proves real topology, worker replacement, database outage, and ten responsibilities", async () => {
  const calls: string[] = [];
  let workerOnePid = 1001;
  let workerOneRunning = true;
  let databaseRunning = true;
  let captureCount = 0;
  const services = () =>
    [
      "app",
      ...(databaseRunning ? ["db"] : []),
      ...(workerOneRunning ? ["worker-1"] : []),
      "worker-2",
    ].sort();
  const driver: NativePostgresSmokeDriver = {
    spendConfiguration: () => createEnduranceSpendConfiguration({}).provenance,
    start: async () => {
      calls.push("start");
      return { projectId: 91, expectedResponsibilities: 10 };
    },
    captureEvidence: async (observer: SoakEvidenceObserver) => {
      calls.push("capture");
      captureCount += 1;
      if (captureCount === 1) observer.completeResponsibilities(10);
      if (captureCount >= 2) {
        observer.observeHealth({
          minute: 1,
          reportedState: "healthy",
          truthState: "healthy",
        });
      }
    },
    createBrowserSession: async () => {
      throw new Error("browser is not part of native process smoke");
    },
    provenance: async () => ({
      runner: {
        os: "Windows",
        node: process.version,
        postgres: "PostgreSQL 17.11",
        browser: "not-run",
      },
      workflowRunId: null,
      configuration: {},
    }),
    stop: async ({ keepData }) => {
      calls.push(`stop:${keepData}`);
    },
    now: () => new Date("2026-09-01T00:00:00.000Z"),
    listActiveWorkers: async () =>
      workerOneRunning ? ["worker-1", "worker-2"] : ["worker-2"],
    killWorker: async () => {
      calls.push("worker:kill");
      workerOneRunning = false;
    },
    restartWorker: async () => {
      calls.push("worker:restart");
      workerOnePid = 2001;
      workerOneRunning = true;
    },
    setProviderFault: async () => undefined,
    clearProviderFault: async () => undefined,
    pauseDatabase: async () => {
      calls.push("db:pause");
      databaseRunning = false;
    },
    resumeDatabase: async () => {
      calls.push("db:resume");
      databaseRunning = true;
    },
    disconnectObserverStream: async () => undefined,
    reconnectObserverStream: async () => undefined,
    enableEmergencyStop: async () => undefined,
    disableEmergencyStop: async () => undefined,
    sleep: async () => undefined,
    nativeServices: async () => services(),
    nativePostgresVersion: async () => "PostgreSQL 17.11",
    diagnostics: () => ({
      runDirectory: path.resolve("D:/evidence/runtime"),
      baseUrl: "http://127.0.0.1:55126/",
      apiPort: 55126,
      databasePort: 55435,
      harness: {
        runDirectory: path.resolve("D:/evidence/runtime"),
        logDirectory: path.resolve("D:/evidence/runtime/logs"),
        apiPort: 55126,
        databasePort: 55435,
        processes: [
          {
            name: "app",
            pid: 1000,
            running: true,
            exitCode: null,
            signal: null,
          },
          {
            name: "worker-1",
            pid: workerOnePid,
            running: workerOneRunning,
            exitCode: null,
            signal: null,
          },
          {
            name: "worker-2",
            pid: 1002,
            running: true,
            exitCode: null,
            signal: null,
          },
        ],
      },
    }),
  };

  const report = await runNativePostgresSmoke(
    {
      runId: "native-smoke-test",
      seed: 240_901,
      workspaceRoot: path.resolve("D:/workspace"),
      postgresRoot: path.resolve("D:/postgres"),
      runDirectory: path.resolve("D:/evidence/runtime"),
      workerOutageMs: 1,
      databaseOutageMs: 1,
      responsibilityTimeoutMs: 100,
    },
    { driver, sleep: async () => undefined },
  );

  assert.equal(report.pass, true);
  assert.equal(report.failure, null);
  assert.equal(report.topology.api, 1);
  assert.equal(report.topology.workers, 2);
  assert.equal(report.topology.agents, 10);
  assert.equal(report.postgresVersion, "PostgreSQL 17.11");
  assert.equal(report.projectId, 91);
  assert.equal(report.completedResponsibilities >= 10, true);
  assert.equal(report.workerFault.oldPid, 1001);
  assert.equal(report.workerFault.newPid, 2001);
  assert.equal(report.workerFault.absentWhileKilled, true);
  assert.equal(report.workerFault.recovered, true);
  assert.equal(report.databaseFault.unavailableObserved, true);
  assert.equal(report.databaseFault.recovered, true);
  assert.equal("operatorToken" in report, false);
  assert.equal("databaseUrl" in report, false);
  assert.deepEqual(calls, [
    "start",
    "worker:kill",
    "worker:restart",
    "db:pause",
    "db:resume",
    "capture",
    "capture",
    "stop:false",
  ]);
});

test("native smoke preserves bounded unfinished-agent evidence when ten responsibilities miss the deadline", async () => {
  let workerPid = 1001;
  let databaseRunning = true;
  let workerRunning = true;
  const services = () =>
    [
      "app",
      ...(databaseRunning ? ["db"] : []),
      ...(workerRunning ? ["worker-1"] : []),
      "worker-2",
    ].sort();
  const driver = {
    spendConfiguration: () => createEnduranceSpendConfiguration({}).provenance,
    start: async () => ({ projectId: 91, expectedResponsibilities: 10 }),
    captureEvidence: async (observer: SoakEvidenceObserver) => {
      observer.completeResponsibilities(9);
      observer.observeHealth({
        minute: 1,
        reportedState: "healthy",
        truthState: "healthy",
      });
    },
    createBrowserSession: async () => {
      throw new Error("browser is not part of native process smoke");
    },
    provenance: async () => ({
      runner: {
        os: "Windows",
        node: process.version,
        postgres: "PostgreSQL 17.10",
        browser: "not-run",
      },
      workflowRunId: null,
      configuration: {},
    }),
    stop: async () => undefined,
    now: () => new Date("2026-09-01T00:00:00.000Z"),
    listActiveWorkers: async () =>
      workerRunning
        ? (["worker-1", "worker-2"] as const)
        : (["worker-2"] as const),
    killWorker: async () => {
      workerRunning = false;
    },
    restartWorker: async () => {
      workerPid = 2001;
      workerRunning = true;
    },
    setProviderFault: async () => undefined,
    clearProviderFault: async () => undefined,
    pauseDatabase: async () => {
      databaseRunning = false;
    },
    resumeDatabase: async () => {
      databaseRunning = true;
    },
    disconnectObserverStream: async () => undefined,
    reconnectObserverStream: async () => undefined,
    enableEmergencyStop: async () => undefined,
    disableEmergencyStop: async () => undefined,
    sleep: async () => undefined,
    nativeServices: async () => services(),
    nativePostgresVersion: async () => "PostgreSQL 17.10",
    inspectIncompleteResponsibilities: async () => [
      { agentId: 10, attemptState: "lost" as const, attemptNumber: 1 },
    ],
    diagnostics: () => ({
      runDirectory: path.resolve("D:/evidence/runtime"),
      baseUrl: "http://127.0.0.1:55126/",
      apiPort: 55126,
      databasePort: 55435,
      harness: {
        runDirectory: path.resolve("D:/evidence/runtime"),
        logDirectory: path.resolve("D:/evidence/runtime/logs"),
        apiPort: 55126,
        databasePort: 55435,
        processes: [
          {
            name: "app",
            pid: 1000,
            running: true,
            exitCode: null,
            signal: null,
          },
          {
            name: "worker-1",
            pid: workerPid,
            running: workerRunning,
            exitCode: null,
            signal: null,
          },
          {
            name: "worker-2",
            pid: 1002,
            running: true,
            exitCode: null,
            signal: null,
          },
        ],
      },
    }),
  };

  const report = await runNativePostgresSmoke(
    {
      runId: "native-smoke-deadline",
      seed: 240_901,
      workspaceRoot: path.resolve("D:/workspace"),
      postgresRoot: path.resolve("D:/postgres"),
      runDirectory: path.resolve("D:/evidence/runtime"),
      workerOutageMs: 0,
      databaseOutageMs: 0,
      responsibilityTimeoutMs: 0,
    },
    { driver, sleep: async () => undefined },
  );

  assert.equal(report.pass, false);
  assert.equal(report.completedResponsibilities, 9);
  assert.match(report.failure ?? "", /did not reach 10/iu);
  assert.deepEqual(
    (report as unknown as { incompleteResponsibilities: unknown })
      .incompleteResponsibilities,
    [{ agentId: 10, attemptState: "lost", attemptNumber: 1 }],
  );
});

test("native smoke retains cleanup authority after partial startup and reports cleanup failure", async () => {
  let stopCalls = 0;
  const driver = {
    start: async () => {
      throw new Error("partial native startup failed");
    },
    stop: async () => {
      stopCalls += 1;
      if (stopCalls === 1) throw new Error("owned cleanup timed out");
    },
    now: () => new Date("2026-09-01T00:00:00.000Z"),
    diagnostics: () => ({
      runDirectory: path.resolve("D:/evidence/runtime"),
      baseUrl: "http://127.0.0.1:55126/",
      apiPort: 55126,
      databasePort: 55435,
      harness: null,
    }),
  } as unknown as NativePostgresSmokeDriver;
  const options = {
    runId: "native-partial-smoke",
    seed: 1,
    workspaceRoot: path.resolve("D:/workspace"),
    postgresRoot: path.resolve("D:/postgres"),
    runDirectory: path.resolve("D:/evidence/runtime"),
  };

  const first = await runNativePostgresSmoke(options, { driver });
  assert.match(first.failure ?? "", /partial native startup failed/iu);
  assert.match(
    first.failure ?? "",
    /cleanup failed: owned cleanup timed out/iu,
  );
  const second = await runNativePostgresSmoke(options, { driver });
  assert.match(second.failure ?? "", /partial native startup failed/iu);
  assert.doesNotMatch(second.failure ?? "", /cleanup failed/iu);
  assert.equal(stopCalls, 2);
});
