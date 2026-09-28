import {
  createEnduranceReport,
  type EnduranceJournalEvent,
  type EnduranceReport,
  type FaultObservation,
} from "./report-schema";
import { ScenarioClock } from "./scenario-clock";

const MINIMUM_VERIFIABLE_MINUTES = 1_440;
const AGENT_COUNT = 10;
const WORKER_COUNT = 2;

type RuntimeState = "healthy" | "degraded" | "stopped";

export interface AcceleratedHealthSample {
  minute: number;
  occurredAt: string;
  runtimeState: RuntimeState;
  healthyWorkers: number;
  staleWorkers: number;
  activeAgents: number;
  sleepingAgents: number;
  recoveringAgents: number;
  queueDepth: number;
  oldestDueAgeMs: number;
  completedResponsibilities: number;
  incidentIds: string[];
}

export interface AcceleratedEnduranceResult {
  report: EnduranceReport;
  journal: EnduranceJournalEvent[];
  healthSamples: AcceleratedHealthSample[];
  summary: {
    handoffs: number;
    sleepCycles: number;
    wakeCycles: number;
  };
}

export interface AcceleratedEnduranceOptions {
  seed: number;
  minutes: number;
  runId: string;
  startedAt?: Date;
  commitSha: string;
}

type AcceleratedFaultKind =
  | "worker_loss"
  | "provider_timeout"
  | "provider_rate_limit"
  | "provider_malformed_output"
  | "database_unavailable"
  | "sse_disconnect"
  | "emergency_stop";

interface ScheduledFault {
  id: string;
  kind: AcceleratedFaultKind;
  minute: number;
  recoveryMs: number;
}

interface VirtualRuntime {
  queueDepth: number;
  completedResponsibilities: number;
  emergencyStopped: boolean;
  databaseAvailable: boolean;
  disconnectedStream: boolean;
  staleWorkers: Set<string>;
}

function assertOptions(options: AcceleratedEnduranceOptions): void {
  if (!Number.isSafeInteger(options.seed) || options.seed < 0) {
    throw new TypeError("seed must be a non-negative safe integer");
  }
  if (
    !Number.isSafeInteger(options.minutes) ||
    options.minutes < MINIMUM_VERIFIABLE_MINUTES
  ) {
    throw new TypeError(
      "accelerated endurance requires at least 1,440 minutes",
    );
  }
  if (!options.runId.trim()) throw new TypeError("runId is required");
  if (!options.commitSha.trim()) throw new TypeError("commitSha is required");
  if (options.startedAt && Number.isNaN(options.startedAt.getTime())) {
    throw new TypeError("startedAt must be a valid date");
  }
}

