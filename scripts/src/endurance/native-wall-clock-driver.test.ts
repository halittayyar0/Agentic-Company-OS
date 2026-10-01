import assert from "node:assert/strict";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { DockerWallClockDriverOptions } from "./docker-wall-clock-driver";
import type { NativePostgresEnduranceHarnessOptions } from "./native-postgres-harness";
import { NativeWallClockDriver } from "./native-wall-clock-driver";
import type { WallClockRuntimeDriver } from "./run-wall-clock-soak";
import { createEnduranceSpendConfiguration } from "./spend-configuration";

test("native wall-clock driver lazily wires portable PostgreSQL into the shared coordinator contract", async () => {
  const calls: string[] = [];
  const capturedHarnessOptions: NativePostgresEnduranceHarnessOptions[] = [];
  const capturedInnerOptions: DockerWallClockDriverOptions[] = [];
  const inner: WallClockRuntimeDriver = {
    spendConfiguration: () => createEnduranceSpendConfiguration({}).provenance,
    start: async () => {
      calls.push("start");
      return { projectId: 73, expectedResponsibilities: 10 };
    },
    captureEvidence: async () => {
      calls.push("capture");
    },
    inspectIncompleteResponsibilities: async () => [
      { agentId: 10, attemptState: "lost", attemptNumber: 2 },
    ],
    createBrowserSession: async () => ({
      sample: async () => ({
        runtimeLabel: "Canlı",
        incidentVisible: true,
        reconnectCursorAdvanced: true,
        pageErrors: [],
      }),
      screenshot: async () => undefined,
      close: async () => undefined,
    }),
    provenance: async () => ({
      runner: {
        os: "windows",
        node: process.version,
        postgres: "PostgreSQL 17.10",
        browser: "Chromium",
      },
      workflowRunId: null,
      configuration: { runtime: "native" },
    }),
    stop: async ({ keepData }) => {
      calls.push(`stop:${keepData}`);
    },
    now: () => new Date("2026-09-01T00:00:00.000Z"),
    listActiveWorkers: async () => ["worker-1", "worker-2"],
    killWorker: async (worker) => {
      calls.push(`kill:${worker}`);
    },
    restartWorker: async (worker) => {
      calls.push(`restart:${worker}`);
    },
    setProviderFault: async (kind, id) => {
      calls.push(`set:${kind}:${id}`);
    },
    clearProviderFault: async (id) => {
      calls.push(`clear:${id}`);
    },
    pauseDatabase: async () => {
      calls.push("db:pause");
    },
    resumeDatabase: async () => {
      calls.push("db:resume");
    },
    disconnectObserverStream: async () => {
      calls.push("sse:down");
    },
    reconnectObserverStream: async () => {
      calls.push("sse:up");
    },
    enableEmergencyStop: async () => {
      calls.push("stop:on");
    },
    disableEmergencyStop: async () => {
      calls.push("stop:off");
    },
    sleep: async () => undefined,
  };

  const driver = new NativeWallClockDriver({
    runId: "native-driver-test",
    environment: { MAX_RECURRING_FAMILY_DAILY_TOKENS: "2.5e6" },
    seed: 240_901,
    durationHours: 1 / 60,
    workspaceRoot: path.resolve("D:/workspace"),
    postgresRoot: path.resolve("D:/postgres"),
    runDirectory: path.resolve("D:/run"),
    reservePorts: async () => [55125, 55434],
    harnessFactory: (options) => {
      capturedHarnessOptions.push(options);
      return {
        start: async () => undefined,
        stop: async () => undefined,
        killWorker: async () => undefined,
        restartWorker: async () => undefined,
        pauseDatabase: async () => undefined,
        resumeDatabase: async () => undefined,
        listRunningServices: async () => ["app", "db", "worker-1", "worker-2"],
        postgresVersion: async () => "PostgreSQL 17.10",
        runtimeAttestation: async () => ({
          kind: "native-postgres",
          nodeVersion: "v24.19.0",
          postgresVersion: "PostgreSQL 17.10",
          postgresToolchainSha256: "a".repeat(64),
          postgresBinaries: [],
          postgresDistribution: {
            rootPath: path.resolve("D:/postgres"),
            startSha256: "d".repeat(64),
            endSha256: "d".repeat(64),
            fileCount: 6,
            totalBytes: 42,
          },
          nodeExecutableSha256: "b".repeat(64),
          pnpmLockSha256: "c".repeat(64),
        }),
        state: () => ({
          running: true,
          projectName: "agentic-os-native-native-driver-test",
          runId: "native-driver-test",
        }),
      };
    },
    innerDriverFactory: (options) => {
      capturedInnerOptions.push(options);
      return inner;
    },
  });

  assert.equal(capturedHarnessOptions.length, 0);
  assert.deepEqual(await driver.start(), {
    projectId: 73,
    expectedResponsibilities: 10,
  });
  const harnessOptions = capturedHarnessOptions[0];
  const innerOptions = capturedInnerOptions[0];
  assert.ok(harnessOptions);
  assert.ok(innerOptions);
  assert.equal(
    harnessOptions.environment?.MAX_RECURRING_FAMILY_DAILY_TOKENS,
    "2500000",
  );
  assert.equal(
    innerOptions.environment?.MAX_RECURRING_FAMILY_DAILY_TOKENS,
    "2500000",
  );
  assert.equal(harnessOptions.environment?.MAX_TASK_STEPS, "0");
  assert.equal(harnessOptions.apiPort, 55125);
  assert.equal(harnessOptions.databasePort, 55434);
  assert.equal(harnessOptions.operatorToken.length >= 32, true);
  assert.equal(harnessOptions.runtimeControlKey.length >= 32, true);
  assert.equal(innerOptions.baseUrl, "http://127.0.0.1:55125/");
  assert.equal(innerOptions.operatorToken, harnessOptions.operatorToken);
  assert.equal(innerOptions.controlDirectory, path.resolve("D:/run"));
  assert.equal(
    (await driver.provenance()).configuration.runtime,
    "native-postgres",
  );
  assert.deepEqual(await driver.inspectIncompleteResponsibilities?.(), [
    { agentId: 10, attemptState: "lost", attemptNumber: 2 },
  ]);

  await driver.killWorker("worker-1");
  await driver.restartWorker("worker-1");
  await driver.pauseDatabase();
  await driver.resumeDatabase();
  await driver.stop({ keepData: false });
  assert.deepEqual(calls, [
    "start",
    "kill:worker-1",
    "restart:worker-1",
    "db:pause",
    "db:resume",
    "stop:false",
  ]);
  await assert.rejects(driver.start(), /already started/iu);
});

