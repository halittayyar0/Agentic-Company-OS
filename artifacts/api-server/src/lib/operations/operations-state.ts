import type {
  RuntimeInstanceRole,
  RuntimeInstanceState,
  RuntimeTruthState,
} from "@workspace/db";

export interface RuntimeTruthInstance {
  id: string;
  role: RuntimeInstanceRole;
  state: RuntimeInstanceState;
  schedulerEnabled: boolean;
  lastHeartbeatAt: Date;
  lastSchedulerTickAt: Date | null;
}

export interface RuntimeTruth {
  state: RuntimeTruthState;
  reasons: string[];
  databaseBackend: "postgresql" | "pglite";
  durable: boolean;
  multiProcessCapable: boolean;
  emergencyStopEnabled: boolean;
  healthyWorkerCount: number;
  staleWorkerCount: number;
  schedulerTickAgeMs: number | null;
}

export function effectiveRuntimeState(
  instance: Pick<RuntimeTruthInstance, "state" | "lastHeartbeatAt">,
  now: Date,
  staleAfterMs: number,
): RuntimeInstanceState {
  if (
    instance.state === "stopped" ||
    instance.state === "draining" ||
    instance.state === "stale"
  ) {
    return instance.state;
  }
  return now.getTime() - instance.lastHeartbeatAt.getTime() >= staleAfterMs
    ? "stale"
    : instance.state;
}

export function deriveRuntimeTruth(input: {
  now: Date;
  databaseBackend: "postgresql" | "pglite";
  emergencyStopEnabled: boolean;
  workerStaleAfterMs: number;
  instances: ReadonlyArray<RuntimeTruthInstance>;
}): RuntimeTruth {
  const schedulerInstances = input.instances.filter(
    (instance) =>
      instance.schedulerEnabled &&
      (instance.role === "worker" || instance.role === "combined"),
  );
  const effective = schedulerInstances.map((instance) => ({
    instance,
    state: effectiveRuntimeState(instance, input.now, input.workerStaleAfterMs),
  }));
  const healthy = effective.filter((entry) => entry.state === "healthy");
  const stale = effective.filter((entry) => entry.state === "stale");
  const transitional = effective.filter(
    (entry) => entry.state === "starting" || entry.state === "draining",
  );
  const freshestTick = healthy.reduce<Date | null>((freshest, entry) => {
    const tick = entry.instance.lastSchedulerTickAt;
    if (!tick) return freshest;
    return !freshest || tick.getTime() > freshest.getTime() ? tick : freshest;
  }, null);
  const schedulerTickAgeMs = freshestTick
    ? Math.max(0, input.now.getTime() - freshestTick.getTime())
    : null;

  const base = {
    databaseBackend: input.databaseBackend,
    durable: input.databaseBackend === "postgresql",
    multiProcessCapable: input.databaseBackend === "postgresql",
    emergencyStopEnabled: input.emergencyStopEnabled,
    healthyWorkerCount: healthy.length,
    staleWorkerCount: stale.length,
    schedulerTickAgeMs,
  };

  if (input.emergencyStopEnabled) {
    return {
      ...base,
      state: "emergency_stopped",
      reasons: ["emergency_stop_active"],
    };
  }
  if (input.databaseBackend === "pglite") {
    return { ...base, state: "local_demo", reasons: ["embedded_database"] };
  }
  if (healthy.length === 0) {
    if (stale.length > 0) {
      return {
        ...base,
        state: "stale",
        reasons: ["worker_heartbeat_stale", "no_healthy_scheduler"],
      };
    }
    if (transitional.length > 0) {
      return {
        ...base,
        state: "degraded",
        reasons: ["worker_transition_in_progress", "no_healthy_scheduler"],
      };
    }
    return { ...base, state: "offline", reasons: ["no_scheduler_runtime"] };
  }

  const reasons: string[] = [];
  // A stale row can be the durable history of a worker that was replaced.
  // Keep it visible in staleWorkerCount, but judge current availability from
  // the healthy schedulers and their freshest tick.
  if (transitional.length > 0) reasons.push("worker_transition_in_progress");
  if (
    schedulerTickAgeMs === null ||
    schedulerTickAgeMs >= input.workerStaleAfterMs
  ) {
    reasons.push("scheduler_tick_stale");
  }
  return {
    ...base,
    state: reasons.length > 0 ? "degraded" : "live",
    reasons,
  };
}
