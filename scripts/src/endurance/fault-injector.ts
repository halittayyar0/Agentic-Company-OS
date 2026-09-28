export type InjectedFaultKind =
  | "worker_loss"
  | "provider_timeout"
  | "provider_rate_limit"
  | "provider_malformed_output"
  | "database_unavailable"
  | "sse_disconnect"
  | "emergency_stop";

export interface ScheduledInjectedFault {
  id: string;
  kind: InjectedFaultKind;
  atMs: number;
  durationMs: number;
  targetIndex: number;
}

export interface FaultInjectionControls {
  listActiveWorkers(): Promise<readonly ("worker-1" | "worker-2")[]>;
  killWorker(worker: "worker-1" | "worker-2"): Promise<void>;
  restartWorker(worker: "worker-1" | "worker-2"): Promise<void>;
  setProviderFault(kind: InjectedFaultKind, faultId: string): Promise<void>;
  clearProviderFault(faultId: string): Promise<void>;
  pauseDatabase(): Promise<void>;
  resumeDatabase(): Promise<void>;
  disconnectObserverStream(): Promise<void>;
  reconnectObserverStream(): Promise<void>;
  enableEmergencyStop(): Promise<void>;
  disableEmergencyStop(): Promise<void>;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export interface ExecutedFault {
  faultId: string;
  kind: InjectedFaultKind;
  target: string | null;
}

export type FaultScheduleProfile = "standard" | "compressed-all";

const SHORT_RUN_RECOVERY_GAP_MS = 5_000;
const SHORT_RUN_WORKER_LOSS_MS = 8_000;

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

function boundedAt(
  fraction: number,
  durationMs: number,
  random: () => number,
): number {
  const jitterWindow = Math.min(durationMs * 0.02, 5 * 60_000);
  const jitter = (random() * 2 - 1) * jitterWindow;
  return Math.max(
    1_000,
    Math.min(durationMs - 1_000, Math.round(durationMs * fraction + jitter)),
  );
}

export function createSeededFaultSchedule(input: {
  seed: number;
  durationMs: number;
  profile?: FaultScheduleProfile;
}): ScheduledInjectedFault[] {
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new TypeError("seed must be a non-negative safe integer");
  }
  if (!Number.isFinite(input.durationMs) || input.durationMs < 60_000) {
    throw new TypeError("durationMs must be at least one minute");
  }
  const profile = input.profile ?? "standard";
  if (profile !== "standard" && profile !== "compressed-all") {
    throw new TypeError("fault schedule profile is invalid");
  }
  if (profile === "compressed-all" && input.durationMs < 2 * 60_000) {
    throw new TypeError(
      "compressed-all fault profile requires a two-minute horizon",
    );
  }
  const random = mulberry32(input.seed);
  const compressedAll = profile === "compressed-all";
  const longRun = !compressedAll && input.durationMs >= 24 * 60 * 60 * 1_000;
  const schedule: ScheduledInjectedFault[] = [];
  const workerFractions = compressedAll
    ? [0.05]
    : longRun
      ? [1 / 7, 2 / 7, 3 / 7, 4 / 7, 5 / 7, 6 / 7]
      : [0.18];
  workerFractions.forEach((fraction, index) => {
    schedule.push({
      id: `worker-loss-${index + 1}`,
      kind: "worker_loss",
      atMs: boundedAt(fraction, input.durationMs, random),
      // Short validation runs must isolate each recovery before the next fault.
      // Preserve the wider, seeded outage distribution for the 24-hour run.
      durationMs: compressedAll
        ? 4_000
        : longRun
          ? 30_000 + Math.floor(random() * 75_000)
          : SHORT_RUN_WORKER_LOSS_MS,
      targetIndex: Math.floor(random() * 2),
    });
  });

