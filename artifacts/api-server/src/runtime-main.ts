import type { Server } from "node:http";
import { closeDatabase, databaseBackend, dbReady } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { readCodexConfigurationReport } from "./lib/codex-task-capability";
import { bootstrapProviders } from "./lib/provider-bootstrap";
import { setProviderRuntimeIdentity } from "./lib/provider-runtime-config";
import { reconcileInterruptedComputerActivities } from "./lib/orchestrator/execute-tool";
import { markRuntimeOperationsUnknownAfterDrainTimeout } from "./lib/orchestrator/operation-receipts";
import {
  markRuntimeDraining,
  markRuntimeStopped,
  registerRuntimeInstance,
  type RuntimeInstanceHandle,
} from "./lib/orchestrator/runtime-instance-registry";
import {
  startEmergencyStopMonitor,
  stopEmergencyStopMonitor,
} from "./lib/orchestrator/runtime-emergency-stop";
import { startScheduler, stopScheduler } from "./lib/orchestrator/scheduler";
import { scrubExpiredSudoApprovals } from "./lib/orchestrator/sudo-approval-retention";
import {
  markRuntimeReady,
  markRuntimeShuttingDown,
} from "./lib/runtime-lifecycle";
import type { RuntimeOperationsConfig } from "./lib/runtime-operations-config";
import type { RuntimeRolePlan } from "./lib/runtime-role-plan";
import { initializeRuntimeControlApi } from "./lib/runtime-control-api";
import {
  closeHttpServerWithin,
  runOrderedRuntimeDrain,
} from "./lib/runtime-shutdown";
import { seedDefaultOrg } from "./lib/seed";
import { readWorkspaceLocale } from "./lib/workspace-locale";
import { closeAllSessions } from "./lib/vm/browser";
import { chatgptConnectionRuntime } from "./lib/chatgpt-connection-runtime";
import {
  startOperationsHealthSampler,
  type OperationsHealthSamplerController,
} from "./lib/operations/operations-sampler";
import { readSyntheticRuntimeConfiguration } from "./lib/runtime-security";
import { createSyntheticClaimedTaskRunner } from "./lib/testing/synthetic-runtime";
import {
  bindHttpRuntimeHandle,
  releaseHttpRuntimeHandle,
} from "./lib/http-runtime-context";

export interface HttpRuntimeStartOptions {
  environment: NodeJS.ProcessEnv;
  host: string;
  port: number;
  operationsConfig: RuntimeOperationsConfig;
  rolePlan: RuntimeRolePlan;
  shutdownGraceMs: number;
  emergencyStopMonitorMs: number;
}

export interface HttpRuntimeController {
  shutdown(signal: string): Promise<void>;
}

function assertHttpRuntimePlan(options: HttpRuntimeStartOptions): void {
  if (
    options.operationsConfig.role !== "api" &&
    options.operationsConfig.role !== "combined"
  ) {
    throw new Error("HTTP runtime requires the api or combined role.");
  }
  if (!options.rolePlan.startsHttp || !options.rolePlan.seedsDatabase) {
    throw new Error(
      "HTTP runtime received a role plan without HTTP or seeding.",
    );
  }
  if (
    options.operationsConfig.role === "api" &&
    options.rolePlan.startsScheduler
  ) {
    throw new Error("API runtime cannot start the scheduler.");
  }
  if (
    options.operationsConfig.role !== "combined" &&
    options.rolePlan.recoversProcessLocalComputerActivities
  ) {
    throw new Error(
      "Process-local computer activity recovery is combined-runtime only.",
    );
  }
}

async function listenHttp(host: string, port: number): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const listener = app.listen(port, host);
    const onError = (error: Error): void => reject(error);
    listener.once("error", onError);
    listener.once("listening", () => {
      listener.off("error", onError);
      resolve(listener);
    });
  });
}

