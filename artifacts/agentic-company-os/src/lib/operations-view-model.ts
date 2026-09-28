import type {
  OperationsStreamSnapshot,
  OperationsTransportState,
} from "./operations-event-stream";

export type RuntimeTruthState =
  | "live"
  | "degraded"
  | "stale"
  | "offline"
  | "emergency_stopped"
  | "local_demo";

export type AgentOperationalPresence =
  | "working"
  | "sleeping"
  | "recovering"
  | "blocked"
  | "awaiting_approval"
  | "idle"
  | "offline";

export type AgentLaneState =
  | "working"
  | "awaiting_approval"
  | "recovering"
  | "blocked"
  | "idle"
  | "offline"
  | "unknown";

export type HealthBucketState = "healthy" | "degraded" | "incident" | "unknown";

export interface OperationsHealthSampleInput {
  bucketAt: string;
  sampledAt: string | null;
  runtimeTruthState: RuntimeTruthState | null;
  providerMetricsCoverage: "partial" | "complete";
  healthyWorkerCount: number;
  staleWorkerCount: number;
  schedulerTickAgeMs: number | null;
  dueQueueDepth: number;
  oldestDueAgeMs: number | null;
  activeTaskCount: number;
  sleepingTaskCount: number;
  recoveringTaskCount: number;
  blockedTaskCount: number;
  approvalWaitingTaskCount: number;
  providerSuccessCount: number;
  providerErrorCount: number;
  providerP50LatencyMs: number | null;
  providerP95LatencyMs: number | null;
  recoveryCount: number;
  lostLeaseCount: number;
  taskTokens: number;
  reportedCostUsd: number;
}

export interface OperationsRuntimeInput {
  state: RuntimeTruthState;
  reasons: string[];
  databaseBackend: "postgresql" | "pglite";
  durable: boolean;
  multiProcessCapable: boolean;
  emergencyStopEnabled: boolean;
  healthyWorkerCount: number;
  staleWorkerCount: number;
  schedulerTickAgeMs: number | null;
  lastSampleAt: string | null;
}

export interface OperationsMemberInput {
  agentId: number;
  name: string;
  role: string;
  avatar: { color: string; version: string | null } | string;
  status: string;
  presence: AgentOperationalPresence;
  currentAction: string | null;
  lastActiveAt: string | null;
  activeAttemptId: string | null;
  nextWakeAt: string | null;
}

export interface OperationsTimelineInput {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  occurredAt: string;
  taskId: number | null;
  agentId: number | null;
  attemptId: string | null;
  receiptId: string | null;
}

export interface OperationsAttemptInput {
  id: string;
  taskId: number;
  agentId: number;
  workerInstanceId: string;
  logicalExecutionId: string;
  attemptNumber: number;
  cycleNumber: number;
  state: string;
  startedAt: string;
  lastHeartbeatAt: string;
  finishedAt: string | null;
  provider: string | null;
  modelId: string | null;
  failureKind: string | null;
  recoveryOfAttemptId: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reportedCostUsd: number | null;
}

export interface OperationsInvocationInput {
  id: string;
  state: string;
  attemptId: string | null;
  workerInstanceId: string | null;
  claimedAt: string;
  lastHeartbeatAt: string;
  effectStartedAt: string | null;
  finishedAt: string | null;
  failureKind: string | null;
}

export interface OperationsReceiptInput {
  id: string;
  taskId: number | null;
  agentId: number;
  originAttemptId: string | null;
  executionKind: string;
  sideEffectClass: string;
  state: string;
  toolName: string;
  reservedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failureKind: string | null;
  reconciliation: {
    eligible: boolean;
    decision: "confirmed_applied" | "confirmed_not_applied" | null;
    reconciledAt: string | null;
  };
  invocations: OperationsInvocationInput[];
}

export interface OperationsWindowInput {
  startAt: string;
  endAt: string;
  hours: number;
  timezone: "UTC";
}

export interface ProjectOperationsLimitsInput {
  attempts: number;
  receipts: number;
  invocationsPerReceipt: number;
  incidents: number;
  milestones: number;
  samples: number;
}

export interface ProjectOperationsTruncationInput {
  attempts: boolean;
  receipts: boolean;
  incidents: boolean;
  milestones: boolean;
  fleetHealthSamples: boolean;
}

