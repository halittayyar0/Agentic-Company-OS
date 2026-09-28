import { logger } from "./lib/logger";
import { readRuntimeOperationsConfig } from "./lib/runtime-operations-config";
import { assertEntrypointRole, planRuntimeRole } from "./lib/runtime-role-plan";
import {
  assertAgentSudoLocalOnly,
  assertRuntimeConfiguration,
  readBooleanEnvironment,
  readIntegerEnvironment,
} from "./lib/runtime-security";

function readConfiguredSchedulerSetting(): boolean | undefined {
  const raw = process.env.SCHEDULER_ENABLED;
  if (raw === undefined || raw === "") return undefined;
  return readBooleanEnvironment("SCHEDULER_ENABLED", false);
}

// This entry point deliberately imports no database, provider, scheduler,
// Express, or app module. Invalid roles and scheduler contradictions therefore
// fail before migrations, catalog requests, or other runtime side effects.
const operationsConfig = readRuntimeOperationsConfig();
assertEntrypointRole("worker", operationsConfig.role);
const rolePlan = planRuntimeRole({
  role: operationsConfig.role,
  schedulerSetting: readConfiguredSchedulerSetting(),
});

const host = process.env.HOST?.trim() || "127.0.0.1";
assertRuntimeConfiguration({ host });
assertAgentSudoLocalOnly({
  host,
  agentSudoEnabled: readBooleanEnvironment("ALLOW_AGENT_SUDO", false),
  remoteAccessEnabled: readBooleanEnvironment("ALLOW_REMOTE_ACCESS", false),
});

const shutdownGraceMs = readIntegerEnvironment(
  "SHUTDOWN_GRACE_MS",
  20_000,
  1_000,
  5 * 60_000,
);
const emergencyStopMonitorMs = readIntegerEnvironment(
  "EMERGENCY_STOP_MONITOR_MS",
  20_000,
  1_000,
  5 * 60_000,
);

void import("./worker-main")
  .then(async ({ installWorkerProcessHandlers, startWorkerRuntime }) => {
    const runtime = await startWorkerRuntime({
      environment: process.env,
      operationsConfig,
      rolePlan,
      shutdownGraceMs,
      emergencyStopMonitorMs,
    });
    installWorkerProcessHandlers(runtime);
  })
  .catch((error) => {
    logger.fatal({ error }, "Worker bootstrap failed");
    process.exitCode = 1;
  });
