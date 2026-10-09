import { closeDatabase, databaseBackend, dbReady } from "@workspace/db";
import { bootstrapProviders } from "./lib/provider-bootstrap";
import { setProviderRuntimeIdentity } from "./lib/provider-runtime-config";
import { logger } from "./lib/logger";
import { readCodexConfigurationReport } from "./lib/codex-task-capability";
import { markRuntimeOperationsUnknownAfterDrainTimeout } from "./lib/orchestrator/operation-receipts";
import {
  markRuntimeDraining,
  markRuntimeStopped,
  registerRuntimeInstance,
  type RegisterRuntimeInstanceInput,
  type RuntimeInstanceHandle,
} from "./lib/orchestrator/runtime-instance-registry";
import {
  startEmergencyStopMonitor,
  stopEmergencyStopMonitor,
} from "./lib/orchestrator/runtime-emergency-stop";
import { startScheduler, stopScheduler } from "./lib/orchestrator/scheduler";
import {
  markRuntimeReady,
  markRuntimeShuttingDown,
} from "./lib/runtime-lifecycle";
import type { RuntimeOperationsConfig } from "./lib/runtime-operations-config";
import type { RuntimeRolePlan } from "./lib/runtime-role-plan";
import {
  configureRuntimeControlWorkerAffinity,
  startRuntimeControlWorker,
  type RuntimeControlWorkerController,
} from "./lib/runtime-control-worker";
import { runOrderedRuntimeDrain } from "./lib/runtime-shutdown";
import { closeAllSessions } from "./lib/vm/browser";
import {
  startOperationsHealthSampler,
  type OperationsHealthSamplerController,
} from "./lib/operations/operations-sampler";
import { readSyntheticRuntimeConfiguration } from "./lib/runtime-security";
import { createSyntheticClaimedTaskRunner } from "./lib/testing/synthetic-runtime";

export interface WorkerRuntimeStartOptions {
  environment: NodeJS.ProcessEnv;
  operationsConfig: RuntimeOperationsConfig;
  rolePlan: RuntimeRolePlan;
  shutdownGraceMs: number;
  emergencyStopMonitorMs: number;
}

export interface WorkerRuntimeController {
  shutdown(signal: string): Promise<void>;
}

export interface WorkerRuntimeDependencies {
  databaseBackend: string;
  waitForDatabase(): Promise<void>;
  bootstrapProviders(environment: NodeJS.ProcessEnv): Promise<void>;
  setProviderRuntimeIdentity(
    runtime: Pick<RuntimeInstanceHandle, "id" | "startedAt">,
    environment: NodeJS.ProcessEnv,
  ): Promise<void>;
  registerRuntimeInstance(
    input: RegisterRuntimeInstanceInput,
    config: RuntimeOperationsConfig,
  ): Promise<RuntimeInstanceHandle>;
  startEmergencyStopMonitor(input: { intervalMs: number }): void;
  stopEmergencyStopMonitor(): Promise<void>;
  startScheduler(
    runtime: RuntimeInstanceHandle,
    config: RuntimeOperationsConfig,
    dependencies?: Parameters<typeof startScheduler>[2],
  ): void;
  stopScheduler(): Promise<void>;
  configureRuntimeControlWorkerAffinity(
    runtime: Pick<RuntimeInstanceHandle, "id" | "startedAt">,
  ): void;
  startRuntimeControlWorker(
    runtime: Pick<RuntimeInstanceHandle, "id" | "startedAt">,
    environment: NodeJS.ProcessEnv,
  ): RuntimeControlWorkerController;
  startOperationsHealthSampler(
    runtime: RuntimeInstanceHandle,
    config: RuntimeOperationsConfig,
  ): OperationsHealthSamplerController;
  markRuntimeReady(): void;
  markRuntimeShuttingDown(): void;
  markRuntimeDraining(runtime: RuntimeInstanceHandle): Promise<unknown>;
  markRuntimeOperationsUnknownAfterDrainTimeout(
    runtime: Pick<RuntimeInstanceHandle, "id" | "startedAt">,
  ): Promise<number>;
  closeAllSessions(): Promise<void>;
  markRuntimeStopped(runtime: RuntimeInstanceHandle): Promise<unknown>;
  closeDatabase(): Promise<void>;
}

