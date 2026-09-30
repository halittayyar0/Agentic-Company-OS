import path from "node:path";

import { SoakEvidenceObserver } from "./soak-observer";
import {
  NativeWallClockDriver,
  type NativeWallClockDiagnostics,
} from "./native-wall-clock-driver";
import type { WallClockRuntimeDriver } from "./run-wall-clock-soak";

export interface NativePostgresSmokeDriver extends WallClockRuntimeDriver {
  nativeServices(): Promise<string[]>;
  nativePostgresVersion(): Promise<string>;
  diagnostics(): NativeWallClockDiagnostics;
}

export interface NativePostgresSmokeOptions {
  runId: string;
  seed: number;
  workspaceRoot: string;
  postgresRoot: string;
  runDirectory: string;
  workerOutageMs?: number;
  databaseOutageMs?: number;
  responsibilityTimeoutMs?: number;
}

export interface NativePostgresSmokeReport {
  schemaVersion: 1;
  kind: "native_postgres_process_smoke";
  runId: string;
  seed: number;
  startedAt: string;
  completedAt: string;
  pass: boolean;
  failure: string | null;
  projectId: number | null;
  postgresVersion: string | null;
  topology: { api: 1; workers: 2; agents: 10; database: "postgres" };
  servicesBefore: string[];
  completedResponsibilities: number;
  expectedResponsibilities: number;
  healthSampleBuckets: number;
  healthTruthMismatches: string[];
  workerFault: {
    target: "worker-1";
    oldPid: number | null;
    newPid: number | null;
    absentWhileKilled: boolean;
    recovered: boolean;
    servicesWhileKilled: string[];
    servicesAfterRecovery: string[];
  };
  databaseFault: {
    unavailableObserved: boolean;
    recovered: boolean;
    servicesWhileUnavailable: string[];
    servicesAfterRecovery: string[];
  };
  evidence: {
    runtimeDirectory: string;
    logDirectory: string;
    apiPort: number | null;
    databasePort: number | null;
  };
}

export interface NativePostgresSmokeDependencies {
  driver?: NativePostgresSmokeDriver;
  sleep?: (milliseconds: number) => Promise<void>;
}

const EXPECTED_SERVICES = ["app", "db", "worker-1", "worker-2"];

function validateOptions(options: NativePostgresSmokeOptions): void {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/u.test(options.runId)) {
    throw new TypeError("runId must be a safe native smoke identity");
  }
  if (!Number.isSafeInteger(options.seed) || options.seed < 0) {
    throw new TypeError("seed must be a non-negative safe integer");
  }
  for (const [label, value] of [
    ["workerOutageMs", options.workerOutageMs ?? 1_500],
    ["databaseOutageMs", options.databaseOutageMs ?? 1_500],
    ["responsibilityTimeoutMs", options.responsibilityTimeoutMs ?? 90_000],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`${label} must be finite and non-negative`);
    }
  }
}

