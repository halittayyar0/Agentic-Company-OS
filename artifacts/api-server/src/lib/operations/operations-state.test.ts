import assert from "node:assert/strict";
import test from "node:test";
import { deriveRuntimeTruth, effectiveRuntimeState } from "./operations-state";

const now = new Date("2026-09-01T12:00:00.000Z");

function worker(input: {
  id?: string;
  state?: "starting" | "healthy" | "draining" | "stale" | "stopped";
  heartbeatAgeMs?: number;
  tickAgeMs?: number | null;
}) {
  return {
    id: input.id ?? "worker-1",
    role: "worker" as const,
    state: input.state ?? ("healthy" as const),
    schedulerEnabled: true,
    lastHeartbeatAt: new Date(now.getTime() - (input.heartbeatAgeMs ?? 1_000)),
    lastSchedulerTickAt:
      input.tickAgeMs === null
        ? null
        : new Date(now.getTime() - (input.tickAgeMs ?? 1_000)),
  };
}

test("effective runtime state never trusts a persisted healthy row past its heartbeat cutoff", () => {
  assert.equal(
    effectiveRuntimeState(worker({ heartbeatAgeMs: 14_999 }), now, 15_000),
    "healthy",
  );
  assert.equal(
    effectiveRuntimeState(worker({ heartbeatAgeMs: 15_000 }), now, 15_000),
    "stale",
  );
  assert.equal(
    effectiveRuntimeState(worker({ state: "stopped" }), now, 15_000),
    "stopped",
  );
});

test("runtime truth fails closed and labels embedded storage as local demo", () => {
  assert.deepEqual(
    deriveRuntimeTruth({
      now,
      databaseBackend: "pglite",
      emergencyStopEnabled: false,
      workerStaleAfterMs: 15_000,
      instances: [worker({})],
    }).state,
    "local_demo",
  );

  const emergency = deriveRuntimeTruth({
    now,
    databaseBackend: "postgresql",
    emergencyStopEnabled: true,
    workerStaleAfterMs: 15_000,
    instances: [worker({})],
  });
  assert.equal(emergency.state, "emergency_stopped");
  assert.deepEqual(emergency.reasons, ["emergency_stop_active"]);
});

test("runtime truth distinguishes live, degraded, stale, and offline fleets", () => {
  assert.equal(
    deriveRuntimeTruth({
      now,
      databaseBackend: "postgresql",
      emergencyStopEnabled: false,
      workerStaleAfterMs: 15_000,
      instances: [worker({})],
    }).state,
    "live",
  );
  assert.equal(
    deriveRuntimeTruth({
      now,
      databaseBackend: "postgresql",
      emergencyStopEnabled: false,
      workerStaleAfterMs: 15_000,
      instances: [worker({ tickAgeMs: 15_000 })],
    }).state,
    "degraded",
  );
  assert.equal(
    deriveRuntimeTruth({
      now,
      databaseBackend: "postgresql",
      emergencyStopEnabled: false,
      workerStaleAfterMs: 15_000,
      instances: [worker({ heartbeatAgeMs: 15_000 })],
    }).state,
    "stale",
  );
  assert.equal(
    deriveRuntimeTruth({
      now,
      databaseBackend: "postgresql",
      emergencyStopEnabled: false,
      workerStaleAfterMs: 15_000,
      instances: [],
    }).state,
    "offline",
  );
});

test("a replaced stale worker remains visible without poisoning a fresh healthy fleet", () => {
  const truth = deriveRuntimeTruth({
    now,
    databaseBackend: "postgresql",
    emergencyStopEnabled: false,
    workerStaleAfterMs: 15_000,
    instances: [
      worker({ id: "worker-retired", heartbeatAgeMs: 60_000 }),
      worker({ id: "worker-replacement", heartbeatAgeMs: 500, tickAgeMs: 500 }),
      worker({ id: "worker-current", heartbeatAgeMs: 750, tickAgeMs: 750 }),
    ],
  });

  assert.equal(truth.state, "live");
  assert.deepEqual(truth.reasons, []);
  assert.equal(truth.healthyWorkerCount, 2);
  assert.equal(truth.staleWorkerCount, 1);
  assert.equal(truth.schedulerTickAgeMs, 500);
});

test("a transitional worker still degrades an otherwise healthy fleet", () => {
  const truth = deriveRuntimeTruth({
    now,
    databaseBackend: "postgresql",
    emergencyStopEnabled: false,
    workerStaleAfterMs: 15_000,
    instances: [
      worker({ id: "worker-live" }),
      worker({ id: "worker-draining", state: "draining" }),
    ],
  });

  assert.equal(truth.state, "degraded");
  assert.deepEqual(truth.reasons, ["worker_transition_in_progress"]);
  assert.equal(truth.healthyWorkerCount, 1);
  assert.equal(truth.staleWorkerCount, 0);
});
