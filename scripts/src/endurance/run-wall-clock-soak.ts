import { randomUUID } from "node:crypto";

import {
  runBrowserMonitor,
  type BrowserMonitorResult,
  type BrowserMonitorSession,
} from "./browser-monitor";
import {
  createSeededFaultSchedule,
  executeScheduledFault,
  type FaultInjectionControls,
  type FaultScheduleProfile,
  type ScheduledInjectedFault,
} from "./fault-injector";
import { evaluateEnduranceInvariants } from "./invariants";
import {
  createEnduranceReport,
  type EnduranceJournalEvent,
  type EndurancePrimaryEvidenceRecord,
  type EnduranceProvenance,
  type EnduranceReport,
} from "./report-schema";
import { SoakEvidenceObserver } from "./soak-observer";

export type WallClockCaptureContext =
  | { kind: "minute"; minute: number }
  | {
      kind: "post_fault";
      fault: ScheduledInjectedFault;
      scheduledAt: string;
    };

export interface WallClockRuntimeDriver extends FaultInjectionControls {
  start(): Promise<{ projectId: number; expectedResponsibilities: number }>;
  captureEvidence(
    observer: SoakEvidenceObserver,
    context: WallClockCaptureContext,
  ): Promise<void>;
  createBrowserSession(
    signal?: AbortSignal,
    cleanupTimeoutMs?: number,
  ): Promise<BrowserMonitorSession>;
  provenance(): Promise<Omit<EnduranceProvenance, "automatedSignOff">>;
  stop(options: { keepData: boolean }): Promise<void>;
  now(): Date;
}

export interface WallClockSoakOptions {
  runId?: string;
  seed: number;
  durationHours: number;
  faultProfile?: FaultScheduleProfile;
  commitSha: string;
  browserOutputDirectory: string;
  keepOnFailure?: boolean;
}

export interface WallClockSoakDependencies {
  waitUntilOffset?: (offsetMs: number, signal: AbortSignal) => Promise<void>;
  browserSleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  cleanupTimeoutMs?: number;
}

