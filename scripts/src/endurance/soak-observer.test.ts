import assert from "node:assert/strict";
import test from "node:test";

import { SoakEvidenceObserver } from "./soak-observer";

test("observer derives passing metrics from independent durable evidence", () => {
  const observer = new SoakEvidenceObserver({ expectedResponsibilities: 20 });
  observer.scheduleFault({
    id: "worker-loss-1",
    kind: "worker_loss",
    scheduledAt: "2026-09-01T01:00:00.000Z",
  });
  observer.observeIncident({
    faultId: "worker-loss-1",
    incidentId: "incident-9",
    observedAt: "2026-09-01T01:00:05.000Z",
    sourceKind: "durable_event",
    sourceId: "postgres:event-9",
  });
  observer.observeRecovery({
    faultId: "worker-loss-1",
    recoveredAt: "2026-09-01T01:01:05.000Z",
    sourceKind: "durable_event",
    sourceId: "postgres:event-10",
  });
  observer.completeResponsibilities(20);
  observer.observeResponsibilityCycleLag(2);
  observer.observeResponsibilityCycleLag(1);
  observer.observeReceipt({
    receiptId: "receipt-effect-1",
    key: "effect-1",
    irreversible: true,
    succeeded: true,
  });
  observer.observeReceipt({
    receiptId: "receipt-read-1",
    key: "read-1",
    irreversible: false,
    succeeded: true,
  });
  observer.observeSseDisconnect("41");
  observer.observeSseReconnect("42");
  for (let minute = 1; minute <= 1_440; minute += 1) {
    observer.observeHealth({
      minute,
      reportedState: minute === 60 ? "degraded" : "healthy",
      truthState: minute === 60 ? "degraded" : "healthy",
    });
  }

  const evidence = observer.finalize();
  assert.equal(evidence.metrics.completedResponsibilities, 20);
  assert.equal(evidence.metrics.maxResponsibilityCycleLag, 2);
  assert.equal(evidence.metrics.irreversibleReceiptSuccessCount, 1);
  assert.deepEqual(evidence.metrics.recoveryDurationsMs, [60_000]);
  assert.equal(evidence.metrics.sseReconnectObserved, true);
  assert.equal(evidence.injections[0].incidentId, "incident-9");
  assert.equal(evidence.injections[0].pass, true);
});

test("observer exposes missing incidents, false green, duplicate effects, and stale commits", () => {
  const observer = new SoakEvidenceObserver({ expectedResponsibilities: 1 });
  observer.scheduleFault({
    id: "missing-fault",
    kind: "provider_timeout",
    scheduledAt: "2026-09-01T00:00:00.000Z",
  });
  observer.observeReceipt({
    receiptId: "receipt-effect-1",
    key: "effect-1",
    irreversible: true,
    succeeded: true,
  });
  observer.observeReceipt({
    receiptId: "receipt-effect-2",
    key: "effect-1",
    irreversible: true,
    succeeded: true,
  });
  observer.observeReceipt({
    receiptId: "receipt-effect-1",
    key: "effect-1",
    irreversible: true,
    succeeded: true,
  });
  observer.observeStaleOwnerCommit();
  observer.observeHealth({
    minute: 1,
    reportedState: "healthy",
    truthState: "degraded",
  });
  observer.observeSseDisconnect("8");
  observer.observeSseReconnect("8");
  const evidence = observer.finalize();
  assert.deepEqual(evidence.metrics.missingIncidentIds, ["missing-fault"]);
  assert.deepEqual(evidence.metrics.duplicateIrreversibleReceiptKeys, [
    "effect-1",
  ]);
  assert.equal(evidence.metrics.irreversibleReceiptSuccessCount, 2);
  assert.equal(evidence.metrics.staleOwnerCommits, 1);
  assert.deepEqual(evidence.metrics.healthTruthMismatches, ["minute-1"]);
  assert.equal(evidence.metrics.sseReconnectObserved, false);
});