function sanitizedFailure(error: unknown): string {
  return Buffer.from(
    (error instanceof Error ? error.message : String(error)).replace(
      /postgres(?:ql)?:\/\/[^\s"']+/giu,
      "postgresql://[redacted]",
    ),
    "utf8",
  )
    .subarray(0, 1_000)
    .toString("utf8");
}

function exactServices(services: readonly string[]): boolean {
  return (
    [...new Set(services)].sort().join("\u0000") ===
    EXPECTED_SERVICES.join("\u0000")
  );
}

function workerPid(
  diagnostics: NativeWallClockDiagnostics,
  worker: "worker-1" | "worker-2",
): number | null {
  return (
    diagnostics.harness?.processes.find((item) => item.name === worker)?.pid ??
    null
  );
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runNativePostgresSmoke(
  options: NativePostgresSmokeOptions,
  dependencies: NativePostgresSmokeDependencies = {},
): Promise<NativePostgresSmokeReport> {
  validateOptions(options);
  const sleep = dependencies.sleep ?? defaultSleep;
  const driver =
    dependencies.driver ??
    new NativeWallClockDriver({
      runId: options.runId,
      seed: options.seed,
      durationHours: 1 / 60,
      // This short test commands faults directly, outside the seeded soak
      // schedule. Admit only health samples from those actual bounded faults.
      commandedFaultHealthWindowsOnly: true,
      workspaceRoot: options.workspaceRoot,
      postgresRoot: options.postgresRoot,
      runDirectory: options.runDirectory,
    });
  const startedAt = driver.now();
  let failure: string | null = null;
  let projectId: number | null = null;
  let expectedResponsibilities = 0;
  let postgresVersion: string | null = null;
  let servicesBefore: string[] = [];
  let completedResponsibilities = 0;
  let healthSampleBuckets = 0;
  let healthTruthMismatches: string[] = [];
  let oldPid: number | null = null;
  let newPid: number | null = null;
  let servicesWhileKilled: string[] = [];
  let servicesAfterWorkerRecovery: string[] = [];
  let servicesWhileDatabaseUnavailable: string[] = [];
  let servicesAfterDatabaseRecovery: string[] = [];

  try {
    const topology = await driver.start();
    projectId = topology.projectId;
    expectedResponsibilities = topology.expectedResponsibilities;
    postgresVersion = await driver.nativePostgresVersion();
    servicesBefore = await driver.nativeServices();
    oldPid = workerPid(driver.diagnostics(), "worker-1");

    await driver.killWorker("worker-1");
    await sleep(options.workerOutageMs ?? 1_500);
    servicesWhileKilled = await driver.nativeServices();
    await driver.restartWorker("worker-1");
    servicesAfterWorkerRecovery = await driver.nativeServices();
    newPid = workerPid(driver.diagnostics(), "worker-1");

    await driver.pauseDatabase();
    await sleep(options.databaseOutageMs ?? 1_500);
    servicesWhileDatabaseUnavailable = await driver.nativeServices();
    await driver.resumeDatabase();
    servicesAfterDatabaseRecovery = await driver.nativeServices();

    const observer = new SoakEvidenceObserver({ expectedResponsibilities });
    const deadline = Date.now() + (options.responsibilityTimeoutMs ?? 90_000);
    do {
      await driver.captureEvidence(observer, { kind: "minute", minute: 1 });
      const evidence = observer.finalize().metrics;
      completedResponsibilities = evidence.completedResponsibilities;
      healthSampleBuckets = evidence.healthSampleBuckets;
      healthTruthMismatches = [...evidence.healthTruthMismatches];
      if (
        completedResponsibilities >= expectedResponsibilities &&
        healthSampleBuckets >= 1
      ) {
        break;
      }
      await sleep(1_000);
    } while (Date.now() < deadline);
    if (completedResponsibilities < expectedResponsibilities) {
      throw new Error(
        `Synthetic responsibilities did not reach ${expectedResponsibilities} before the smoke deadline`,
      );
    }
    if (healthSampleBuckets < 1) {
      throw new Error(
        "A post-start fleet health bucket was not persisted before the smoke deadline",
      );
    }
  } catch (error) {
    failure = sanitizedFailure(error);
  } finally {
    try {
      await driver.stop({ keepData: false });
    } catch (error) {
      failure = failure
        ? `${failure}; cleanup failed: ${sanitizedFailure(error)}`
        : `cleanup failed: ${sanitizedFailure(error)}`;
    }
  }

  const diagnostics = driver.diagnostics();
  const workerAbsent = !servicesWhileKilled.includes("worker-1");
  const workerRecovered =
    exactServices(servicesAfterWorkerRecovery) &&
    oldPid !== null &&
    newPid !== null &&
    newPid !== oldPid;
  const databaseUnavailable = !servicesWhileDatabaseUnavailable.includes("db");
  const databaseRecovered = exactServices(servicesAfterDatabaseRecovery);
  const pass =
    failure === null &&
    projectId !== null &&
    postgresVersion !== null &&
    /^PostgreSQL 17\.[0-9]+(?:[^\s]*)?$/u.test(postgresVersion) &&
    exactServices(servicesBefore) &&
    expectedResponsibilities >= 10 &&
    completedResponsibilities >= expectedResponsibilities &&
    healthSampleBuckets >= 1 &&
    healthTruthMismatches.length === 0 &&
    workerAbsent &&
    workerRecovered &&
    databaseUnavailable &&
    databaseRecovered;
  const completedAt = driver.now();
  return {
    schemaVersion: 1,
    kind: "native_postgres_process_smoke",
    runId: options.runId,
    seed: options.seed,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    pass,
    failure,
    projectId,
    postgresVersion,
    topology: { api: 1, workers: 2, agents: 10, database: "postgres" },
    servicesBefore,
    completedResponsibilities,
    expectedResponsibilities,
    healthSampleBuckets,
    healthTruthMismatches,
    workerFault: {
      target: "worker-1",
      oldPid,
      newPid,
      absentWhileKilled: workerAbsent,
      recovered: workerRecovered,
      servicesWhileKilled,
      servicesAfterRecovery: servicesAfterWorkerRecovery,
    },
    databaseFault: {
      unavailableObserved: databaseUnavailable,
      recovered: databaseRecovered,
      servicesWhileUnavailable: servicesWhileDatabaseUnavailable,
      servicesAfterRecovery: servicesAfterDatabaseRecovery,
    },
    evidence: {
      runtimeDirectory: diagnostics.runDirectory,
      logDirectory:
        diagnostics.harness?.logDirectory ??
        path.join(diagnostics.runDirectory, "logs"),
      apiPort: diagnostics.apiPort,
      databasePort: diagnostics.databasePort,
    },
  };
}
