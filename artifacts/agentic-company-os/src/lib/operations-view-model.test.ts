import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFleetOperationsModel,
  buildAttemptEvidenceChain,
  buildMissionLog,
  buildOperationsRoomModel,
  buildTwentyFourHourRing,
  groupAgentLanes,
  type OperationsSnapshotInput,
} from "./operations-view-model";

const NOW = new Date("2026-09-01T12:00:00.000Z");

function sample(
  bucketAt: string,
  state: "live" | "degraded" | "offline" | null = "live",
) {
  return {
    bucketAt,
    sampledAt: bucketAt,
    runtimeTruthState: state,
    providerMetricsCoverage: "partial" as const,
    healthyWorkerCount: state === "live" ? 2 : 0,
    staleWorkerCount: state === "degraded" ? 1 : 0,
    schedulerTickAgeMs: 500,
    dueQueueDepth: 0,
    oldestDueAgeMs: null,
    activeTaskCount: 1,
    sleepingTaskCount: 0,
    recoveringTaskCount: 0,
    blockedTaskCount: 0,
    approvalWaitingTaskCount: 0,
    providerSuccessCount: 1,
    providerErrorCount: 0,
    providerP50LatencyMs: null,
    providerP95LatencyMs: null,
    recoveryCount: 0,
    lostLeaseCount: 0,
    taskTokens: 10,
    reportedCostUsd: 0,
  };
}

function baseSnapshot(
  overrides: Partial<OperationsSnapshotInput> = {},
): OperationsSnapshotInput {
  return {
    generatedAt: "2026-09-01T11:58:00.000Z",
    cursor: "9007199254740993",
    window: {
      startAt: "2026-08-31T12:00:00.000Z",
      endAt: NOW.toISOString(),
      hours: 24,
      timezone: "UTC",
    },
    runtime: {
      state: "live",
      reasons: [],
      databaseBackend: "postgresql",
      durable: true,
      multiProcessCapable: true,
      emergencyStopEnabled: false,
      healthyWorkerCount: 2,
      staleWorkerCount: 0,
      schedulerTickAgeMs: 500,
      lastSampleAt: "2026-09-01T11:59:00.000Z",
    },
    queue: { dueDepth: 0, oldestDueAgeMs: null, nextWakeAt: null },
    taskCounts: {
      active: 1,
      sleeping: 0,
      recovering: 0,
      blocked: 0,
      awaitingApproval: 0,
    },
    members: [],
    attempts: [],
    receipts: [],
    incidents: [],
    milestones: [],
    usage: {
      taskTokens: 0,
      reportedCostUsd: 0,
      usageEvents: 0,
      costReportedEvents: 0,
      providerMetricsCoverage: "partial",
    },
    fleetHealthSamples: [],
    limits: {
      attempts: 200,
      receipts: 200,
      invocationsPerReceipt: 5,
      incidents: 100,
      milestones: 100,
      samples: 1_440,
    },
    truncation: {
      attempts: false,
      receipts: false,
      incidents: false,
      milestones: false,
      fleetHealthSamples: false,
    },
    ...overrides,
  };
}

test("24-hour ring keeps all 1,440 buckets and never paints sparse gaps healthy", () => {
  const ring = buildTwentyFourHourRing(
    [
      sample("2026-09-01T11:57:00.000Z"),
      sample("2026-09-01T11:58:00.000Z", "degraded"),
      sample("2026-09-01T11:59:00.000Z", "offline"),
    ],
    NOW,
  );

  assert.equal(ring.totalBuckets, 1_440);
  assert.equal(ring.counts.healthy, 1);
  assert.equal(ring.counts.degraded, 1);
  assert.equal(ring.counts.incident, 1);
  assert.equal(ring.counts.unknown, 1_437);
  assert.equal(ring.complete, false);
  assert.equal(ring.verifiedTwentyFourHours, false);
  assert.deepEqual(
    ring.segments.slice(-4).map((segment) => segment.state),
    ["unknown", "healthy", "degraded", "incident"],
  );
});

test("only a complete persisted healthy window earns the 24-hour claim", () => {
  const samples = Array.from({ length: 1_440 }, (_, index) => {
    const bucket = new Date(NOW.getTime() - (1_440 - index) * 60_000);
    return sample(bucket.toISOString());
  });
  const ring = buildTwentyFourHourRing(samples, NOW);

  assert.equal(ring.complete, true);
  assert.equal(ring.verifiedTwentyFourHours, true);
  assert.equal(ring.segments.length, 1);
  assert.equal(ring.segments[0]?.durationMinutes, 1_440);
});