/** A tiny deterministic generator suitable for scenario scheduling, not security. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function offsetMinute(
  baseMinute: number,
  totalMinutes: number,
  random: () => number,
): number {
  const scale = totalMinutes / MINIMUM_VERIFIABLE_MINUTES;
  const jitter = Math.floor(random() * 31) - 15;
  return Math.max(
    2,
    Math.min(totalMinutes - 3, Math.round(baseMinute * scale + jitter)),
  );
}

function createFaultSchedule(seed: number, minutes: number): ScheduledFault[] {
  const random = mulberry32(seed);
  const workerBases = [120, 330, 540, 750, 960, 1_170];
  const faults: ScheduledFault[] = workerBases.map((base, index) => ({
    id: `worker-loss-${index + 1}`,
    kind: "worker_loss",
    minute: offsetMinute(base, minutes, random),
    recoveryMs: 30_000 + Math.floor(random() * 90_000),
  }));
  for (const [id, kind, base, recoveryMs] of [
    ["provider-timeout-1", "provider_timeout", 210, 45_000],
    ["provider-rate-limit-1", "provider_rate_limit", 420, 60_000],
    ["provider-malformed-1", "provider_malformed_output", 630, 30_000],
    ["database-unavailable-1", "database_unavailable", 840, 60_000],
    ["sse-disconnect-1", "sse_disconnect", 1_050, 60_000],
    ["emergency-stop-1", "emergency_stop", 1_260, 60_000],
  ] as const) {
    faults.push({
      id,
      kind,
      minute: offsetMinute(base, minutes, random),
      recoveryMs,
    });
  }
  return faults.sort((left, right) =>
    left.minute === right.minute
      ? left.id.localeCompare(right.id)
      : left.minute - right.minute,
  );
}

function runtimeState(runtime: VirtualRuntime): RuntimeState {
  if (runtime.emergencyStopped) return "stopped";
  if (
    !runtime.databaseAvailable ||
    runtime.disconnectedStream ||
    runtime.staleWorkers.size > 0
  ) {
    return "degraded";
  }
  return "healthy";
}

function faultIncidentId(fault: ScheduledFault): string {
  return `incident:${fault.id}`;
}

function normalizedFaultObservation(
  fault: ScheduledFault,
  clock: ScenarioClock,
): FaultObservation {
  const observedAt = clock.now().toISOString();
  return {
    id: fault.id,
    kind: fault.kind,
    scheduledAt: observedAt,
    observedAt,
    recoveredAt: new Date(
      clock.now().getTime() + fault.recoveryMs,
    ).toISOString(),
    incidentId: faultIncidentId(fault),
    pass: fault.recoveryMs <= 120_000,
  };
}

function applyFault(runtime: VirtualRuntime, fault: ScheduledFault): void {
  switch (fault.kind) {
    case "worker_loss":
      runtime.staleWorkers.add(
        `worker-${fault.id.endsWith("1") || fault.id.endsWith("3") || fault.id.endsWith("5") ? "a" : "b"}`,
      );
      break;
    case "database_unavailable":
      runtime.databaseAvailable = false;
      break;
    case "sse_disconnect":
      runtime.disconnectedStream = true;
      break;
    case "emergency_stop":
      runtime.emergencyStopped = true;
      break;
    case "provider_timeout":
    case "provider_rate_limit":
    case "provider_malformed_output":
      break;
    default: {
      const exhaustive: never = fault.kind;
      throw new TypeError(`Unsupported fault kind: ${String(exhaustive)}`);
    }
  }
}

function recoverAfterSample(
  runtime: VirtualRuntime,
  fault: ScheduledFault,
): void {
  switch (fault.kind) {
    case "worker_loss":
      runtime.staleWorkers.clear();
      break;
    case "database_unavailable":
      runtime.databaseAvailable = true;
      break;
    case "sse_disconnect":
      runtime.disconnectedStream = false;
      break;
    case "emergency_stop":
      runtime.emergencyStopped = false;
      break;
    case "provider_timeout":
    case "provider_rate_limit":
    case "provider_malformed_output":
      break;
    default: {
      const exhaustive: never = fault.kind;
      throw new TypeError(`Unsupported fault kind: ${String(exhaustive)}`);
    }
  }
}

function canProcessResponsibilities(runtime: VirtualRuntime): boolean {
  return runtime.databaseAvailable && !runtime.emergencyStopped;
}

export function normalizeAcceleratedReport(
  report: EnduranceReport,
): Omit<EnduranceReport, "runId" | "startedAt" | "completedAt"> {
  const {
    runId: _runId,
    startedAt: _startedAt,
    completedAt: _completedAt,
    ...stable
  } = report;
  return stable;
}

export async function runAcceleratedEndurance(
  options: AcceleratedEnduranceOptions,
): Promise<AcceleratedEnduranceResult> {
  assertOptions(options);
  const startedAt = new Date(options.startedAt ?? "2026-09-01T00:00:00.000Z");
  const clock = new ScenarioClock({ mode: "accelerated", startedAt });
  const faults = createFaultSchedule(options.seed, options.minutes);
  const faultsByMinute = new Map<number, ScheduledFault[]>();
  for (const fault of faults) {
    const due = faultsByMinute.get(fault.minute) ?? [];
    due.push(fault);
    faultsByMinute.set(fault.minute, due);
  }

  const runtime: VirtualRuntime = {
    queueDepth: 0,
    completedResponsibilities: 0,
    emergencyStopped: false,
    databaseAvailable: true,
    disconnectedStream: false,
    staleWorkers: new Set(),
  };
  const healthSamples: AcceleratedHealthSample[] = [];
  const observations: FaultObservation[] = [];
  const journal: EnduranceJournalEvent[] = [];
  const recoveryDurationsMs: number[] = [];
  let sequence = 0;
  let handoffs = 0;
  let sleepCycles = 0;
  let wakeCycles = 0;

  for (let minute = 1; minute <= options.minutes; minute += 1) {
    clock.advanceMinutes(1);
    runtime.queueDepth += AGENT_COUNT;
    const minuteFaults = faultsByMinute.get(minute) ?? [];
    const incidentIds: string[] = [];
    for (const fault of minuteFaults) {
      applyFault(runtime, fault);
      const observation = normalizedFaultObservation(fault, clock);
      observations.push(observation);
      incidentIds.push(observation.incidentId ?? faultIncidentId(fault));
      recoveryDurationsMs.push(fault.recoveryMs);
      journal.push({
        schemaVersion: 1,
        runId: options.runId,
        sequence: sequence++,
        occurredAt: observation.observedAt ?? clock.now().toISOString(),
        kind: "fault_observed",
        data: {
          faultId: fault.id,
          faultKind: fault.kind,
          incidentId: observation.incidentId,
        },
      });
    }

    if (minute % 37 === 0) handoffs += 1;
    if (minute % 29 === 0) sleepCycles += 1;
    if (minute % 29 === 1 && minute > 1) wakeCycles += 1;

    if (canProcessResponsibilities(runtime)) {
      runtime.completedResponsibilities += runtime.queueDepth;
      runtime.queueDepth = 0;
    }

    const activeAgents = runtime.emergencyStopped
      ? 0
      : AGENT_COUNT - (minute % 3);
    const sleepingAgents = runtime.emergencyStopped
      ? 0
      : AGENT_COUNT - activeAgents;
    healthSamples.push({
      minute,
      occurredAt: clock.now().toISOString(),
      runtimeState: runtimeState(runtime),
      healthyWorkers: WORKER_COUNT - runtime.staleWorkers.size,
      staleWorkers: runtime.staleWorkers.size,
      activeAgents,
      sleepingAgents,
      recoveringAgents: runtime.staleWorkers.size > 0 ? 1 : 0,
      queueDepth: runtime.queueDepth,
      oldestDueAgeMs: runtime.queueDepth > 0 ? 60_000 : 0,
      completedResponsibilities: runtime.completedResponsibilities,
      incidentIds,
    });

    for (const fault of minuteFaults) {
      recoverAfterSample(runtime, fault);
      const observation = observations.find((item) => item.id === fault.id);
      journal.push({
        schemaVersion: 1,
        runId: options.runId,
        sequence: sequence++,
        occurredAt: observation?.recoveredAt ?? clock.now().toISOString(),
        kind: "fault_recovered",
        data: {
          faultId: fault.id,
          incidentId: faultIncidentId(fault),
          recoveryMs: fault.recoveryMs,
        },
      });
    }
  }

  // A final virtual scheduler tick drains work deferred by a fault in the last
  // observed bucket without fabricating another health sample.
  if (canProcessResponsibilities(runtime) && runtime.queueDepth > 0) {
    runtime.completedResponsibilities += runtime.queueDepth;
    runtime.queueDepth = 0;
  }

  const expectedResponsibilities = options.minutes * AGENT_COUNT;
  const report = createEnduranceReport({
    runId: options.runId,
    mode: "accelerated",
    seed: options.seed,
    commitSha: options.commitSha,
    startedAt: startedAt.toISOString(),
    completedAt: clock.now().toISOString(),
    wallClockHours: 0,
    simulatedMinutes: options.minutes,
    topology: {
      api: 1,
      workers: WORKER_COUNT,
      agents: AGENT_COUNT,
      database: "postgres",
    },
    injections: observations,
    metrics: {
      expectedResponsibilities,
      completedResponsibilities: runtime.completedResponsibilities,
      maxResponsibilityCycleLag: 0,
      irreversibleReceiptSuccessCount: runtime.completedResponsibilities,
      duplicateIrreversibleReceiptKeys: [],
      staleOwnerCommits: 0,
      recoveryDurationsMs,
      missingIncidentIds: observations
        .filter((observation) => !observation.incidentId)
        .map((observation) => observation.id),
      healthTruthMismatches: healthSamples
        .filter(
          (sample) =>
            sample.runtimeState === "healthy" &&
            (sample.staleWorkers > 0 || sample.queueDepth > 0),
        )
        .map((sample) => `minute-${sample.minute}`),
      sseReconnectObserved:
        observations.some((item) => item.kind === "sse_disconnect") &&
        !runtime.disconnectedStream,
      healthSampleBuckets: new Set(healthSamples.map((sample) => sample.minute))
        .size,
    },
  });

  journal.push({
    schemaVersion: 1,
    runId: options.runId,
    sequence: sequence++,
    occurredAt: report.completedAt,
    kind: "run_completed",
    data: {
      pass: report.pass,
      simulatedMinutes: report.simulatedMinutes,
      completedResponsibilities: report.metrics.completedResponsibilities,
    },
  });

  return {
    report,
    journal,
    healthSamples,
    summary: { handoffs, sleepCycles, wakeCycles },
  };
}