export interface WallClockSoakResult {
  report: EnduranceReport;
  journal: EnduranceJournalEvent[];
  primaryEvidence: EndurancePrimaryEvidenceRecord[];
  browser: BrowserMonitorResult | null;
  projectId: number | null;
  failure: string | null;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function validateOptions(options: WallClockSoakOptions): void {
  if (!Number.isSafeInteger(options.seed) || options.seed < 0) {
    throw new TypeError("seed must be a non-negative safe integer");
  }
  if (
    !Number.isFinite(options.durationHours) ||
    options.durationHours < 1 / 60
  ) {
    throw new TypeError("durationHours must be at least one minute");
  }
  if (!options.commitSha.trim()) throw new TypeError("commitSha is required");
}

export async function runWallClockSoak(
  options: WallClockSoakOptions,
  driver: WallClockRuntimeDriver,
  dependencies: WallClockSoakDependencies = {},
): Promise<WallClockSoakResult> {
  validateOptions(options);
  const cleanupTimeoutMs = dependencies.cleanupTimeoutMs ?? 90_000;
  if (!Number.isFinite(cleanupTimeoutMs) || cleanupTimeoutMs <= 0) {
    throw new TypeError("cleanupTimeoutMs must be positive");
  }
  const runId = options.runId ?? `wall-clock-${randomUUID()}`;
  const durationMs = Math.round(options.durationHours * 60 * 60 * 1_000);
  const faultProfile = options.faultProfile ?? "standard";
  const requiredHealthBuckets = Math.max(
    1,
    Math.floor(options.durationHours * 60),
  );
  const controller = new AbortController();
  const forwardExternalAbort = () =>
    controller.abort(dependencies.signal?.reason);
  if (dependencies.signal?.aborted) {
    forwardExternalAbort();
  } else {
    dependencies.signal?.addEventListener("abort", forwardExternalAbort, {
      once: true,
    });
  }
  const journal: EnduranceJournalEvent[] = [];
  let sequence = 0;
  const appendJournal = (
    kind: string,
    occurredAt: string,
    data: Record<string, unknown>,
  ) => {
    journal.push({
      schemaVersion: 1,
      runId,
      sequence: sequence++,
      occurredAt,
      kind,
      data,
    });
  };
  let projectId: number | null = null;
  let expectedResponsibilities = 0;
  let observer = new SoakEvidenceObserver({
    expectedResponsibilities: 0,
    runId,
  });
  let browser: BrowserMonitorResult | null = null;
  let runFailure: string | null = null;
  let startedAt = driver.now();

  let realOrigin = Date.now();
  const waitUntilOffset =
    dependencies.waitUntilOffset ??
    ((offsetMs: number, signal: AbortSignal) =>
      delay(Math.max(0, offsetMs - (Date.now() - realOrigin)), signal));
  const browserSleep =
    dependencies.browserSleep ??
    ((milliseconds: number, signal?: AbortSignal) =>
      delay(milliseconds, signal));

  try {
    const started = await driver.start();
    projectId = started.projectId;
    expectedResponsibilities = started.expectedResponsibilities;
    observer = new SoakEvidenceObserver({ expectedResponsibilities, runId });
    startedAt = driver.now();
    realOrigin = Date.now();
    appendJournal("run_started", startedAt.toISOString(), {
      mode: "wall_clock",
      durationHours: options.durationHours,
      seed: options.seed,
      projectId,
      faultProfile,
    });

    const schedule = createSeededFaultSchedule({
      seed: options.seed,
      durationMs,
      profile: faultProfile,
    });
    for (const fault of schedule) {
      const scheduledAt = new Date(
        startedAt.getTime() + fault.atMs,
      ).toISOString();
      observer.scheduleFault({ id: fault.id, kind: fault.kind, scheduledAt });
      appendJournal("fault_scheduled", startedAt.toISOString(), {
        faultId: fault.id,
        faultKind: fault.kind,
        scheduledAt,
      });
    }

    const databaseRecoveryGates = new Map<
      string,
      { promise: Promise<void>; resolve: () => void }
    >();
    for (const fault of schedule) {
      if (fault.kind !== "database_unavailable") continue;
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      databaseRecoveryGates.set(fault.id, { promise, resolve });
    }

    const faultJobs = schedule.map(async (fault) => {
      await waitUntilOffset(fault.atMs, controller.signal);
      controller.signal.throwIfAborted();
      const scheduledAt = new Date(
        startedAt.getTime() + fault.atMs,
      ).toISOString();
      let executed: Awaited<ReturnType<typeof executeScheduledFault>>;
      try {
        executed = await executeScheduledFault(
          fault,
          driver,
          controller.signal,
        );
      } finally {
        databaseRecoveryGates.get(fault.id)?.resolve();
      }
      await driver.captureEvidence(observer, {
        kind: "post_fault",
        fault,
        scheduledAt,
      });
      appendJournal("fault_observed", driver.now().toISOString(), {
        faultId: fault.id,
        faultKind: fault.kind,
        target: executed.target,
      });
    });

    const sampler = (async () => {
      for (let minute = 1; minute <= requiredHealthBuckets; minute += 1) {
        await waitUntilOffset(minute * 60_000, controller.signal);
        controller.signal.throwIfAborted();
        try {
          await driver.captureEvidence(observer, { kind: "minute", minute });
        } catch (error) {
          const sampleOffsetMs = minute * 60_000;
          const databaseFault = schedule.find(
            (fault) =>
              fault.kind === "database_unavailable" &&
              sampleOffsetMs >= fault.atMs &&
              sampleOffsetMs <= fault.atMs + fault.durationMs,
          );
          if (!databaseFault) throw error;
          appendJournal("health_sample_deferred", driver.now().toISOString(), {
            minute,
            faultId: databaseFault.id,
            reason: "database_unavailable",
          });
          const gate = databaseRecoveryGates.get(databaseFault.id);
          if (!gate) throw error;
          await gate.promise;
          controller.signal.throwIfAborted();
          await driver.captureEvidence(observer, { kind: "minute", minute });
        }
        appendJournal("health_sample_observed", driver.now().toISOString(), {
          minute,
        });
      }
    })();

    const browserJob = runBrowserMonitor({
      runId,
      outputDirectory: options.browserOutputDirectory,
      sampleCount: requiredHealthBuckets + 1,
      sampleIntervalMs: 60_000,
      maxRestarts: 3,
      maxScreenshots: 100,
      createSession: (signal, cleanupTimeoutMs) =>
        driver.createBrowserSession(signal, cleanupTimeoutMs),
      sleep: (milliseconds) => browserSleep(milliseconds, controller.signal),
      now: () => driver.now(),
      signal: controller.signal,
    }).then((result) => {
      browser = result;
    });

    const requestedDurationHorizon = (async () => {
      await waitUntilOffset(durationMs, controller.signal);
      controller.signal.throwIfAborted();
    })();

    const jobs: Promise<unknown>[] = [
      ...faultJobs,
      sampler,
      browserJob,
      requestedDurationHorizon,
    ];
    try {
      await Promise.all(jobs);
    } catch (error) {
      runFailure = failureMessage(error);
      controller.abort(error);
      await Promise.allSettled(jobs);
    }
  } catch (error) {
    runFailure = failureMessage(error);
    controller.abort(error);
  }

  const completedAt = driver.now();
  const evidence = observer.finalize();
  const browserResult = browser as BrowserMonitorResult | null;
  evidence.metrics.requiredHealthSampleBuckets = requiredHealthBuckets;
  let provenanceBase: Omit<EnduranceProvenance, "automatedSignOff"> | null =
    null;
  try {
    provenanceBase = await driver.provenance();
  } catch (error) {
    runFailure = runFailure
      ? `${runFailure}; provenance failed: ${failureMessage(error)}`
      : `provenance failed: ${failureMessage(error)}`;
    evidence.metrics.healthTruthMismatches.push("provenance_failure");
  }
  if (runFailure) evidence.metrics.healthTruthMismatches.push("runner_failure");
  if (!browserResult?.pass)
    evidence.metrics.healthTruthMismatches.push("browser_monitor");
  const invariantPassBeforeCleanup = evaluateEnduranceInvariants(
    evidence.metrics,
  ).pass;
  try {
    await withDeadline(
      driver.stop({
        keepData:
          options.keepOnFailure === true &&
          (runFailure !== null || !invariantPassBeforeCleanup),
      }),
      cleanupTimeoutMs,
      "Wall-clock cleanup",
    );
  } catch (error) {
    runFailure = runFailure
      ? `${runFailure}; cleanup failed: ${failureMessage(error)}`
      : `cleanup failed: ${failureMessage(error)}`;
  } finally {
    dependencies.signal?.removeEventListener("abort", forwardExternalAbort);
  }
  if (
    runFailure &&
    !evidence.metrics.healthTruthMismatches.includes("runner_failure")
  ) {
    evidence.metrics.healthTruthMismatches.push("runner_failure");
  }
  const invariantPass = evaluateEnduranceInvariants(evidence.metrics).pass;

  const report = createEnduranceReport({
    runId,
    mode: "wall_clock",
    seed: options.seed,
    commitSha: options.commitSha,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    wallClockHours: Math.max(
      0,
      (completedAt.getTime() - startedAt.getTime()) / (60 * 60 * 1_000),
    ),
    simulatedMinutes: 0,
    topology: { api: 1, workers: 2, agents: 10, database: "postgres" },
    injections: evidence.injections,
    metrics: evidence.metrics,
    ...(provenanceBase
      ? {
          provenance: {
            ...provenanceBase,
            automatedSignOff: {
              status:
                runFailure === null && invariantPass && browserResult?.pass
                  ? ("passed" as const)
                  : ("failed" as const),
              generatedAt: completedAt.toISOString(),
            },
          },
        }
      : {}),
    ...(browserResult
      ? {
          evidence: {
            browser: {
              startCheckpointSha256: browserResult.startCheckpointSha256,
              endCheckpointSha256: browserResult.endCheckpointSha256,
              incidentCorrelations: browserResult.incidentCorrelations,
              sseReconnectEventIdAdvanced:
                browserResult.sseReconnectEventIdAdvanced,
            },
          },
        }
      : {}),
  });
  if (faultProfile !== "standard") {
    report.verified24h = false;
  }
  appendJournal(
    report.pass && runFailure === null ? "run_completed" : "run_failed",
    completedAt.toISOString(),
    {
      pass: report.pass,
      verified24h: report.verified24h,
      failure: runFailure,
    },
  );

  return {
    report,
    journal,
    primaryEvidence: evidence.primaryEvidence,
    browser: browserResult,
    projectId,
    failure: runFailure,
  };
}
