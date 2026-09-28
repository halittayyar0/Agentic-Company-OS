import { logger } from "./lib/logger";
import { readRuntimeOperationsConfig } from "./lib/runtime-operations-config";
import { assertEntrypointRole, planRuntimeRole } from "./lib/runtime-role-plan";
import {
  assertAgentSudoLocalOnly,
  assertRuntimeConfiguration,
  isLoopbackBindHost,
  readBooleanEnvironment,
  readIntegerEnvironment,
} from "./lib/runtime-security";

function readConfiguredSchedulerSetting(): boolean | undefined {
  const raw = process.env.SCHEDULER_ENABLED;
  if (raw === undefined || raw === "") return undefined;
  return readBooleanEnvironment("SCHEDULER_ENABLED", false);
}

// Keep this entry point free of database, Express/app, scheduler, and provider
// imports. Static ESM imports execute before module code, so the complete role
// and security preflight must finish before the runtime is loaded dynamically.
const operationsConfig = readRuntimeOperationsConfig();
assertEntrypointRole("api", operationsConfig.role);

const host = process.env.HOST?.trim() || "127.0.0.1";
const configuredSchedulerSetting = readConfiguredSchedulerSetting();
const rolePlan = planRuntimeRole({
  role: operationsConfig.role,
  schedulerSetting:
    operationsConfig.role === "combined"
      ? (configuredSchedulerSetting ?? isLoopbackBindHost(host))
      : configuredSchedulerSetting,
});

const rawPort = process.env.PORT ?? "5000";
const port = Number(rawPort);
if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

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

void import("./runtime-main")
  .then(async ({ installHttpProcessHandlers, startHttpRuntime }) => {
    const runtime = await startHttpRuntime({
      environment: process.env,
      host,
      port,
      operationsConfig,
      rolePlan,
      shutdownGraceMs,
      emergencyStopMonitorMs,
    });
    installHttpProcessHandlers(runtime);
  })
  .catch((error) => {
    logger.fatal({ error }, "Runtime bootstrap failed");
    process.exitCode = 1;
  });