const defaultDependencies: WorkerRuntimeDependencies = {
  databaseBackend,
  waitForDatabase: () => dbReady,
  bootstrapProviders,
  setProviderRuntimeIdentity,
  registerRuntimeInstance,
  startEmergencyStopMonitor,
  stopEmergencyStopMonitor,
  startScheduler,
  stopScheduler,
  configureRuntimeControlWorkerAffinity,
  startRuntimeControlWorker,
  startOperationsHealthSampler,
  markRuntimeReady,
  markRuntimeShuttingDown,
  markRuntimeDraining,
  markRuntimeOperationsUnknownAfterDrainTimeout,
  closeAllSessions,
  markRuntimeStopped,
  closeDatabase,
};

function assertWorkerPlan(options: WorkerRuntimeStartOptions): void {
  if (options.operationsConfig.role !== "worker") {
    throw new Error("Worker runtime requires RUNTIME_ROLE=worker.");
  }
  if (
    options.rolePlan.startsHttp ||
    !options.rolePlan.startsScheduler ||
    options.rolePlan.seedsDatabase ||
    options.rolePlan.recoversProcessLocalComputerActivities
  ) {
    throw new Error("Worker runtime received an unsafe role plan.");
  }
}

function createWorkerRuntimeController(
  runtimeHandle: RuntimeInstanceHandle,
  options: WorkerRuntimeStartOptions,
  dependencies: WorkerRuntimeDependencies,
  getHealthSampler: () => OperationsHealthSamplerController | null,
  getRuntimeControlWorker: () => RuntimeControlWorkerController | null,
): WorkerRuntimeController {
  let shutdownPromise: Promise<void> | null = null;

  return Object.freeze({
    shutdown(signal: string): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      dependencies.markRuntimeShuttingDown();
      logger.info({ signal }, "Worker graceful shutdown started");

      shutdownPromise = (async () => {
        const hardExitWatchdog = setTimeout(() => {
          logger.fatal(
            { signal },
            "Worker shutdown hard-stop watchdog expired",
          );
          process.exit(1);
        }, options.shutdownGraceMs + 1_000);
        // Keep this referenced: it is deliberately independent from the async
        // drain and must terminate a process whose final cleanup promise stalls.

        try {
          await runOrderedRuntimeDrain(
            {
              stopHttpAdmission: async () => undefined,
              stopSchedulerAdmission: async () => {
                const results = await Promise.allSettled([
                  dependencies.stopScheduler(),
                  getHealthSampler()?.stop() ?? Promise.resolve(),
                  getRuntimeControlWorker()?.stop() ?? Promise.resolve(),
                ]);
                const failures = results.flatMap((result) =>
                  result.status === "rejected" ? [result.reason] : [],
                );
                if (failures.length > 0) {
                  throw new AggregateError(
                    failures,
                    "Worker scheduler, control channel, or Operations sampler drain failed",
                  );
                }
              },
              markRuntimeDraining: async () => {
                await dependencies.markRuntimeDraining(runtimeHandle);
              },
              markTimedOutOperationsUnknown: async () => {
                await dependencies.markRuntimeOperationsUnknownAfterDrainTimeout(
                  runtimeHandle,
                );
              },
              closeSessions: dependencies.closeAllSessions,
              stopEmergencyMonitor: dependencies.stopEmergencyStopMonitor,
              markRuntimeStopped: async () => {
                await dependencies.markRuntimeStopped(runtimeHandle);
              },
              closeDatabase: dependencies.closeDatabase,
            },
            options.shutdownGraceMs,
          );
          logger.info("Worker graceful shutdown complete");
        } catch (error) {
          process.exitCode = 1;
          logger.error({ error }, "Worker graceful shutdown failed");
          throw error;
        } finally {
          clearTimeout(hardExitWatchdog);
        }
      })();

      return shutdownPromise;
    },
  });
}

