import { readIntegerEnvironment } from "./runtime-security";

export type RuntimeRole = "api" | "worker" | "combined";

export interface RuntimeOperationsConfig {
  role: RuntimeRole;
  schedulerTickMs: number;
  taskLeaseMs: number;
  taskHeartbeatMs: number;
  runtimeHeartbeatMs: number;
  workerStaleAfterMs: number;
  recoveryTargetMs: number;
  opsSampleMs: number;
  opsSampleRetentionDays: number;
  opsSseMaxClients: number;
}

function readRuntimeRole(env: NodeJS.ProcessEnv): RuntimeRole {
  const role = env.RUNTIME_ROLE;
  if (role === undefined) return "combined";
  if (role === "api" || role === "worker" || role === "combined") {
    return role;
  }
  throw new Error("RUNTIME_ROLE must be api, worker, or combined.");
}

export function readRuntimeOperationsConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeOperationsConfig {
  const config: RuntimeOperationsConfig = {
    role: readRuntimeRole(env),
    schedulerTickMs: readIntegerEnvironment(
      "SCHEDULER_TICK_MS",
      5_000,
      1_000,
      15_000,
      env,
    ),
    taskLeaseMs: readIntegerEnvironment(
      "TASK_LEASE_MS",
      90_000,
      30_000,
      120_000,
      env,
    ),
    taskHeartbeatMs: readIntegerEnvironment(
      "TASK_HEARTBEAT_MS",
      15_000,
      1_000,
      15_000,
      env,
    ),
    runtimeHeartbeatMs: readIntegerEnvironment(
      "RUNTIME_HEARTBEAT_MS",
      5_000,
      1_000,
      15_000,
      env,
    ),
    workerStaleAfterMs: readIntegerEnvironment(
      "WORKER_STALE_AFTER_MS",
      15_000,
      5_000,
      15_000,
      env,
    ),
    recoveryTargetMs: readIntegerEnvironment(
      "RECOVERY_TARGET_MS",
      120_000,
      30_001,
      120_000,
      env,
    ),
    opsSampleMs: readIntegerEnvironment(
      "OPS_SAMPLE_MS",
      60_000,
      10_000,
      3_600_000,
      env,
    ),
    opsSampleRetentionDays: readIntegerEnvironment(
      "OPS_SAMPLE_RETENTION_DAYS",
      30,
      1,
      3_650,
      env,
    ),
    opsSseMaxClients: readIntegerEnvironment(
      "OPS_SSE_MAX_CLIENTS",
      100,
      1,
      1_000,
      env,
    ),
  };

  if (config.taskLeaseMs <= config.taskHeartbeatMs * 4) {
    throw new Error(
      "TASK_LEASE_MS must be greater than four TASK_HEARTBEAT_MS periods.",
    );
  }
  if (config.runtimeHeartbeatMs >= config.workerStaleAfterMs) {
    throw new Error(
      "RUNTIME_HEARTBEAT_MS must be less than WORKER_STALE_AFTER_MS.",
    );
  }
  if (config.recoveryTargetMs <= config.taskLeaseMs) {
    throw new Error("RECOVERY_TARGET_MS must be greater than TASK_LEASE_MS.");
  }
  if (config.taskLeaseMs + config.schedulerTickMs > config.recoveryTargetMs) {
    throw new Error(
      "TASK_LEASE_MS plus SCHEDULER_TICK_MS must not exceed RECOVERY_TARGET_MS.",
    );
  }

  return Object.freeze(config);
}