export interface OperationsSnapshotInput {
  generatedAt: string;
  cursor: string;
  window: OperationsWindowInput;
  runtime: OperationsRuntimeInput;
  queue: {
    dueDepth: number;
    oldestDueAgeMs: number | null;
    nextWakeAt: string | null;
  };
  taskCounts: {
    active: number;
    sleeping: number;
    recovering: number;
    blocked: number;
    awaitingApproval: number;
  };
  members: OperationsMemberInput[];
  attempts: OperationsAttemptInput[];
  receipts: OperationsReceiptInput[];
  incidents: OperationsTimelineInput[];
  milestones: OperationsTimelineInput[];
  usage: {
    taskTokens: number;
    reportedCostUsd: number;
    usageEvents: number;
    costReportedEvents: number;
    providerMetricsCoverage: "partial" | "complete";
  };
  fleetHealthSamples: OperationsHealthSampleInput[];
  limits: ProjectOperationsLimitsInput;
  truncation: ProjectOperationsTruncationInput;
}

export interface OperationsOverviewInput {
  generatedAt: string;
  cursor: string;
  window: OperationsSnapshotInput["window"];
  runtime: OperationsRuntimeInput;
  queue: OperationsSnapshotInput["queue"];
  tasks: OperationsSnapshotInput["taskCounts"];
  operations: {
    reserved: number;
    running: number;
    unresolvedUnknown: number;
  };
  usage: OperationsSnapshotInput["usage"];
  fleetHealthSamples: OperationsHealthSampleInput[];
  truncation?: Pick<ProjectOperationsTruncationInput, "fleetHealthSamples">;
}

export interface HealthRingSegment {
  state: HealthBucketState;
  startAt: string;
  endAt: string;
  startIndex: number;
  endIndex: number;
  durationMinutes: number;
}

export interface TwentyFourHourRing {
  startAt: string;
  endAt: string;
  totalBuckets: 1440;
  counts: Record<HealthBucketState, number>;
  healthyPercent: number;
  complete: boolean;
  verifiedTwentyFourHours: boolean;
  segments: HealthRingSegment[];
}

export interface AgentLaneMember extends OperationsMemberInput {
  laneState: AgentLaneState;
  activeForMs: number | null;
}

export interface AgentLane {
  state: AgentLaneState;
  members: AgentLaneMember[];
}

export interface MissionLogEntry extends OperationsTimelineInput {
  evidenceId: string;
  source: "incident" | "milestone";
}

export interface AttemptEvidenceReceipt {
  receipt: OperationsReceiptInput;
  invocations: OperationsInvocationInput[];
}

export interface AttemptEvidenceChain {
  logicalExecutionId: string;
  attempt: OperationsAttemptInput;
  receipts: AttemptEvidenceReceipt[];
}

export interface OperationsRoomTruth {
  healthyWorkerCount: number;
  live: boolean;
  backendState: RuntimeTruthState;
  transportState: OperationsTransportState;
  transportAgeMs: number | null;
  durableDataAgeMs: number | null;
  reasons: string[];
}

export interface OperationsRoomModel {
  generatedAt: string;
  cursor: string;
  window: OperationsWindowInput;
  limits: ProjectOperationsLimitsInput | null;
  truncation: ProjectOperationsTruncationInput;
  truth: OperationsRoomTruth;
  healthRing: TwentyFourHourRing;
  lanes: AgentLane[];
  missions: MissionLogEntry[];
  queue: OperationsSnapshotInput["queue"];
  taskCounts: OperationsSnapshotInput["taskCounts"];
  operationCounts: OperationsOverviewInput["operations"];
  attempts: OperationsAttemptInput[];
  receipts: OperationsReceiptInput[];
  usage: OperationsSnapshotInput["usage"];
}

const MINUTE_MS = 60_000;
const DAY_BUCKETS = 1_440 as const;

const LANE_STATES: readonly AgentLaneState[] = [
  "working",
  "awaiting_approval",
  "recovering",
  "blocked",
  "idle",
  "offline",
  "unknown",
];

function validDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ageMs(value: string | null, now: Date): number | null {
  const date = validDate(value);
  return date ? Math.max(0, now.getTime() - date.getTime()) : null;
}