test("native driver creates the exact control directory before the shared fault writer starts", async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), "agentic-native-driver-control-test-"),
  );
  const runDirectory = path.join(parent, "run");
  const inner = {
    start: async () => {
      const metadata = await lstat(runDirectory);
      assert.equal(metadata.isDirectory(), true);
      return { projectId: 1, expectedResponsibilities: 10 };
    },
  } as WallClockRuntimeDriver;
  const driver = new NativeWallClockDriver({
    runId: "native-control-dir",
    seed: 1,
    durationHours: 1 / 60,
    workspaceRoot: process.cwd(),
    postgresRoot: parent,
    runDirectory,
    reservePorts: async () => [55127, 55436],
    harnessFactory: () => ({
      start: async () => undefined,
      stop: async () => undefined,
      killWorker: async () => undefined,
      restartWorker: async () => undefined,
      pauseDatabase: async () => undefined,
      resumeDatabase: async () => undefined,
      listRunningServices: async () => [],
      postgresVersion: async () => "PostgreSQL 17.10",
      runtimeAttestation: async () => ({
        kind: "native-postgres",
        nodeVersion: "v24.19.0",
        postgresVersion: "PostgreSQL 17.10",
        postgresToolchainSha256: "a".repeat(64),
        postgresBinaries: [],
        postgresDistribution: {
          rootPath: path.resolve("D:/postgres"),
          startSha256: "d".repeat(64),
          endSha256: "d".repeat(64),
          fileCount: 6,
          totalBytes: 42,
        },
        nodeExecutableSha256: "b".repeat(64),
        pnpmLockSha256: "c".repeat(64),
      }),
      state: () => ({
        running: false,
        projectName: "native",
        runId: "native-control-dir",
      }),
    }),
    innerDriverFactory: () => inner,
  });
  try {
    await driver.start();
  } finally {
    const resolvedParent = path.resolve(parent);
    assert.equal(path.dirname(resolvedParent), path.resolve(tmpdir()));
    assert.match(
      path.basename(resolvedParent),
      /^agentic-native-driver-control-test-/u,
    );
    await rm(resolvedParent, { recursive: true, force: true });
  }
});