export async function startWorkerRuntime(
  options: WorkerRuntimeStartOptions,
  dependencies: WorkerRuntimeDependencies = defaultDependencies,
): Promise<WorkerRuntimeController> {
  assertWorkerPlan(options);
  let runtime: WorkerRuntimeController | null = null;
  let healthSampler: OperationsHealthSamplerController | null = null;
  let runtimeControlWorker: RuntimeControlWorkerController | null = null;

  try {
    const synthetic = readSyntheticRuntimeConfiguration(options.environment);
    // Import-time preflight already completed. Migrations and durable storage
    // must now be ready before catalog discovery or runtime registration.
    await dependencies.waitForDatabase();
    if (synthetic) {
      logger.info(
        { enduranceRunId: synthetic.runId, mode: synthetic.mode },
        "Validated synthetic runtime enabled; external provider bootstrap skipped",
      );
    } else {
      await dependencies.bootstrapProviders(options.environment);
    }
    const runtimeHandle = await dependencies.registerRuntimeInstance(
      {
        role: "worker",
        schedulerEnabled: true,
        capabilities: {
          ...readCodexConfigurationReport(options.environment),
          http: false,
          scheduler: true,
        },
      },
      options.operationsConfig,
    );
    runtime = createWorkerRuntimeController(
      runtimeHandle,
      options,
      dependencies,
      () => healthSampler,
      () => runtimeControlWorker,
    );

    if (!synthetic) {
      await dependencies.setProviderRuntimeIdentity(
        runtimeHandle,
        options.environment,
      );
    }
    if (!synthetic) {
      dependencies.configureRuntimeControlWorkerAffinity(runtimeHandle);
      runtimeControlWorker = dependencies.startRuntimeControlWorker(
        runtimeHandle,
        options.environment,
      );
    }

    dependencies.startEmergencyStopMonitor({
      intervalMs: options.emergencyStopMonitorMs,
    });
    dependencies.startScheduler(runtimeHandle, options.operationsConfig, {
      runClaimedTask: synthetic
        ? createSyntheticClaimedTaskRunner({
            runtimeOperationsConfig: options.operationsConfig,
            synthetic,
          })
        : undefined,
    });
    healthSampler = dependencies.startOperationsHealthSampler(
      runtimeHandle,
      options.operationsConfig,
    );
    dependencies.markRuntimeReady();
    logger.info(
      {
        databaseBackend: dependencies.databaseBackend,
        runtimeId: runtimeHandle.id,
        schedulerEnabled: true,
      },
      "Worker ready",
    );
    return runtime;
  } catch (error) {
    if (runtime) {
      await runtime.shutdown("startup-failure").catch((shutdownError) => {
        logger.error({ error: shutdownError }, "Worker startup cleanup failed");
      });
    } else {
      await Promise.allSettled([
        dependencies.stopEmergencyStopMonitor(),
        dependencies.closeAllSessions(),
        dependencies.closeDatabase(),
      ]);
    }
    throw error;
  }
}

export function installWorkerProcessHandlers(
  runtime: WorkerRuntimeController,
): void {
  const shutdown = (signal: string, error?: unknown): void => {
    if (error !== undefined) {
      process.exitCode = 1;
      logger.fatal({ error }, `Worker ${signal}`);
    }
    void runtime.shutdown(signal).catch(() => {
      process.exit(1);
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("uncaughtException", (error) =>
    shutdown("uncaught exception", error),
  );
  process.once("unhandledRejection", (error) =>
    shutdown("unhandled rejection", error),
  );
}