function createHttpRuntimeController(
  server: Server,
  runtimeHandle: RuntimeInstanceHandle,
  options: HttpRuntimeStartOptions,
  healthSampler: OperationsHealthSamplerController | null,
): HttpRuntimeController {
  let shutdownPromise: Promise<void> | null = null;

  return Object.freeze({
    shutdown(signal: string): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      markRuntimeShuttingDown();
      logger.info({ signal }, "Graceful shutdown started");

      shutdownPromise = (async () => {
        const hardExitWatchdog = setTimeout(() => {
          logger.fatal({ signal }, "Shutdown hard-stop watchdog expired");
          server.closeAllConnections?.();
          process.exit(1);
        }, options.shutdownGraceMs + 1_000);
        // Keep this referenced: it is deliberately independent from the async
        // drain and must terminate a process whose final cleanup promise stalls.

        try {
          await runOrderedRuntimeDrain(
            {
              stopHttpAdmission: () =>
                closeHttpServerWithin(
                  server,
                  Math.min(
                    5_000,
                    Math.max(250, Math.floor(options.shutdownGraceMs / 4)),
                  ),
                ),
              stopSchedulerAdmission: async () => {
                const results = await Promise.allSettled([
                  stopScheduler(),
                  healthSampler?.stop() ?? Promise.resolve(),
                ]);
                const failures = results.flatMap((result) =>
                  result.status === "rejected" ? [result.reason] : [],
                );
                if (failures.length > 0) {
                  throw new AggregateError(
                    failures,
                    "Scheduler or Operations sampler drain failed",
                  );
                }
              },
              markRuntimeDraining: async () => {
                await markRuntimeDraining(runtimeHandle);
              },
              markTimedOutOperationsUnknown: async () => {
                await markRuntimeOperationsUnknownAfterDrainTimeout(
                  runtimeHandle,
                );
              },
              closeSessions: async () => {
                await chatgptConnectionRuntime.close();
                await closeAllSessions();
              },
              stopEmergencyMonitor: () => stopEmergencyStopMonitor(),
              markRuntimeStopped: async () => {
                await markRuntimeStopped(runtimeHandle);
              },
              closeDatabase: () => closeDatabase(),
            },
            options.shutdownGraceMs,
          );
          logger.info("Graceful shutdown complete");
        } catch (error) {
          process.exitCode = 1;
          logger.error({ error }, "Graceful shutdown failed");
          server.closeAllConnections?.();
          throw error;
        } finally {
          releaseHttpRuntimeHandle(runtimeHandle);
          clearTimeout(hardExitWatchdog);
        }
      })();

      return shutdownPromise;
    },
  });
}

async function cleanupFailedStart(
  runtimeHandle: RuntimeInstanceHandle | null,
  options: HttpRuntimeStartOptions,
  healthSampler: OperationsHealthSamplerController | null,
): Promise<void> {
  markRuntimeShuttingDown();
  if (runtimeHandle) {
    try {
      await runOrderedRuntimeDrain(
        {
          stopHttpAdmission: async () => undefined,
          stopSchedulerAdmission: async () => {
            await Promise.all([stopScheduler(), healthSampler?.stop()]);
          },
          markRuntimeDraining: async () => {
            await markRuntimeDraining(runtimeHandle);
          },
          markTimedOutOperationsUnknown: async () => {
            await markRuntimeOperationsUnknownAfterDrainTimeout(runtimeHandle);
          },
          closeSessions: async () => {
            await chatgptConnectionRuntime.close();
            await closeAllSessions();
          },
          stopEmergencyMonitor: () => stopEmergencyStopMonitor(),
          markRuntimeStopped: async () => {
            await markRuntimeStopped(runtimeHandle);
          },
          closeDatabase: () => closeDatabase(),
        },
        options.shutdownGraceMs,
      );
    } finally {
      releaseHttpRuntimeHandle(runtimeHandle);
    }
    return;
  }

  await chatgptConnectionRuntime.close();
  await Promise.allSettled([
    stopScheduler(),
    healthSampler?.stop(),
    stopEmergencyStopMonitor(),
    closeAllSessions(),
    closeDatabase(),
  ]);
}

