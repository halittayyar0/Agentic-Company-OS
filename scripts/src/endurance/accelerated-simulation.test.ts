import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAcceleratedReport,
  runAcceleratedEndurance,
} from "./accelerated-simulation";

test("a full virtual day exercises the ten-agent recovery contract", async () => {
  const result = await runAcceleratedEndurance({
    seed: 240_901,
    minutes: 1_440,
    runId: "accelerated-contract",
    startedAt: new Date("2026-09-01T00:00:00.000Z"),
    commitSha: "test-commit",
  });

  assert.equal(result.report.pass, true);
  assert.equal(result.report.verified24h, false);
  assert.equal(result.report.mode, "accelerated");
  assert.equal(result.report.simulatedMinutes, 1_440);
  assert.deepEqual(result.report.topology, {
    api: 1,
    workers: 2,
    agents: 10,
    database: "postgres",
  });
  assert.equal(result.healthSamples.length, 1_440);
  assert.equal(
    new Set(result.healthSamples.map((sample) => sample.minute)).size,
    1_440,
  );
  assert.deepEqual(
    result.healthSamples.map((sample) => sample.minute),
    Array.from({ length: 1_440 }, (_, index) => index + 1),
  );
  assert.equal(result.report.metrics.expectedResponsibilities, 14_400);
  assert.equal(result.report.metrics.completedResponsibilities, 14_400);
  assert.equal(result.report.metrics.maxResponsibilityCycleLag, 0);
  assert.equal(result.report.metrics.irreversibleReceiptSuccessCount, 14_400);
  assert.equal(
    result.report.metrics.duplicateIrreversibleReceiptKeys.length,
    0,
  );
  assert.equal(result.report.metrics.staleOwnerCommits, 0);
  assert.equal(result.report.metrics.missingIncidentIds.length, 0);
  assert.equal(result.report.metrics.healthTruthMismatches.length, 0);
  assert.equal(result.report.metrics.sseReconnectObserved, true);
  assert.equal(result.summary.handoffs > 0, true);
  assert.equal(result.summary.sleepCycles > 0, true);
  assert.equal(result.summary.wakeCycles > 0, true);

  const injectionKinds = result.report.injections.map((item) => item.kind);
  assert.equal(
    injectionKinds.filter((kind) => kind === "worker_loss").length,
    6,
  );
  for (const required of [
    "provider_timeout",
    "provider_rate_limit",
    "provider_malformed_output",
    "database_unavailable",
    "sse_disconnect",
    "emergency_stop",
  ]) {
    assert.equal(
      injectionKinds.includes(required),
      true,
      `missing ${required}`,
    );
  }
  assert.equal(
    result.report.injections.every((item) => item.pass),
    true,
  );
});

test("the same seed produces a byte-identical normalized report", async () => {
  const base = {
    seed: 240_901,
    minutes: 1_440,
    startedAt: new Date("2026-09-01T00:00:00.000Z"),
    commitSha: "test-commit",
  };
  const first = await runAcceleratedEndurance({ ...base, runId: "run-a" });
  const second = await runAcceleratedEndurance({ ...base, runId: "run-b" });

  assert.equal(
    JSON.stringify(normalizeAcceleratedReport(first.report)),
    JSON.stringify(normalizeAcceleratedReport(second.report)),
  );
  assert.deepEqual(first.healthSamples, second.healthSamples);
});

test("accelerated verification refuses a partial virtual day", async () => {
  await assert.rejects(
    runAcceleratedEndurance({
      seed: 1,
      minutes: 1_439,
      runId: "too-short",
      startedAt: new Date("2026-09-01T00:00:00.000Z"),
      commitSha: "test-commit",
    }),
    /at least 1,440/,
  );
});
