import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateEnduranceInvariants,
  type EnduranceInvariantInput,
} from "./invariants";
import {
  createEnduranceReport,
  serializeEnduranceJournalEvent,
  serializeEnduranceReport,
} from "./report-schema";
import { ScenarioClock } from "./scenario-clock";

function passingInput(
  overrides: Partial<EnduranceInvariantInput> = {},
): EnduranceInvariantInput {
  return {
    expectedResponsibilities: 14_400,
    completedResponsibilities: 14_400,
    maxResponsibilityCycleLag: 0,
    irreversibleReceiptSuccessCount: 1,
    duplicateIrreversibleReceiptKeys: [],
    staleOwnerCommits: 0,
    recoveryDurationsMs: [42_000, 93_000],
    missingIncidentIds: [],
    healthTruthMismatches: [],
    sseReconnectObserved: true,
    healthSampleBuckets: 1_440,
    ...overrides,
  };
}

test("all durable endurance acceptance criteria pass together", () => {
  const result = evaluateEnduranceInvariants(passingInput());
  assert.equal(result.pass, true);
  assert.equal(
    result.assertions.every((assertion) => assertion.pass),
    true,
  );
  assert.equal(result.assertions.length, 10);
});

test("a declared short smoke window uses its own explicit bucket contract", () => {
  const result = evaluateEnduranceInvariants(
    passingInput({
      healthSampleBuckets: 5,
      requiredHealthSampleBuckets: 5,
    }),
  );
  assert.equal(result.pass, true);
  assert.equal(
    result.assertions.find((item) => item.id === "health_samples_complete")
      ?.expected,
    ">=5",
  );
});

for (const scenario of [
  {
    name: "lost responsibility",
    patch: { completedResponsibilities: 14_399 },
    assertion: "responsibilities_complete",
  },
  {
    name: "missing irreversible receipt evidence",
    patch: { irreversibleReceiptSuccessCount: 0 },
    assertion: "irreversible_receipt_evidence_observed",
  },
  {
    name: "responsibility cycle lag beyond the recovery bound",
    patch: { maxResponsibilityCycleLag: 3 },
    assertion: "responsibility_cycle_lag_bounded",
  },
  {
    name: "duplicate irreversible receipt",
    patch: { duplicateIrreversibleReceiptKeys: ["effect-7"] },
    assertion: "no_duplicate_irreversible_receipts",
  },
  {
    name: "stale owner commit",
    patch: { staleOwnerCommits: 1 },
    assertion: "no_stale_owner_commits",
  },
  {
    name: "slow recovery",
    patch: { recoveryDurationsMs: [120_001] },
    assertion: "recoveries_within_target",
  },
  {
    name: "missing incident",
    patch: { missingIncidentIds: ["worker-death-3"] },
    assertion: "all_injections_visible",
  },
  {
    name: "false-green health",
    patch: { healthTruthMismatches: ["bucket-81"] },
    assertion: "health_truth_consistent",
  },
  {
    name: "missing SSE reconnect",
    patch: { sseReconnectObserved: false },
    assertion: "sse_reconnected",
  },
  {
    name: "short health history",
    patch: { healthSampleBuckets: 1_439 },
    assertion: "health_samples_complete",
  },
] as const) {
  test(`invariant evaluator rejects ${scenario.name}`, () => {
    const result = evaluateEnduranceInvariants(
      passingInput(scenario.patch as Partial<EnduranceInvariantInput>),
    );
    assert.equal(result.pass, false);
    assert.equal(
      result.assertions.find((item) => item.id === scenario.assertion)?.pass,
      false,
    );
  });
}

test("verified24h is computed and accelerated reports can never earn it", () => {
  const base = {
    runId: "soak-test-001",
    seed: 240901,
    startedAt: "2026-09-01T00:00:00.000Z",
    completedAt: "2026-09-02T00:00:01.000Z",
    wallClockHours: 24.0002,
    simulatedMinutes: 1_440,
    commitSha: "abc123",
    topology: { api: 1, workers: 2, agents: 10, database: "postgres" as const },
    injections: [],
    metrics: passingInput(),
  };

  const accelerated = createEnduranceReport({
    ...base,
    mode: "accelerated",
  });
  const wallClock = createEnduranceReport({ ...base, mode: "wall_clock" });
  const tooShort = createEnduranceReport({
    ...base,
    mode: "wall_clock",
    wallClockHours: 23.999,
  });

  assert.equal(accelerated.pass, true);
  assert.equal(accelerated.verified24h, false);
  assert.equal(wallClock.verified24h, true);
  assert.equal(tooShort.verified24h, false);
});

test("scenario clock advances deterministic virtual minutes monotonically", () => {
  const clock = new ScenarioClock({
    mode: "accelerated",
    startedAt: new Date("2026-09-01T00:00:00.000Z"),
  });
  assert.equal(clock.minute, 0);
  assert.equal(clock.now().toISOString(), "2026-09-01T00:00:00.000Z");
  clock.advanceMinutes(1_440);
  assert.equal(clock.minute, 1_440);
  assert.equal(clock.now().toISOString(), "2026-09-02T00:00:00.000Z");
  assert.throws(() => clock.advanceMinutes(0), /positive integer/);
  assert.throws(() => clock.advanceMinutes(-1), /positive integer/);
});

test("journal and report serialization are one-record JSONL and stable JSON", () => {
  const event = serializeEnduranceJournalEvent({
    schemaVersion: 1,
    runId: "run-1",
    sequence: 7,
    occurredAt: "2026-09-01T00:07:00.000Z",
    kind: "fault_observed",
    data: { faultId: "worker-death-1" },
  });
  assert.equal(event.endsWith("\n"), true);
  assert.equal(event.slice(0, -1).includes("\n"), false);
  assert.equal(JSON.parse(event).sequence, 7);

  const report = createEnduranceReport({
    runId: "run-1",
    mode: "accelerated",
    seed: 1,
    startedAt: "2026-09-01T00:00:00.000Z",
    completedAt: "2026-09-01T00:01:00.000Z",
    wallClockHours: 1 / 60,
    simulatedMinutes: 1_440,
    commitSha: "abc123",
    topology: { api: 1, workers: 2, agents: 10, database: "postgres" },
    injections: [],
    metrics: passingInput(),
  });
  const serialized = serializeEnduranceReport(report);
  assert.equal(serialized.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(serialized), report);
});
