import assert from "node:assert/strict";
import test from "node:test";
import {
  readRuntimeOperationsConfig,
  type RuntimeRole,
} from "./runtime-operations-config";

const DEFAULT_CONFIG = {
  role: "combined",
  schedulerTickMs: 5_000,
  taskLeaseMs: 90_000,
  taskHeartbeatMs: 15_000,
  runtimeHeartbeatMs: 5_000,
  workerStaleAfterMs: 15_000,
  recoveryTargetMs: 120_000,
  opsSampleMs: 60_000,
  opsSampleRetentionDays: 30,
  opsSseMaxClients: 100,
} as const;

test("uses the documented durable-runtime defaults in an immutable config", () => {
  const config = readRuntimeOperationsConfig({});

  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(Object.isFrozen(config), true);
});

test("accepts every supported runtime role", () => {
  const cases: ReadonlyArray<readonly [string, RuntimeRole]> = [
    ["api", "api"],
    ["worker", "worker"],
    ["combined", "combined"],
  ];

  for (const [configured, expected] of cases) {
    assert.equal(
      readRuntimeOperationsConfig({ RUNTIME_ROLE: configured }).role,
      expected,
    );
  }
});

test("rejects unsupported runtime roles", () => {
  for (const configured of ["", "API", "scheduler", "combined "]) {
    assert.throws(
      () => readRuntimeOperationsConfig({ RUNTIME_ROLE: configured }),
      /RUNTIME_ROLE must be api, worker, or combined/,
    );
  }
});

test("rejects runtime values outside safe configured bounds", () => {
  const cases: ReadonlyArray<readonly [string, NodeJS.ProcessEnv, RegExp]> = [
    [
      "fractional heartbeat",
      { TASK_HEARTBEAT_MS: "15000.5" },
      /TASK_HEARTBEAT_MS must be an integer from 1000 to 15000/,
    ],
    [
      "heartbeat slower than the visibility window",
      { TASK_HEARTBEAT_MS: "15001" },
      /TASK_HEARTBEAT_MS must be an integer from 1000 to 15000/,
    ],
    [
      "lease beyond the recovery target",
      { TASK_LEASE_MS: "120001" },
      /TASK_LEASE_MS must be an integer from 30000 to 120000/,
    ],
    [
      "stale threshold beyond the visible-interruption target",
      { WORKER_STALE_AFTER_MS: "15001" },
      /WORKER_STALE_AFTER_MS must be an integer from 5000 to 15000/,
    ],
    [
      "recovery target beyond the recovery SLO",
      { RECOVERY_TARGET_MS: "120001" },
      /RECOVERY_TARGET_MS must be an integer from 30001 to 120000/,
    ],
    [
      "unsafe integer precision",
      { OPS_SSE_MAX_CLIENTS: "9007199254740992" },
      /OPS_SSE_MAX_CLIENTS must be an integer from 1 to 1000/,
    ],
  ];

  for (const [_name, env, expected] of cases) {
    assert.throws(() => readRuntimeOperationsConfig(env), expected);
  }
});

test("rejects an unsafe lease ratio", () => {
  assert.throws(
    () =>
      readRuntimeOperationsConfig({
        TASK_LEASE_MS: "60000",
        TASK_HEARTBEAT_MS: "15000",
      }),
    /TASK_LEASE_MS must be greater than four TASK_HEARTBEAT_MS periods/,
  );
});

test("rejects recovery targets that do not outlast the task lease", () => {
  assert.throws(
    () =>
      readRuntimeOperationsConfig({
        TASK_LEASE_MS: "90000",
        RECOVERY_TARGET_MS: "90000",
      }),
    /RECOVERY_TARGET_MS must be greater than TASK_LEASE_MS/,
  );
});

test("rejects a lease whose worst-phase scheduler poll exceeds the recovery target", () => {
  assert.throws(
    () =>
      readRuntimeOperationsConfig({
        TASK_LEASE_MS: "119000",
        SCHEDULER_TICK_MS: "15000",
        RECOVERY_TARGET_MS: "120000",
      }),
    /TASK_LEASE_MS plus SCHEDULER_TICK_MS must not exceed RECOVERY_TARGET_MS/,
  );
});

test("a fake worst-phase clock remains inside the configured recovery target", () => {
  const config = readRuntimeOperationsConfig({
    TASK_LEASE_MS: "105000",
    SCHEDULER_TICK_MS: "15000",
    RECOVERY_TARGET_MS: "120000",
  });
  const claimedAtMs = 1;
  const leaseExpiresAtMs = claimedAtMs + config.taskLeaseMs;
  const pollImmediatelyBeforeExpiryMs = leaseExpiresAtMs - 1;
  const nextRecoveryPollMs =
    pollImmediatelyBeforeExpiryMs + config.schedulerTickMs;

  assert.ok(
    nextRecoveryPollMs - claimedAtMs <= config.recoveryTargetMs,
    "the poll immediately after expiry must remain inside the recovery SLO",
  );
});

test("rejects runtime heartbeats that cannot precede the stale threshold", () => {
  assert.throws(
    () =>
      readRuntimeOperationsConfig({
        RUNTIME_HEARTBEAT_MS: "15000",
        WORKER_STALE_AFTER_MS: "10000",
      }),
    /RUNTIME_HEARTBEAT_MS must be less than WORKER_STALE_AFTER_MS/,
  );
});
