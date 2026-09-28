import assert from "node:assert/strict";
import test from "node:test";

import {
  createSeededFaultSchedule,
  executeScheduledFault,
  type FaultInjectionControls,
} from "./fault-injector";

test("24-hour schedule distributes six worker deaths and every required fault", () => {
  const schedule = createSeededFaultSchedule({
    seed: 240_901,
    durationMs: 24 * 60 * 60 * 1_000,
  });
  const workerLosses = schedule.filter((fault) => fault.kind === "worker_loss");
  assert.equal(workerLosses.length, 6);
  assert.equal(
    workerLosses.every(
      (fault, index) =>
        fault.atMs > 0 &&
        fault.atMs < 24 * 60 * 60 * 1_000 &&
        (index === 0 || fault.atMs > workerLosses[index - 1].atMs),
    ),
    true,
  );
  for (const kind of [
    "provider_timeout",
    "provider_rate_limit",
    "provider_malformed_output",
    "database_unavailable",
    "sse_disconnect",
    "emergency_stop",
  ] as const) {
    assert.equal(
      schedule.some((fault) => fault.kind === kind),
      true,
      kind,
    );
  }
  const databaseOutage = schedule.find(
    (fault) => fault.kind === "database_unavailable",
  );
  assert.ok(databaseOutage, "the long run must inject a database outage");
  assert.ok(
    databaseOutage.durationMs > 60_000,
    "the database outage must span at least one 60-second health sampler tick",
  );
  assert.ok(
    databaseOutage.durationMs < 120_000,
    "the database outage must leave time inside the 120-second recovery SLO",
  );
  const providerFaults = schedule.filter((fault) =>
    fault.kind.startsWith("provider_"),
  );
  assert.equal(providerFaults.length, 3);
  for (const fault of providerFaults) {
    assert.ok(
      fault.durationMs > 60_000,
      `${fault.id} must overlap at least one cycle at the production 60-second cadence`,
    );
    assert.ok(
      fault.durationMs < 120_000,
      `${fault.id} must leave time inside the 120-second recovery SLO`,
    );
  }
  for (const [index, fault] of schedule.entries()) {
    const next = schedule[index + 1];
    if (!next) continue;
    assert.ok(
      fault.atMs + fault.durationMs < next.atMs,
      `${fault.id} must finish before ${next.id} begins`,
    );
  }
  assert.deepEqual(
    schedule,
    createSeededFaultSchedule({
      seed: 240_901,
      durationMs: 24 * 60 * 60 * 1_000,
    }),
  );
});

test("short smoke still includes worker, provider, and SSE recovery", () => {
  const schedule = createSeededFaultSchedule({
    seed: 7,
    durationMs: 5 * 60 * 1_000,
  });
  assert.equal(
    schedule.some((item) => item.kind === "worker_loss"),
    true,
  );
  assert.equal(
    schedule.some((item) => item.kind.startsWith("provider_")),
    true,
  );
  assert.equal(
    schedule.some((item) => item.kind === "sse_disconnect"),
    true,
  );
});

test("compressed-all profile live-exercises every fault kind inside a short non-overlapping horizon", () => {
  const durationMs = 2 * 60_000;
  const schedule = createSeededFaultSchedule({
    seed: 240_901,
    durationMs,
    profile: "compressed-all",
  });
  assert.deepEqual(
    new Set(schedule.map((fault) => fault.kind)),
    new Set([
      "worker_loss",
      "provider_timeout",
      "provider_rate_limit",
      "provider_malformed_output",
      "database_unavailable",
      "sse_disconnect",
      "emergency_stop",
    ]),
  );
  assert.equal(schedule.length, 7);
  assert.ok(
    schedule.find((fault) => fault.kind === "worker_loss")!.durationMs > 10_000,
    "worker loss must span the five-second stale threshold plus a scheduler tick",
  );
  for (const [index, fault] of schedule.entries()) {
    assert.ok(fault.atMs + fault.durationMs < durationMs);
    const next = schedule[index + 1];
    if (next) {
      assert.ok(fault.atMs + fault.durationMs + 5_000 < next.atMs);
    }
  }
  assert.deepEqual(
    schedule,
    createSeededFaultSchedule({
      seed: 240_901,
      durationMs,
      profile: "compressed-all",
    }),
  );
});