function sampleState(
  sampleValue: OperationsHealthSampleInput | undefined,
): HealthBucketState {
  if (!sampleValue || !validDate(sampleValue.sampledAt)) return "unknown";
  if (
    sampleValue.runtimeTruthState === "offline" ||
    sampleValue.runtimeTruthState === "emergency_stopped"
  ) {
    return "incident";
  }
  if (sampleValue.runtimeTruthState === "local_demo") return "unknown";
  if (
    sampleValue.runtimeTruthState === "degraded" ||
    sampleValue.runtimeTruthState === "stale" ||
    sampleValue.staleWorkerCount > 0 ||
    sampleValue.providerErrorCount > 0 ||
    sampleValue.recoveryCount > 0 ||
    sampleValue.lostLeaseCount > 0
  ) {
    return "degraded";
  }
  return sampleValue.runtimeTruthState === "live" ? "healthy" : "unknown";
}

function canonicalMinute(value: string): number | null {
  const parsed = validDate(value);
  return parsed ? Math.floor(parsed.getTime() / MINUTE_MS) * MINUTE_MS : null;
}

export function buildTwentyFourHourRing(
  samples: OperationsHealthSampleInput[],
  endAt: Date,
): TwentyFourHourRing {
  const endMs = Math.floor(endAt.getTime() / MINUTE_MS) * MINUTE_MS;
  const startMs = endMs - DAY_BUCKETS * MINUTE_MS;
  const samplesByBucket = new Map<number, OperationsHealthSampleInput>();
  for (const item of samples) {
    const bucket = canonicalMinute(item.bucketAt);
    if (bucket !== null && bucket >= startMs && bucket < endMs) {
      samplesByBucket.set(bucket, item);
    }
  }

  const counts: Record<HealthBucketState, number> = {
    healthy: 0,
    degraded: 0,
    incident: 0,
    unknown: 0,
  };
  const segments: HealthRingSegment[] = [];

  for (let index = 0; index < DAY_BUCKETS; index += 1) {
    const bucketMs = startMs + index * MINUTE_MS;
    const state = sampleState(samplesByBucket.get(bucketMs));
    counts[state] += 1;
    const previousSegment = segments.at(-1);
    if (previousSegment?.state === state) {
      previousSegment.endAt = new Date(bucketMs + MINUTE_MS).toISOString();
      previousSegment.endIndex = index;
      previousSegment.durationMinutes += 1;
      continue;
    }
    segments.push({
      state,
      startAt: new Date(bucketMs).toISOString(),
      endAt: new Date(bucketMs + MINUTE_MS).toISOString(),
      startIndex: index,
      endIndex: index,
      durationMinutes: 1,
    });
  }

  const knownBuckets = DAY_BUCKETS - counts.unknown;
  return {
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    totalBuckets: DAY_BUCKETS,
    counts,
    healthyPercent: (counts.healthy / DAY_BUCKETS) * 100,
    complete: knownBuckets === DAY_BUCKETS,
    verifiedTwentyFourHours: counts.healthy === DAY_BUCKETS,
    segments,
  };
}

function laneState(presence: string): AgentLaneState {
  if (presence === "sleeping") return "idle";
  return LANE_STATES.includes(presence as AgentLaneState)
    ? (presence as AgentLaneState)
    : "unknown";
}

export function groupAgentLanes(
  members: OperationsMemberInput[],
  now: Date,
): AgentLane[] {
  const lanes = LANE_STATES.map((state) => ({
    state,
    members: [] as AgentLaneMember[],
  }));
  const laneByState = new Map(lanes.map((lane) => [lane.state, lane]));

  for (const member of members) {
    const state = laneState(member.presence);
    laneByState.get(state)?.members.push({
      ...member,
      laneState: state,
      activeForMs: ageMs(member.lastActiveAt, now),
    });
  }

  for (const lane of lanes) {
    lane.members.sort((left, right) => {
      const activityDifference =
        (left.activeForMs ?? Number.POSITIVE_INFINITY) -
        (right.activeForMs ?? Number.POSITIVE_INFINITY);
      return activityDifference || left.name.localeCompare(right.name, "tr");
    });
  }
  return lanes;
}

