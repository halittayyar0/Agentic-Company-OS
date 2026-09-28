/**
 * Process-local linearization token for autonomous side effects. The durable
 * database control remains authoritative; this epoch closes the narrow gap
 * between a successful persisted check and registering/spawning a local
 * process or sending browser input.
 */
let epoch = 0;
let stopped = false;

export class LocalEmergencyStopError extends Error {
  constructor() {
    super("Emergency stop changed while the autonomous action was starting");
    this.name = "LocalEmergencyStopError";
  }
}

export function activateLocalEmergencyStop(): number {
  if (!stopped) {
    stopped = true;
    epoch += 1;
  }
  return epoch;
}

export function deactivateLocalEmergencyStop(): number {
  if (stopped) {
    stopped = false;
    epoch += 1;
  }
  return epoch;
}

export function captureLocalExecutionEpoch(): number {
  if (stopped) throw new LocalEmergencyStopError();
  return epoch;
}

export function assertLocalExecutionEpoch(captured: number): void {
  if (stopped || captured !== epoch) throw new LocalEmergencyStopError();
}

export function localEmergencyStopSnapshot(): {
  epoch: number;
  stopped: boolean;
} {
  return { epoch, stopped };
}