test("compressed-all profile refuses a horizon too short for isolated all-fault evidence", () => {
  assert.throws(
    () =>
      createSeededFaultSchedule({
        seed: 1,
        durationMs: 60_000,
        profile: "compressed-all",
      }),
    /compressed-all.*two minutes|two-minute/iu,
  );
});

test("long-run seeded jitter never overlaps fault or recovery windows", () => {
  const durationMs = 24 * 60 * 60 * 1_000;
  for (let seed = 0; seed < 4_096; seed += 1) {
    const schedule = createSeededFaultSchedule({ seed, durationMs });
    for (const [index, fault] of schedule.entries()) {
      assert.ok(
        fault.atMs + fault.durationMs < durationMs,
        `seed ${seed}: ${fault.id} must finish inside the run horizon`,
      );
      const next = schedule[index + 1];
      if (!next) continue;
      assert.ok(
        fault.atMs + fault.durationMs + 120_000 < next.atMs,
        `seed ${seed}: ${fault.id} must finish its recovery SLO before ${next.id} begins`,
      );
    }
  }
});

test("one-minute schedule isolates each fault and leaves a recovery gap", () => {
  const durationMs = 60_000;
  const minimumRecoveryGapMs = 5_000;
  const schedule = createSeededFaultSchedule({
    seed: 240_901,
    durationMs,
  });

  for (const [index, fault] of schedule.entries()) {
    assert.ok(
      fault.atMs + fault.durationMs < durationMs,
      `${fault.id} must finish inside the run horizon`,
    );
    const next = schedule[index + 1];
    if (!next) continue;
    assert.ok(
      fault.atMs + fault.durationMs + minimumRecoveryGapMs < next.atMs,
      `${fault.id} must recover before ${next.id} begins`,
    );
  }
});

function controls(
  log: string[],
  sleep: (milliseconds: number) => Promise<void>,
) {
  return {
    listActiveWorkers: async () => ["worker-1", "worker-2"] as const,
    killWorker: async (worker: string) => {
      log.push(`kill:${worker}`);
    },
    restartWorker: async (worker: string) => {
      log.push(`restart:${worker}`);
    },
    setProviderFault: async (kind: string, faultId: string) => {
      log.push(`provider:${kind}:${faultId}`);
    },
    clearProviderFault: async (faultId: string) => {
      log.push(`provider-clear:${faultId}`);
    },
    pauseDatabase: async () => {
      log.push("database:pause");
    },
    resumeDatabase: async () => {
      log.push("database:resume");
    },
    disconnectObserverStream: async () => {
      log.push("sse:disconnect");
    },
    reconnectObserverStream: async () => {
      log.push("sse:reconnect");
    },
    enableEmergencyStop: async () => {
      log.push("emergency:stop");
    },
    disableEmergencyStop: async () => {
      log.push("emergency:resume");
    },
    sleep,
  } satisfies FaultInjectionControls;
}

test("worker death targets only an active worker and restarts it", async () => {
  const log: string[] = [];
  const result = await executeScheduledFault(
    {
      id: "worker-loss-1",
      kind: "worker_loss",
      atMs: 1_000,
      durationMs: 30_000,
      targetIndex: 1,
    },
    controls(log, async (duration) => {
      log.push(`sleep:${duration}`);
    }),
  );
  assert.deepEqual(log, ["kill:worker-2", "sleep:30000", "restart:worker-2"]);
  assert.equal(result.target, "worker-2");
});

test("bounded database and emergency cleanup runs even when waiting aborts", async () => {
  for (const kind of ["database_unavailable", "emergency_stop"] as const) {
    const log: string[] = [];
    await assert.rejects(
      executeScheduledFault(
        { id: `${kind}-1`, kind, atMs: 1, durationMs: 20_000, targetIndex: 0 },
        controls(log, async () => {
          throw new Error("aborted");
        }),
      ),
      /aborted/,
    );
    assert.equal(
      log.at(-1),
      kind === "database_unavailable" ? "database:resume" : "emergency:resume",
    );
  }
});

test("SSE injection disconnects only the observer connection", async () => {
  const log: string[] = [];
  await executeScheduledFault(
    {
      id: "sse-disconnect-1",
      kind: "sse_disconnect",
      atMs: 1,
      durationMs: 5_000,
      targetIndex: 0,
    },
    controls(log, async () => undefined),
  );
  assert.deepEqual(log, ["sse:disconnect", "sse:reconnect"]);
});
