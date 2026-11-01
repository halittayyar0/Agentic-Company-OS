import type { ChildProcess } from "node:child_process";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

interface LoopMonitor {
  enable(): unknown;
  disable(): unknown;
  readonly max: number;
  readonly count: number;
}

export interface WindowsStorageDiagnostics {
  readonly spawned: boolean;
  readonly spawnDelayMs: number | null;
  readonly startMarkerDelayMs: number | null;
  readonly elapsedMs: number;
  readonly killed: boolean;
  readonly eventLoopMaxDelayMs: number;
  readonly eventLoopSamples: number;
}

const START = "ACOS_PRIVATE_STORAGE_STARTED";
const bounded = (value: number) =>
  Number.isFinite(value)
    ? Math.max(0, Math.min(900_000, Math.round(value)))
    : 0;

/** Observe the existing child without including its output in snapshots. */
export function beginWindowsStorageDiagnostics({
  now = () => performance.now(),
  newMonitor = () => monitorEventLoopDelay({ resolution: 20 }),
}: { now?: () => number; newMonitor?: () => LoopMonitor } = {}) {
  const started = now();
  const monitor = newMonitor();
  monitor.enable();
  let child: ChildProcess | undefined;
  let spawned = false;
  let spawnDelayMs: number | null = null;
  let startMarkerDelayMs: number | null = null;
  let tail = "";
  let snapshot: WindowsStorageDiagnostics | undefined;
  const elapsed = () => bounded(now() - started);
  const onSpawn = () => {
    spawned = true;
    spawnDelayMs = elapsed();
  };
  const onStderr = (chunk: Buffer | string) => {
    const text = tail + chunk.toString("utf8");
    if (text.includes(START)) {
      startMarkerDelayMs = elapsed();
      tail = "";
      child?.stderr?.removeListener("data", onStderr);
    } else {
      tail = text.slice(-(START.length - 1));
    }
  };
  return {
    attach(value: ChildProcess | undefined) {
      if (!value || child || snapshot) return;
      child = value;
      child.once("spawn", onSpawn);
      child.stderr?.on("data", onStderr);
    },
    finish(): WindowsStorageDiagnostics {
      if (snapshot) return snapshot;
      monitor.disable();
      child?.removeListener("spawn", onSpawn);
      child?.stderr?.removeListener("data", onStderr);
      tail = "";
      snapshot = Object.freeze({
        spawned,
        spawnDelayMs,
        startMarkerDelayMs,
        elapsedMs: elapsed(),
        killed: child?.killed === true,
        eventLoopMaxDelayMs: bounded(monitor.max / 1_000_000),
        eventLoopSamples: bounded(monitor.count),
      });
      child = undefined;
      return snapshot;
    },
  };
}

export function formatWindowsStorageDiagnostics(
  value: WindowsStorageDiagnostics,
): string {
  // Project a fixed schema even if a future caller adds private fields.
  return (
    "windows_private_storage_timing " +
    JSON.stringify({
      spawned: value.spawned === true,
      spawnDelayMs:
        value.spawnDelayMs === null ? null : bounded(value.spawnDelayMs),
      startMarkerDelayMs:
        value.startMarkerDelayMs === null
          ? null
          : bounded(value.startMarkerDelayMs),
      elapsedMs: bounded(value.elapsedMs),
      killed: value.killed === true,
      eventLoopMaxDelayMs: bounded(value.eventLoopMaxDelayMs),
      eventLoopSamples: bounded(value.eventLoopSamples),
    })
  );
}
