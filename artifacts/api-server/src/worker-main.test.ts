import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { RuntimeInstanceHandle } from "./lib/orchestrator/runtime-instance-registry";
import { readRuntimeOperationsConfig } from "./lib/runtime-operations-config";
import { planRuntimeRole } from "./lib/runtime-role-plan";
import type { WorkerRuntimeDependencies } from "./worker-main";

const workerEntryPath = fileURLToPath(
  new URL("./worker-entry.ts", import.meta.url),
);
const apiEntryPath = fileURLToPath(new URL("./index.ts", import.meta.url));

function runRejectedEntrypoint(
  entrypoint: string,
  environment: Record<string, string>,
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--import", "tsx", entrypoint], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      LOG_LEVEL: "silent",
      DATABASE_URL: "postgresql://127.0.0.1:1/preflight-must-not-connect",
      ...environment,
    },
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
}

test("entrypoints reject wrong roles and contradictory scheduler flags during preflight", () => {
  const cases = [
    {
      entrypoint: apiEntryPath,
      environment: { RUNTIME_ROLE: "worker", SCHEDULER_ENABLED: "true" },
      expected: /worker role must start through the worker entrypoint/i,
    },
    {
      entrypoint: apiEntryPath,
      environment: { RUNTIME_ROLE: "api", SCHEDULER_ENABLED: "true" },
      expected: /SCHEDULER_ENABLED must not be true when RUNTIME_ROLE=api/,
    },
    {
      entrypoint: workerEntryPath,
      environment: { RUNTIME_ROLE: "api", SCHEDULER_ENABLED: "false" },
      expected: /worker entrypoint requires RUNTIME_ROLE=worker/i,
    },
    {
      entrypoint: workerEntryPath,
      environment: { RUNTIME_ROLE: "worker", SCHEDULER_ENABLED: "false" },
      expected: /SCHEDULER_ENABLED must not be false when RUNTIME_ROLE=worker/,
    },
    {
      entrypoint: workerEntryPath,
      environment: {
        NODE_ENV: "production",
        RUNTIME_ROLE: "worker",
        SCHEDULER_ENABLED: "true",
        RUNTIME_CONTROL_KEY: "c".repeat(32),
        RUNTIME_CONTROL_API_URL:
          "http://127.0.0.1:5000/api/internal/runtime-control",
        SYNTHETIC_RUNTIME_ENABLED: "true",
        SYNTHETIC_RUNTIME_SEED: "240901",
        ENDURANCE_MODE: "soak",
        ENDURANCE_RUN_ID: "forbidden-production-soak",
        ENDURANCE_RUN_DIR: "D:\\endurance\\forbidden-production-soak",
        SYNTHETIC_RUNTIME_CONTROL_FILE:
          "D:\\endurance\\forbidden-production-soak\\faults.json",
      },
      expected: /synthetic runtime is forbidden in production/i,
    },
  ] as const;

  for (const scenario of cases) {
    const result = runRejectedEntrypoint(
      scenario.entrypoint,
      scenario.environment,
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, scenario.expected);
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /ECONNREFUSED|database initialization failed|provider bootstrap failed/i,
    );
  }
});

test("worker module graph imports neither Express nor the HTTP app", async () => {
  const forbiddenImports: string[] = [];
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      const normalizedUrl = resolved.url.replaceAll("\\", "/");
      if (
        specifier === "express" ||
        specifier === "./app" ||
        /\/artifacts\/api-server\/src\/app(?:\.ts)?(?:\?|$)/u.test(
          normalizedUrl,
        )
      ) {
        forbiddenImports.push(specifier);
        throw new Error(`Worker imported forbidden HTTP module: ${specifier}`);
      }
      return resolved;
    },
  });

  try {
    const workerModule = await import(`./worker-main?graph=${Date.now()}`);
    assert.equal(typeof workerModule.startWorkerRuntime, "function");
    assert.deepEqual(forbiddenImports, []);
  } finally {
    hooks.deregister();
  }
});