test("transport freshness and persisted runtime truth remain separate", () => {
  const model = buildOperationsRoomModel(baseSnapshot(), {
    now: NOW,
    stream: {
      state: "disconnected",
      transportLastFrameAt: "2026-09-01T11:59:32.000Z",
      lastEventId: "9007199254740993",
      lastEventAt: "2026-09-01T11:58:00.000Z",
      reconnectCount: 2,
    },
  });

  assert.equal(model.truth.live, false);
  assert.equal(model.truth.transportState, "disconnected");
  assert.equal(model.truth.durableDataAgeMs, 120_000);
  assert.equal(model.truth.transportAgeMs, 28_000);
  assert.equal(model.cursor, "9007199254740993");
});

test("project model preserves the exact evidence window, limits and truncation contract", () => {
  const model = buildOperationsRoomModel(
    baseSnapshot({
      window: {
        startAt: "2026-08-31T12:00:00.000Z",
        endAt: NOW.toISOString(),
        hours: 24,
        timezone: "UTC",
      },
      limits: {
        attempts: 200,
        receipts: 200,
        invocationsPerReceipt: 5,
        incidents: 100,
        milestones: 100,
        samples: 1_440,
      },
      truncation: {
        attempts: true,
        receipts: false,
        incidents: true,
        milestones: false,
        fleetHealthSamples: true,
      },
    }),
    {
      now: NOW,
      stream: {
        state: "live",
        transportLastFrameAt: NOW.toISOString(),
        lastEventId: "9007199254740993",
        lastEventAt: NOW.toISOString(),
        reconnectCount: 0,
      },
    },
  );

  assert.deepEqual(model.window, {
    startAt: "2026-08-31T12:00:00.000Z",
    endAt: NOW.toISOString(),
    hours: 24,
    timezone: "UTC",
  });
  assert.equal(model.limits?.attempts, 200);
  assert.equal(model.limits?.samples, 1_440);
  assert.deepEqual(model.truncation, {
    attempts: true,
    receipts: false,
    incidents: true,
    milestones: false,
    fleetHealthSamples: true,
  });
});

test("attempt evidence chain excludes invocations belonging to another durable attempt", () => {
  const attempt = {
    id: "attempt-selected",
    taskId: 7,
    agentId: 2,
    workerInstanceId: "worker-a",
    logicalExecutionId: "logical-selected",
    attemptNumber: 2,
    cycleNumber: 3,
    state: "lost",
    startedAt: "2026-09-01T11:58:00.000Z",
    lastHeartbeatAt: "2026-09-01T11:58:01.000Z",
    finishedAt: "2026-09-01T11:58:02.000Z",
    provider: "openrouter",
    modelId: "model-a",
    failureKind: "worker_lost_after_effect",
    recoveryOfAttemptId: null,
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    reportedCostUsd: 0.02,
  };
  const receipt = {
    id: "receipt-selected",
    taskId: 7,
    agentId: 2,
    originAttemptId: attempt.id,
    executionKind: "task_step",
    sideEffectClass: "at_most_once",
    state: "unknown",
    toolName: "browser_click",
    reservedAt: "2026-09-01T11:58:00.000Z",
    startedAt: "2026-09-01T11:58:01.000Z",
    finishedAt: "2026-09-01T11:58:02.000Z",
    failureKind: "worker_lost_after_effect",
    reconciliation: {
      eligible: true,
      decision: null,
      reconciledAt: null,
    },
    invocations: [
      {
        id: "invocation-selected",
        state: "unknown",
        attemptId: attempt.id,
        workerInstanceId: "worker-a",
        claimedAt: "2026-09-01T11:58:00.000Z",
        lastHeartbeatAt: "2026-09-01T11:58:01.000Z",
        effectStartedAt: "2026-09-01T11:58:01.000Z",
        finishedAt: "2026-09-01T11:58:02.000Z",
        failureKind: "worker_lost_after_effect",
      },
      {
        id: "invocation-other",
        state: "succeeded",
        attemptId: "attempt-other",
        workerInstanceId: "worker-b",
        claimedAt: "2026-09-01T11:59:00.000Z",
        lastHeartbeatAt: "2026-09-01T11:59:01.000Z",
        effectStartedAt: "2026-09-01T11:59:01.000Z",
        finishedAt: "2026-09-01T11:59:02.000Z",
        failureKind: null,
      },
    ],
  };

  const chain = buildAttemptEvidenceChain(attempt, [receipt]);

  assert.equal(chain.logicalExecutionId, "logical-selected");
  assert.deepEqual(
    chain.receipts.map((entry) => entry.receipt.id),
    ["receipt-selected"],
  );
  assert.deepEqual(
    chain.receipts.flatMap((entry) =>
      entry.invocations.map((invocation) => invocation.id),
    ),
    ["invocation-selected"],
  );
});

test("local demo never masquerades as a durable live fleet", () => {
  const input = baseSnapshot({
    runtime: {
      ...baseSnapshot().runtime,
      state: "local_demo",
      databaseBackend: "pglite",
      durable: false,
      multiProcessCapable: false,
      healthyWorkerCount: 0,
      reasons: ["scheduler_disabled"],
    },
  });
  const model = buildOperationsRoomModel(input, {
    now: NOW,
    stream: {
      state: "connecting",
      transportLastFrameAt: null,
      lastEventId: null,
      lastEventAt: null,
      reconnectCount: 0,
    },
  });

  assert.equal(model.truth.live, false);
  assert.equal(model.truth.backendState, "local_demo");
});

