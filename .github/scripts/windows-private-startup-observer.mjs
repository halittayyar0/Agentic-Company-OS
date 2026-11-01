import { ChildProcess } from "node:child_process";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const START = "ACOS_PRIVATE_STORAGE_STARTED";
const OK = "PRIVATE_OK";
const bounded = (value) =>
  Number.isFinite(Number(value))
    ? Math.max(0, Math.min(900_000, Math.round(Number(value))))
    : 0;

// Diagnostic only: leave execFile, its promisify implementation, arguments,
// callbacks, buffer limits and deadlines intact. Observe the actual child.
export function createObservedSpawn(
  original,
  {
    matches,
    onRecord,
    now = () => performance.now(),
    newMonitor = () => monitorEventLoopDelay({ resolution: 20 }),
  },
) {
  let index = 0;
  return function (...args) {
    if (!matches(args[0]?.file)) return Reflect.apply(original, this, args);
    const child = this;
    const started = now();
    const monitor = newMonitor();
    monitor.enable();
    const record = {
      index: ++index,
      spawned: false,
      spawnDelayMs: null,
      startMarkerDelayMs: null,
      okMarkerDelayMs: null,
    };
    let closed = false;
    let startTail = "";
    let okTail = "";
    const elapsed = () => bounded(now() - started);
    const onSpawn = () => {
      record.spawned = true;
      record.spawnDelayMs = elapsed();
    };
    const onStderr = (chunk) => {
      const text = startTail + chunk.toString("utf8");
      if (record.startMarkerDelayMs === null && text.includes(START))
        record.startMarkerDelayMs = elapsed();
      startTail = text.slice(-(START.length - 1));
    };
    const onStdout = (chunk) => {
      const text = okTail + chunk.toString("utf8");
      if (record.okMarkerDelayMs === null && text.includes(OK))
        record.okMarkerDelayMs = elapsed();
      okTail = text.slice(-(OK.length - 1));
    };
    const finish = (code, signal, spawnCallThrew = false) => {
      if (closed) return;
      closed = true;
      monitor.disable();
      child.removeListener("spawn", onSpawn);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("data", onStdout);
      child.stderr?.removeListener("data", onStderr);
      startTail = "";
      okTail = "";
      onRecord({
        ...record,
        elapsedMs: elapsed(),
        closeCode: Number.isSafeInteger(code) ? code : null,
        closeSignal:
          signal === null || signal === undefined
            ? null
            : ["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT"].includes(signal)
              ? signal
              : "OTHER",
        killed: child.killed === true,
        spawnCallThrew,
        eventLoopMaxDelayMs: bounded(Number(monitor.max) / 1_000_000),
        eventLoopSamples: bounded(monitor.count),
      });
    };
    const onClose = (code, signal) => finish(code, signal);
    child.once("spawn", onSpawn);
    child.once("close", onClose);
    try {
      const result = Reflect.apply(original, child, args);
      child.stdout?.on("data", onStdout);
      child.stderr?.on("data", onStderr);
      return result;
    } catch (error) {
      finish(null, null, true);
      throw error;
    }
  };
}

if (process.env.ACOS_WINDOWS_STORAGE_OBSERVE === "1") {
  if (
    process.platform !== "win32" ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== "halittayyar0/Agentic-Company-OS" ||
    !process.env.SystemRoot ||
    !path.isAbsolute(process.env.SystemRoot)
  )
    throw new Error("owned_public_windows_diagnostic_required");
  const executable = path
    .resolve(
      process.env.SystemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    )
    .toLowerCase();
  ChildProcess.prototype.spawn = createObservedSpawn(
    ChildProcess.prototype.spawn,
    {
      matches: (file) =>
        typeof file === "string" &&
        path.resolve(file).toLowerCase() === executable,
      onRecord: (value) =>
        process.stdout.write(
          "ACOS_WINDOWS_PRIVATE_STARTUP " +
            JSON.stringify({
              schema: "windows-private-startup-observation@1",
              applicationCommit: "72572d0850ba1a8757d0e9e7d84bc51a03208233",
              applicationTree: "160c1b6bc390289956e81fded8abfb7e31a6b911",
              nodeVersion: process.version,
              ...value,
            }) +
            "\n",
        ),
    },
  );
}