test("worker registers scheduler-only capability and drains owned runtime resources", async () => {
  const { startWorkerRuntime } = await import("./worker-main");
  const operationsConfig = readRuntimeOperationsConfig({
    RUNTIME_ROLE: "worker",
  });
  const rolePlan = planRuntimeRole({
    role: operationsConfig.role,
    schedulerSetting: undefined,
  });
  const events: string[] = [];
  const runtimeHandle: RuntimeInstanceHandle = {
    id: "worker-test-runtime",
    startedAt: new Date("2026-09-01T00:00:00.000Z"),
    stopHeartbeat: async () => undefined,
  };

  const runtime = await startWorkerRuntime(
    {
      environment: { RUNTIME_ROLE: "worker" },
      operationsConfig,
      rolePlan,
      shutdownGraceMs: 1_000,
      emergencyStopMonitorMs: 250,
    },
    {
      databaseBackend: "test",
      waitForDatabase: async () => {
        events.push("database-ready");
      },
      bootstrapProviders: async () => {
        events.push("providers-ready");
      },
      setProviderRuntimeIdentity: async (handle, environment) => {
        assert.equal(handle, runtimeHandle);
        assert.equal(environment.RUNTIME_ROLE, "worker");
        events.push("provider-identity-set");
      },
      registerRuntimeInstance: async (input, config) => {
        assert.deepEqual(input, {
          role: "worker",
          schedulerEnabled: true,
          capabilities: {
            http: false,
            scheduler: true,
            codexConfigurationV1: true,
            codexOptIn: false,
            codexNonApi: true,
            codexProcessExecution: false,
            codexExecutableConfigured: false,
            codexNativeController: process.platform === "win32",
          },
        });
        assert.equal(config, operationsConfig);
        events.push("runtime-registered");
        return runtimeHandle;
      },
      startEmergencyStopMonitor: ({ intervalMs }) => {
        assert.equal(intervalMs, 250);
        events.push("monitor-started");
      },
      stopEmergencyStopMonitor: async () => {
        events.push("monitor-stopped");
      },
      startScheduler: (handle, config) => {
        assert.equal(handle, runtimeHandle);
        assert.equal(config, operationsConfig);
        events.push("scheduler-started");
      },
      startOperationsHealthSampler: (handle, config) => {
        assert.equal(handle, runtimeHandle);
        assert.equal(config, operationsConfig);
        events.push("sampler-started");
        return {
          started: true,
          trigger: async () => undefined,
          stop: async () => {
            events.push("sampler-stopped");
          },
        };
      },
      stopScheduler: async () => {
        events.push("scheduler-stopped");
      },
      configureRuntimeControlWorkerAffinity: (handle) => {
        assert.equal(handle, runtimeHandle);
        events.push("control-affinity-configured");
      },
      startRuntimeControlWorker: (handle, environment) => {
        assert.equal(handle, runtimeHandle);
        assert.equal(environment.RUNTIME_ROLE, "worker");
        events.push("control-worker-started");
        return {
          stop: async () => {
            events.push("control-worker-stopped");
          },
        };
      },
      markRuntimeReady: () => {
        events.push("runtime-ready");
      },
      markRuntimeShuttingDown: () => {
        events.push("runtime-shutting-down");
      },
      markRuntimeDraining: async (handle) => {
        assert.equal(handle, runtimeHandle);
        events.push("runtime-draining");
      },
      markRuntimeOperationsUnknownAfterDrainTimeout: async () => {
        events.push("unexpected-operation-fence");
        return 0;
      },
      closeAllSessions: async () => {
        events.push("sessions-closed");
      },
      markRuntimeStopped: async (handle) => {
        assert.equal(handle, runtimeHandle);
        events.push("runtime-stopped");
      },
      closeDatabase: async () => {
        events.push("database-closed");
      },
    },
  );

  assert.deepEqual(events, [
    "database-ready",
    "providers-ready",
    "runtime-registered",
    "provider-identity-set",
    "control-affinity-configured",
    "control-worker-started",
    "monitor-started",
    "scheduler-started",
    "sampler-started",
    "runtime-ready",
  ]);

  await runtime.shutdown("test");

  assert.deepEqual(events, [
    "database-ready",
    "providers-ready",
    "runtime-registered",
    "provider-identity-set",
    "control-affinity-configured",
    "control-worker-started",
    "monitor-started",
    "scheduler-started",
    "sampler-started",
    "runtime-ready",
    "runtime-shutting-down",
    "scheduler-stopped",
    "sampler-stopped",
    "control-worker-stopped",
    "runtime-draining",
    "sessions-closed",
    "monitor-stopped",
    "runtime-stopped",
    "database-closed",
  ]);
});