test("agent lanes use operational presence and deterministic action order", () => {
  const members = [
    {
      agentId: 4,
      name: "Ada",
      role: "Araştırma",
      avatar: "avatar-4",
      status: "idle",
      presence: "idle" as const,
      currentAction: null,
      lastActiveAt: "2026-09-01T11:50:00.000Z",
      activeAttemptId: null,
      nextWakeAt: null,
    },
    {
      agentId: 2,
      name: "Mina",
      role: "Operasyon",
      avatar: "avatar-2",
      status: "working",
      presence: "working" as const,
      currentAction: "Kaynakları doğruluyor",
      lastActiveAt: "2026-09-01T11:59:58.000Z",
      activeAttemptId: "attempt-2",
      nextWakeAt: null,
    },
    {
      agentId: 3,
      name: "Can",
      role: "Finans",
      avatar: "avatar-3",
      status: "working",
      presence: "awaiting_approval" as const,
      currentAction: "Onay bekliyor",
      lastActiveAt: "2026-09-01T11:59:00.000Z",
      activeAttemptId: "attempt-3",
      nextWakeAt: null,
    },
  ];
  const lanes = groupAgentLanes(members, NOW);

  assert.deepEqual(
    lanes.filter((lane) => lane.members.length).map((lane) => lane.state),
    ["working", "awaiting_approval", "idle"],
  );
  assert.equal(lanes[0]?.members[0]?.activeForMs, 2_000);
  assert.equal(lanes[0]?.members[0]?.currentAction, "Kaynakları doğruluyor");
});

test("mission log includes only durable evidence and resolves duplicate rows", () => {
  const log = buildMissionLog(
    [
      {
        id: "event-2",
        kind: "worker_recovered",
        severity: "warning",
        occurredAt: "2026-09-01T11:59:00.000Z",
        taskId: 1,
        agentId: 2,
        attemptId: "attempt-2",
        receiptId: null,
      },
      {
        id: "",
        kind: "synthetic_confetti",
        severity: "info",
        occurredAt: "2026-09-01T12:00:00.000Z",
        taskId: 1,
        agentId: null,
        attemptId: null,
        receiptId: null,
      },
    ],
    [
      {
        id: "event-1",
        kind: "handoff_completed",
        severity: "info",
        occurredAt: "2026-09-01T11:58:00.000Z",
        taskId: 1,
        agentId: 3,
        attemptId: "attempt-1",
        receiptId: "receipt-1",
      },
      {
        id: "event-2",
        kind: "duplicate",
        severity: "critical",
        occurredAt: "2026-09-01T11:57:00.000Z",
        taskId: 1,
        agentId: null,
        attemptId: null,
        receiptId: null,
      },
    ],
  );

  assert.deepEqual(
    log.map((entry) => entry.evidenceId),
    ["event-2", "event-1"],
  );
  assert.equal(
    log.every((entry) => entry.evidenceId.length > 0),
    true,
  );
  assert.equal(log[0]?.kind, "worker_recovered");
});

test("fleet overview keeps server operation counts and cannot inherit project members", () => {
  const model = buildFleetOperationsModel(
    {
      generatedAt: NOW.toISOString(),
      cursor: "88",
      window: {
        startAt: "2026-08-31T12:00:00.000Z",
        endAt: NOW.toISOString(),
        hours: 24,
        timezone: "UTC",
      },
      runtime: baseSnapshot().runtime,
      queue: { dueDepth: 2, oldestDueAgeMs: 30_000, nextWakeAt: null },
      tasks: {
        active: 8,
        sleeping: 4,
        recovering: 1,
        blocked: 2,
        awaitingApproval: 1,
      },
      operations: { reserved: 3, running: 2, unresolvedUnknown: 1 },
      usage: baseSnapshot().usage,
      fleetHealthSamples: [],
    },
    {
      now: NOW,
      stream: {
        state: "live",
        transportLastFrameAt: NOW.toISOString(),
        lastEventId: "70",
        lastEventAt: NOW.toISOString(),
        reconnectCount: 0,
      },
    },
  );

  assert.deepEqual(model.taskCounts, {
    active: 8,
    sleeping: 4,
    recovering: 1,
    blocked: 2,
    awaitingApproval: 1,
  });
  assert.deepEqual(model.operationCounts, {
    reserved: 3,
    running: 2,
    unresolvedUnknown: 1,
  });
  assert.equal(model.cursor, "88");
  assert.equal(
    model.lanes.every((lane) => lane.members.length === 0),
    true,
  );
  assert.equal(model.truth.live, true);
});
