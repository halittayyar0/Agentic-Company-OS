import type { RuntimeRole } from "./runtime-operations-config";

export interface RuntimeRolePlan {
  startsHttp: boolean;
  startsScheduler: boolean;
  seedsDatabase: boolean;
  /**
   * The legacy computer-activity recovery scan is process-global. It is safe
   * only in the single-process compatibility runtime until those activities
   * carry a durable runtime/attempt owner.
   */
  recoversProcessLocalComputerActivities: boolean;
}

export function planRuntimeRole(input: {
  role: RuntimeRole;
  schedulerSetting: boolean | undefined;
}): RuntimeRolePlan {
  if (input.role === "api") {
    if (input.schedulerSetting === true) {
      throw new Error(
        "SCHEDULER_ENABLED must not be true when RUNTIME_ROLE=api.",
      );
    }
    return Object.freeze({
      startsHttp: true,
      startsScheduler: false,
      seedsDatabase: true,
      recoversProcessLocalComputerActivities: false,
    });
  }

  if (input.role === "worker") {
    if (input.schedulerSetting === false) {
      throw new Error(
        "SCHEDULER_ENABLED must not be false when RUNTIME_ROLE=worker.",
      );
    }
    return Object.freeze({
      startsHttp: false,
      startsScheduler: true,
      seedsDatabase: false,
      recoversProcessLocalComputerActivities: false,
    });
  }

  if (input.schedulerSetting === undefined) {
    throw new Error(
      "The combined runtime must resolve its scheduler setting before planning.",
    );
  }
  return Object.freeze({
    startsHttp: true,
    startsScheduler: input.schedulerSetting,
    seedsDatabase: true,
    recoversProcessLocalComputerActivities: true,
  });
}

export function assertEntrypointRole(
  entrypoint: "api" | "worker",
  role: RuntimeRole,
): void {
  if (entrypoint === "api" && role === "worker") {
    throw new Error(
      "The worker role must start through the worker entrypoint.",
    );
  }
  if (entrypoint === "worker" && role !== "worker") {
    throw new Error("The worker entrypoint requires RUNTIME_ROLE=worker.");
  }
}