test("observer preserves bounded primary receipt, agent-cycle, lag, health, and SSE evidence", () => {
  const observer = new SoakEvidenceObserver({
    expectedResponsibilities: 1,
    runId: "primary-proof",
  });
  observer.observeReceipt({
    receiptId: "receipt-1",
    key: "operation-1",
    irreversible: true,
    succeeded: true,
    observedAt: "2026-09-01T00:01:01.000Z",
    toolName: "synthetic_fixture_write",
    sideEffectClass: "at_most_once",
    finishedAt: "2026-09-01T00:01:00.000Z",
    originAttempt: {
      id: "attempt-1",
      taskId: 11,
      agentId: 7,
      cycleNumber: 0,
      state: "succeeded",
      finishedAt: "2026-09-01T00:01:00.000Z",
    },
    invocations: [
      {
        id: "invocation-1",
        state: "succeeded",
        effectStartedAt: "2026-09-01T00:00:59.000Z",
        finishedAt: "2026-09-01T00:01:00.000Z",
      },
    ],
  });
  observer.observeResponsibility({
    receiptId: "receipt-1",
    taskId: 11,
    agentId: 7,
    cycleNumber: 0,
    completedAt: "2026-09-01T00:01:00.000Z",
    observedAt: "2026-09-01T00:01:01.000Z",
  });
  observer.observeResponsibilityCycleLag(1, {
    minute: 1,
    observedAt: "2026-09-01T00:01:01.000Z",
  });
  observer.observeHealth({
    minute: 1,
    reportedState: "healthy",
    truthState: "healthy",
    bucketAt: "2026-09-01T00:01:00.000Z",
    sampledAt: "2026-09-01T00:01:01.000Z",
    runtimeTruthState: "live",
    healthyWorkerCount: 2,
    staleWorkerCount: 0,
    schedulerTickAgeMs: 500,
  });
  observer.observeSseDisconnect("41", "2026-09-01T00:01:02.000Z");
  observer.observeSseReconnect("42", "2026-09-01T00:01:03.000Z");

  const evidence = observer.finalize();
  assert.equal(evidence.metrics.completedResponsibilities, 1);
  assert.deepEqual(
    evidence.primaryEvidence.map((item) => item.kind),
    [
      "receipt_observed",
      "responsibility_completed",
      "responsibility_cycle_lag",
      "health_observed",
      "sse_disconnected",
      "sse_reconnected",
    ],
  );
  assert.deepEqual(
    evidence.primaryEvidence.map((item) => item.sequence),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(evidence.primaryEvidence[0].runId, "primary-proof");
});

test("observer preserves durable incident and recovery source identities as primary fault evidence", () => {
  const observer = new SoakEvidenceObserver({
    expectedResponsibilities: 0,
    runId: "fault-primary-proof",
  });
  observer.scheduleFault({
    id: "worker-loss-1",
    kind: "worker_loss",
    scheduledAt: "2026-09-01T01:00:00.000Z",
  });
  observer.observeIncident({
    faultId: "worker-loss-1",
    incidentId: "operations:incident-9:attempt_state_changed",
    observedAt: "2026-09-01T01:00:05.000Z",
    sourceKind: "durable_event",
    sourceId: "postgres:event-9",
  });
  observer.observeRecovery({
    faultId: "worker-loss-1",
    recoveredAt: "2026-09-01T01:00:45.000Z",
    sourceKind: "durable_event",
    sourceId: "postgres:event-10",
  });

  assert.deepEqual(observer.finalize().primaryEvidence, [
    {
      schemaVersion: 1,
      runId: "fault-primary-proof",
      sequence: 0,
      occurredAt: "2026-09-01T01:00:05.000Z",
      kind: "fault_observed",
      data: {
        faultId: "worker-loss-1",
        faultKind: "worker_loss",
        scheduledAt: "2026-09-01T01:00:00.000Z",
        incidentId: "operations:incident-9:attempt_state_changed",
        sourceKind: "durable_event",
        sourceId: "postgres:event-9",
      },
    },
    {
      schemaVersion: 1,
      runId: "fault-primary-proof",
      sequence: 1,
      occurredAt: "2026-09-01T01:00:45.000Z",
      kind: "fault_recovered",
      data: {
        faultId: "worker-loss-1",
        faultKind: "worker_loss",
        scheduledAt: "2026-09-01T01:00:00.000Z",
        incidentId: "operations:incident-9:attempt_state_changed",
        sourceKind: "durable_event",
        sourceId: "postgres:event-10",
      },
    },
  ]);
});