test("worker closes initialized resources when runtime registration fails", async () => {
  const { startWorkerRuntime } = await import("./worker-main");
  const operationsConfig = readRuntimeOperationsConfig({
    RUNTIME_ROLE: "worker",
  });
  const rolePlan = planRuntimeRole({
    role: operationsConfig.role,
    schedulerSetting: undefined,
  });
  const events: string[] = [];
  const registrationError = new Error("synthetic registration failure");
  const dependencies: WorkerRuntimeDependencies = {
    databaseBackend: "test",
    waitForDatabase: async () => {
      events.push("database-ready");
    },
    bootstrapProviders: async () => {
      events.push("providers-ready");
    },
    setProviderRuntimeIdentity: async () => {
      events.push("unexpected-provider-identity");
    },
    registerRuntimeInstance: async () => {
      events.push("runtime-registration-attempted");
      throw registrationError;
    },
    startEmergencyStopMonitor: () => {
      events.push("unexpected-monitor-start");
    },
    stopEmergencyStopMonitor: async () => {
      events.push("monitor-stopped");
    },
    startScheduler: () => {
      events.push("unexpected-scheduler-start");
    },
    startOperationsHealthSampler: () => {
      events.push("unexpected-sampler-start");
      return {
        started: true,
        trigger: async () => undefined,
        stop: async () => undefined,
      };
    },
    stopScheduler: async () => {
      events.push("scheduler-stopped");
    },
    configureRuntimeControlWorkerAffinity: () => {
      events.push("unexpected-control-affinity");
    },
    startRuntimeControlWorker: () => {
      events.push("unexpected-control-worker-start");
      return { stop: async () => undefined };
    },
    markRuntimeReady: () => {
      events.push("unexpected-runtime-ready");
    },
    markRuntimeShuttingDown: () => {
      events.push("runtime-shutting-down");
    },
    markRuntimeDraining: async () => {
      events.push("runtime-draining");
    },
    markRuntimeOperationsUnknownAfterDrainTimeout: async () => {
      events.push("unexpected-operation-fence");
      return 0;
    },
    closeAllSessions: async () => {
      events.push("sessions-closed");
    },
    markRuntimeStopped: async () => {
      events.push("runtime-stopped");
    },
    closeDatabase: async () => {
      events.push("database-closed");
    },
  };

  await assert.rejects(
    startWorkerRuntime(
      {
        environment: { RUNTIME_ROLE: "worker" },
        operationsConfig,
        rolePlan,
        shutdownGraceMs: 1_000,
        emergencyStopMonitorMs: 250,
      },
      dependencies,
    ),
    registrationError,
  );

  assert.deepEqual(events, [
    "database-ready",
    "providers-ready",
    "runtime-registration-attempted",
    "monitor-stopped",
    "sessions-closed",
    "database-closed",
  ]);
});

test("validated synthetic worker skips provider bootstrap and injects only its task runner", async () => {
  const { startWorkerRuntime } = await import("./worker-main");
  const operationsConfig = readRuntimeOperationsConfig({
    RUNTIME_ROLE: "worker",
  });
  const rolePlan = planRuntimeRole({
    role: operationsConfig.role,
    schedulerSetting: undefined,
  });
  const runtimeHandle: RuntimeInstanceHandle = {
    id: "synthetic-worker-test-runtime",
    startedAt: new Date("2026-09-01T00:00:00.000Z"),
    stopHeartbeat: async () => undefined,
  };
  let providerBootstraps = 0;
  let providerIdentities = 0;
  let runtimeControlStarts = 0;
  let injectedRunner: unknown;
  const runtime = await startWorkerRuntime(
    {
      environment: {
        NODE_ENV: "test",
        RUNTIME_ROLE: "worker",
        SYNTHETIC_RUNTIME_ENABLED: "true",
        SYNTHETIC_RUNTIME_SEED: "240901",
        SYNTHETIC_RUNTIME_FAULT_PLAN: "[]",
        ENDURANCE_MODE: "accelerated",
        ENDURANCE_RUN_ID: "synthetic-worker-test",
      },
      operationsConfig,
      rolePlan,
      shutdownGraceMs: 1_000,
      emergencyStopMonitorMs: 250,
    },
    {
      databaseBackend: "test",
      waitForDatabase: async () => undefined,
      bootstrapProviders: async () => {
        providerBootstraps += 1;
      },
      setProviderRuntimeIdentity: async () => {
        providerIdentities += 1;
      },
      registerRuntimeInstance: async () => runtimeHandle,
      startEmergencyStopMonitor: () => undefined,
      stopEmergencyStopMonitor: async () => undefined,
      startScheduler: (_runtime, _config, dependencies) => {
        injectedRunner = dependencies?.runClaimedTask;
      },
      stopScheduler: async () => undefined,
      configureRuntimeControlWorkerAffinity: () => {
        runtimeControlStarts += 1;
      },
      startRuntimeControlWorker: () => {
        runtimeControlStarts += 1;
        return { stop: async () => undefined };
      },
      startOperationsHealthSampler: () => ({
        started: true,
        trigger: async () => undefined,
        stop: async () => undefined,
      }),
      markRuntimeReady: () => undefined,
      markRuntimeShuttingDown: () => undefined,
      markRuntimeDraining: async () => undefined,
      markRuntimeOperationsUnknownAfterDrainTimeout: async () => 0,
      closeAllSessions: async () => undefined,
      markRuntimeStopped: async () => undefined,
      closeDatabase: async () => undefined,
    },
  );

  assert.equal(providerBootstraps, 0);
  assert.equal(providerIdentities, 0);
  assert.equal(runtimeControlStarts, 0);
  assert.equal(typeof injectedRunner, "function");
  await runtime.shutdown("test");
});