export function buildMissionLog(
  incidents: OperationsTimelineInput[],
  milestones: OperationsTimelineInput[],
): MissionLogEntry[] {
  const evidence = new Map<string, MissionLogEntry>();
  for (const [source, entries] of [
    ["incident", incidents],
    ["milestone", milestones],
  ] as const) {
    for (const entry of entries) {
      if (!entry.id.trim() || !validDate(entry.occurredAt)) continue;
      if (!evidence.has(entry.id)) {
        evidence.set(entry.id, {
          ...entry,
          evidenceId: entry.id,
          source,
        });
      }
    }
  }
  return [...evidence.values()].sort((left, right) => {
    const timeDifference =
      new Date(right.occurredAt).getTime() -
      new Date(left.occurredAt).getTime();
    return timeDifference || left.evidenceId.localeCompare(right.evidenceId);
  });
}

function buildTruth(
  runtime: OperationsRuntimeInput,
  stream: OperationsStreamSnapshot,
  now: Date,
): OperationsRoomTruth {
  const transportAgeMs = ageMs(stream.transportLastFrameAt, now);
  const durableDataAgeMs = ageMs(stream.lastEventAt, now);
  return {
    live:
      stream.state === "live" && runtime.state === "live" && runtime.durable,
    healthyWorkerCount: runtime.healthyWorkerCount,
    backendState: runtime.state,
    transportState: stream.state,
    transportAgeMs,
    durableDataAgeMs,
    reasons: runtime.reasons,
  };
}

export function buildOperationsRoomModel(
  snapshot: OperationsSnapshotInput,
  options: { now: Date; stream: OperationsStreamSnapshot },
): OperationsRoomModel {
  const endAt = validDate(snapshot.window.endAt) ?? options.now;
  return {
    generatedAt: snapshot.generatedAt,
    cursor: snapshot.cursor,
    window: snapshot.window,
    limits: snapshot.limits,
    truncation: snapshot.truncation,
    truth: buildTruth(snapshot.runtime, options.stream, options.now),
    healthRing: buildTwentyFourHourRing(snapshot.fleetHealthSamples, endAt),
    lanes: groupAgentLanes(snapshot.members, options.now),
    missions: buildMissionLog(snapshot.incidents, snapshot.milestones),
    queue: snapshot.queue,
    taskCounts: snapshot.taskCounts,
    operationCounts: {
      reserved: snapshot.receipts.filter(
        (receipt) => receipt.state === "reserved",
      ).length,
      running: snapshot.receipts.filter(
        (receipt) => receipt.state === "running",
      ).length,
      unresolvedUnknown: snapshot.receipts.filter(
        (receipt) =>
          receipt.state === "unknown" &&
          receipt.reconciliation.decision === null,
      ).length,
    },
    attempts: snapshot.attempts,
    receipts: snapshot.receipts,
    usage: snapshot.usage,
  };
}

export function buildFleetOperationsModel(
  snapshot: OperationsOverviewInput,
  options: { now: Date; stream: OperationsStreamSnapshot },
): OperationsRoomModel {
  const endAt = validDate(snapshot.window.endAt) ?? options.now;
  return {
    generatedAt: snapshot.generatedAt,
    cursor: snapshot.cursor,
    window: snapshot.window,
    limits: null,
    truncation: {
      attempts: false,
      receipts: false,
      incidents: false,
      milestones: false,
      fleetHealthSamples: snapshot.truncation?.fleetHealthSamples ?? false,
    },
    truth: buildTruth(snapshot.runtime, options.stream, options.now),
    healthRing: buildTwentyFourHourRing(snapshot.fleetHealthSamples, endAt),
    lanes: groupAgentLanes([], options.now),
    missions: [],
    queue: snapshot.queue,
    taskCounts: snapshot.tasks,
    operationCounts: snapshot.operations,
    attempts: [],
    receipts: [],
    usage: snapshot.usage,
  };
}

export function buildAttemptEvidenceChain(
  attempt: OperationsAttemptInput,
  receipts: OperationsReceiptInput[],
): AttemptEvidenceChain {
  const evidenceReceipts = receipts.flatMap((receipt) => {
    const receiptBelongsToAttempt = receipt.originAttemptId === attempt.id;
    const invocations = receipt.invocations.filter(
      (invocation) =>
        invocation.attemptId === attempt.id ||
        (invocation.attemptId === null && receiptBelongsToAttempt),
    );
    if (!receiptBelongsToAttempt && invocations.length === 0) return [];
    return [{ receipt, invocations }];
  });

  return {
    logicalExecutionId: attempt.logicalExecutionId,
    attempt,
    receipts: evidenceReceipts,
  };
}