export async function startHttpRuntime(
  options: HttpRuntimeStartOptions,
): Promise<HttpRuntimeController> {
  assertHttpRuntimePlan(options);
  let runtimeHandle: RuntimeInstanceHandle | null = null;
  let healthSampler: OperationsHealthSamplerController | null = null;

  try {
    const synthetic = readSyntheticRuntimeConfiguration(options.environment);
    // Only API/combined runtimes seed operator-facing defaults. The worker
    // entry has no seed import and can never race this compatibility boundary.
    await dbReady;
    await seedDefaultOrg(
      await readWorkspaceLocale(),
      synthetic ? { syntheticAgentCount: synthetic.expectedAgents } : undefined,
    );
    await scrubExpiredSudoApprovals();

    // This scan is process-global and unscoped. Until it has durable ownership
    // metadata, only the single-process compatibility runtime may execute it.
    if (options.rolePlan.recoversProcessLocalComputerActivities) {
      await reconcileInterruptedComputerActivities();
    }

    if (synthetic) {
      logger.info(
        { enduranceRunId: synthetic.runId, mode: synthetic.mode },
        "Validated synthetic runtime enabled; external provider bootstrap skipped",
      );
    } else {
      await bootstrapProviders(options.environment);
    }
    runtimeHandle = await registerRuntimeInstance(
      {
        role: options.operationsConfig.role,
        schedulerEnabled: options.rolePlan.startsScheduler,
        capabilities: {
          ...readCodexConfigurationReport(options.environment),
          http: true,
          scheduler: options.rolePlan.startsScheduler,
        },
      },
      options.operationsConfig,
    );
    bindHttpRuntimeHandle(runtimeHandle);
    if (!synthetic) {
      await setProviderRuntimeIdentity(runtimeHandle, options.environment);
    }
    await initializeRuntimeControlApi(options.environment);

    // Every API/combined replica observes a stop accepted by another replica,
    // including API-only processes that never own scheduler claims.
    startEmergencyStopMonitor({
      intervalMs: options.emergencyStopMonitorMs,
    });
    const server = await listenHttp(options.host, options.port);

    if (options.rolePlan.startsScheduler) {
      startScheduler(runtimeHandle, options.operationsConfig, {
        runClaimedTask: synthetic
          ? createSyntheticClaimedTaskRunner({
              runtimeOperationsConfig: options.operationsConfig,
              synthetic,
            })
          : undefined,
      });
      healthSampler = startOperationsHealthSampler(
        runtimeHandle,
        options.operationsConfig,
      );
    } else {
      logger.info("Autonomous scheduler disabled for this API process");
    }

    markRuntimeReady();
    logger.info(
      {
        host: options.host,
        port: options.port,
        databaseBackend,
        role: options.operationsConfig.role,
        schedulerEnabled: options.rolePlan.startsScheduler,
      },
      "Server ready",
    );
    return createHttpRuntimeController(
      server,
      runtimeHandle,
      options,
      healthSampler,
    );
  } catch (error) {
    await cleanupFailedStart(runtimeHandle, options, healthSampler).catch(
      (cleanupError) => {
        logger.error({ error: cleanupError }, "Runtime startup cleanup failed");
      },
    );
    throw error;
  }
}

export function installHttpProcessHandlers(
  runtime: HttpRuntimeController,
): void {
  const shutdown = (signal: string, error?: unknown): void => {
    if (error !== undefined) {
      process.exitCode = 1;
      logger.fatal({ error }, signal);
    }
    void runtime.shutdown(signal).catch(() => {
      process.exit(1);
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("uncaughtException", (error) =>
    shutdown("Uncaught exception", error),
  );
  process.once("unhandledRejection", (error) =>
    shutdown("Unhandled rejection", error),
  );
}