  const supportingFaults: Array<{
    id: string;
    kind: InjectedFaultKind;
    fraction: number;
    durationMs: number;
  }> = compressedAll
    ? [
        {
          id: "provider-timeout-1",
          kind: "provider_timeout",
          fraction: 0.2,
          durationMs: 4_000,
        },
        {
          id: "provider-rate-limit-1",
          kind: "provider_rate_limit",
          fraction: 0.35,
          durationMs: 4_000,
        },
        {
          id: "provider-malformed-1",
          kind: "provider_malformed_output",
          fraction: 0.5,
          durationMs: 4_000,
        },
        {
          id: "database-unavailable-1",
          kind: "database_unavailable",
          fraction: 0.65,
          durationMs: 6_000,
        },
        {
          id: "sse-disconnect-1",
          kind: "sse_disconnect",
          fraction: 0.8,
          durationMs: 4_000,
        },
        {
          id: "emergency-stop-1",
          kind: "emergency_stop",
          fraction: 0.93,
          durationMs: 4_000,
        },
      ]
    : longRun
      ? [
          {
            id: "provider-timeout-1",
            kind: "provider_timeout",
            fraction: 0.19,
            // Span every possible phase of the production 60-second cadence,
            // while leaving recovery inside the 120-second verifier SLO.
            durationMs: 75_000,
          },
          {
            id: "provider-rate-limit-1",
            kind: "provider_rate_limit",
            fraction: 0.36,
            durationMs: 75_000,
          },
          {
            id: "provider-malformed-1",
            kind: "provider_malformed_output",
            fraction: 0.52,
            durationMs: 75_000,
          },
          {
            id: "database-unavailable-1",
            kind: "database_unavailable",
            fraction: 0.64,
            // Span a 60-second sampler tick while preserving the 120-second
            // recovery objective used by the wall-clock verifier.
            durationMs: 75_000,
          },
          {
            id: "sse-disconnect-1",
            kind: "sse_disconnect",
            fraction: 0.78,
            durationMs: 20_000,
          },
          {
            id: "emergency-stop-1",
            kind: "emergency_stop",
            fraction: 0.89,
            durationMs: 30_000,
          },
        ]
      : [
          {
            id: "provider-timeout-1",
            kind: "provider_timeout",
            fraction: 0.42,
            durationMs: 5_000,
          },
          {
            id: "sse-disconnect-1",
            kind: "sse_disconnect",
            fraction: 0.68,
            durationMs: 5_000,
          },
        ];
  for (const fault of supportingFaults) {
    schedule.push({
      id: fault.id,
      kind: fault.kind,
      atMs: boundedAt(fault.fraction, input.durationMs, random),
      durationMs: fault.durationMs,
      targetIndex: Math.floor(random() * 2),
    });
  }
  const ordered = schedule.sort((left, right) =>
    left.atMs === right.atMs
      ? left.id.localeCompare(right.id)
      : left.atMs - right.atMs,
  );
  if (!longRun) {
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      current.atMs = Math.max(
        current.atMs,
        previous.atMs + previous.durationMs + SHORT_RUN_RECOVERY_GAP_MS + 1,
      );
    }
    const last = ordered.at(-1);
    if (!last || last.atMs + last.durationMs >= input.durationMs) {
      throw new Error("Short-run fault schedule exceeds the run horizon");
    }
  }
  return ordered;
}

export async function executeScheduledFault(
  fault: ScheduledInjectedFault,
  controls: FaultInjectionControls,
  signal?: AbortSignal,
): Promise<ExecutedFault> {
  if (fault.durationMs <= 0 || !Number.isFinite(fault.durationMs)) {
    throw new TypeError("fault durationMs must be positive");
  }
  switch (fault.kind) {
    case "worker_loss": {
      const activeWorkers = await controls.listActiveWorkers();
      if (activeWorkers.length === 0) {
        throw new Error(
          "No active worker is available for worker-loss injection",
        );
      }
      const worker = activeWorkers[fault.targetIndex % activeWorkers.length];
      await controls.killWorker(worker);
      try {
        await controls.sleep(fault.durationMs, signal);
      } finally {
        await controls.restartWorker(worker);
      }
      return { faultId: fault.id, kind: fault.kind, target: worker };
    }
    case "provider_timeout":
    case "provider_rate_limit":
    case "provider_malformed_output":
      await controls.setProviderFault(fault.kind, fault.id);
      try {
        await controls.sleep(fault.durationMs, signal);
      } finally {
        await controls.clearProviderFault(fault.id);
      }
      return {
        faultId: fault.id,
        kind: fault.kind,
        target: "synthetic-provider",
      };
    case "database_unavailable":
      await controls.pauseDatabase();
      try {
        await controls.sleep(fault.durationMs, signal);
      } finally {
        await controls.resumeDatabase();
      }
      return { faultId: fault.id, kind: fault.kind, target: "postgres" };
    case "sse_disconnect":
      await controls.disconnectObserverStream();
      try {
        await controls.sleep(fault.durationMs, signal);
      } finally {
        await controls.reconnectObserverStream();
      }
      return { faultId: fault.id, kind: fault.kind, target: "observer-stream" };
    case "emergency_stop":
      await controls.enableEmergencyStop();
      try {
        await controls.sleep(fault.durationMs, signal);
      } finally {
        await controls.disableEmergencyStop();
      }
      return { faultId: fault.id, kind: fault.kind, target: "runtime-control" };
    default: {
      const exhaustive: never = fault.kind;
      throw new TypeError(`Unsupported fault kind: ${String(exhaustive)}`);
    }
  }
}
