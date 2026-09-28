import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";

export interface ManagedProcessSpec {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ManagedProcessSnapshot {
  name: string;
  pid: number | null;
  running: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

interface ManagedProcess {
  child: ChildProcessWithoutNullStreams;
  snapshot: ManagedProcessSnapshot;
  stdout: string;
  stderr: string;
  closed: Promise<void>;
}

export interface ProcessSupervisorOptions {
  runId: string;
  gracefulStopMs?: number;
  logLimitBytes?: number;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function boundedAppend(current: string, chunk: Buffer, limit: number): string {
  const combined = Buffer.concat([Buffer.from(current), chunk]);
  return combined
    .subarray(Math.max(0, combined.byteLength - limit))
    .toString("utf8");
}

function processClosed(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => child.once("close", () => resolve()));
}

async function runExactWindowsTreeKill(
  pid: number,
  force: boolean,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const args = ["/PID", String(pid), "/T"];
    if (force) args.push("/F");
    const killer = spawn("taskkill.exe", args, {
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      killer.kill();
      reject(new Error(`taskkill timed out for exact process tree ${pid}`));
    }, 10_000);
    killer.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    killer.once("close", (code) => {
      clearTimeout(timer);
      // taskkill reports 128 when the process already exited between the
      // timeout and escalation. The child close check below remains canonical.
      if (code === 0 || code === 128) resolve();
      else reject(new Error(`taskkill failed for exact process tree ${pid}`));
    });
  });
}

async function signalExactProcessTree(
  child: ChildProcess,
  signal: "SIGTERM" | "SIGKILL",
): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    await runExactWindowsTreeKill(pid, signal === "SIGKILL");
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function terminateExactProcessTree(
  child: ChildProcess,
  gracefulMs: number,
): Promise<void> {
  const closed = processClosed(child);
  await signalExactProcessTree(child, "SIGTERM");
  const graceful = await Promise.race([
    closed.then(() => true),
    delay(gracefulMs).then(() => false),
  ]);
  if (graceful) return;
  await signalExactProcessTree(child, "SIGKILL");
  const forced = await Promise.race([
    closed.then(() => true),
    delay(gracefulMs).then(() => false),
  ]);
  if (!forced) {
    throw new Error(
      `Exact process tree ${child.pid ?? "unknown"} did not stop after escalation`,
    );
  }
}

export interface BoundedCommandExecution {
  command: string;
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxBufferBytes: number;
  ignoreInheritedStdio?: boolean;
  signal?: AbortSignal;
}

export interface BoundedCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function executeBoundedCommand(
  execution: BoundedCommandExecution,
): Promise<BoundedCommandResult> {
  if (execution.signal?.aborted)
    return Promise.reject(new Error("Command cancelled before launch"));
  if (!Number.isFinite(execution.timeoutMs) || execution.timeoutMs <= 0) {
    throw new TypeError("command timeoutMs must be positive");
  }
  if (
    !Number.isSafeInteger(execution.maxBufferBytes) ||
    execution.maxBufferBytes < 1_024
  ) {
    throw new TypeError("command maxBufferBytes must be at least 1,024");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(execution.command, execution.args, {
      cwd: execution.cwd,
      env: execution.environment,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: execution.ignoreInheritedStdio
        ? "ignore"
        : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const finish = (
      error: Error | null,
      result?: BoundedCommandResult,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      execution.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(result!);
    };
    if (!execution.ignoreInheritedStdio) {
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = boundedAppend(stdout, chunk, execution.maxBufferBytes);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = boundedAppend(stderr, chunk, execution.maxBufferBytes);
      });
    }
    child.once("error", (error) => {
      finish(
        new Error(
          `${pathBasename(execution.command)} failed: ${error.message}`,
        ),
      );
    });
    child.once("close", (code, signal) => {
      if (timedOut) return;
      if (code === 0) {
        finish(null, { stdout, stderr, exitCode: 0 });
        return;
      }
      finish(
        new Error(
          `${pathBasename(execution.command)} failed: ${stderr.trim() || (signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`)}`,
        ),
      );
    });
    const timer = setTimeout(() => {
      if (settled || timedOut) return;
      timedOut = true;
      void terminateExactProcessTree(child, 1_000).then(
        () =>
          finish(
            new Error(
              `${pathBasename(execution.command)} timed out after ${execution.timeoutMs}ms`,
            ),
          ),
        (error) =>
          finish(
            new AggregateError(
              [
                new Error(
                  `${pathBasename(execution.command)} timed out after ${execution.timeoutMs}ms`,
                ),
                error,
              ],
              `${pathBasename(execution.command)} timeout escalation failed`,
            ),
          ),
      );
    }, execution.timeoutMs);
    const onAbort = () => {
      if (settled || timedOut) return;
      timedOut = true;
      clearTimeout(timer);
      void terminateExactProcessTree(child, 1000).then(
        () => finish(new Error("Command cancelled")),
        (error) =>
          finish(
            new AggregateError([error], "Cancelled command cleanup failed"),
          ),
      );
    };
    execution.signal?.addEventListener("abort", onAbort, { once: true });
    if (execution.signal?.aborted) onAbort();
  });
}

function pathBasename(command: string): string {
  return command.replace(/^.*[\\/]/u, "");
}

export class ProcessSupervisor {
  private readonly runId: string;
  private readonly gracefulStopMs: number;
  private readonly logLimitBytes: number;
  private readonly processes = new Map<string, ManagedProcess>();

  constructor(options: ProcessSupervisorOptions) {
    if (!SAFE_ID.test(options.runId)) {
      throw new TypeError("runId must be a safe, bounded identifier");
    }
    if (
      options.gracefulStopMs !== undefined &&
      (!Number.isFinite(options.gracefulStopMs) || options.gracefulStopMs <= 0)
    ) {
      throw new TypeError("gracefulStopMs must be positive");
    }
    if (
      options.logLimitBytes !== undefined &&
      (!Number.isSafeInteger(options.logLimitBytes) ||
        options.logLimitBytes < 1_024)
    ) {
      throw new TypeError("logLimitBytes must be an integer of at least 1,024");
    }
    this.runId = options.runId;
    this.gracefulStopMs = options.gracefulStopMs ?? 30_000;
    this.logLimitBytes = options.logLimitBytes ?? 100 * 1024 * 1024;
  }

  start(spec: ManagedProcessSpec): ManagedProcessSnapshot {
    if (!SAFE_ID.test(spec.name)) {
      throw new TypeError("process name must be a safe, bounded identifier");
    }
    const previous = this.processes.get(spec.name);
    if (previous?.snapshot.running) {
      throw new Error(`Process ${spec.name} is already managed`);
    }
    if (previous) this.processes.delete(spec.name);
    if (!spec.command.trim())
      throw new TypeError("process command is required");

    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd: spec.cwd,
      env: {
        ...process.env,
        ...spec.env,
        ENDURANCE_RUN_ID: this.runId,
        ENDURANCE_PROCESS_NAME: spec.name,
      },
      windowsHide: true,
      detached: process.platform !== "win32",
    };
    const child = spawn(spec.command, spec.args ?? [], {
      ...spawnOptions,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const snapshot: ManagedProcessSnapshot = {
      name: spec.name,
      pid: child.pid ?? null,
      running: true,
      exitCode: null,
      signal: null,
    };
    let resolveClose!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const managed: ManagedProcess = {
      child,
      snapshot,
      stdout: "",
      stderr: "",
      closed,
    };
    child.stdout.on("data", (chunk: Buffer) => {
      managed.stdout = boundedAppend(managed.stdout, chunk, this.logLimitBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      managed.stderr = boundedAppend(managed.stderr, chunk, this.logLimitBytes);
    });
    let settled = false;
    const settle = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      snapshot.running = false;
      snapshot.exitCode = code;
      snapshot.signal = signal;
    };
    child.once("exit", settle);
    child.once("close", () => resolveClose());
    child.once("error", (error) => {
      managed.stderr = boundedAppend(
        managed.stderr,
        Buffer.from(`spawn error: ${error.message}\n`),
        this.logLimitBytes,
      );
      settle(null, null);
      resolveClose();
    });
    this.processes.set(spec.name, managed);
    return { ...snapshot };
  }

  snapshot(name: string): ManagedProcessSnapshot | undefined {
    const snapshot = this.processes.get(name)?.snapshot;
    return snapshot ? { ...snapshot } : undefined;
  }

  snapshots(): ManagedProcessSnapshot[] {
    return [...this.processes.values()].map((item) => ({ ...item.snapshot }));
  }

  logs(name: string): { stdout: string; stderr: string } {
    const managed = this.processes.get(name);
    if (!managed) throw new Error(`Process ${name} is not managed`);
    return { stdout: managed.stdout, stderr: managed.stderr };
  }

  async waitUntilReady(
    probe: () => boolean | Promise<boolean>,
    options: { timeoutMs: number; intervalMs?: number; label: string },
  ): Promise<void> {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new TypeError("readiness timeoutMs must be positive");
    }
    const intervalMs = options.intervalMs ?? 100;
    const deadline = Date.now() + options.timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        if (await probe()) return;
      } catch (error) {
        lastError = error;
      }
      await delay(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
    }
    const suffix =
      lastError instanceof Error ? `; last error: ${lastError.message}` : "";
    throw new Error(
      `${options.label} did not become ready within ${options.timeoutMs}ms${suffix}`,
    );
  }

  async stop(name: string): Promise<void> {
    const managed = this.processes.get(name);
    if (!managed || !managed.snapshot.running) return;
    await terminateExactProcessTree(managed.child, this.gracefulStopMs);
  }

  async kill(name: string): Promise<void> {
    const managed = this.processes.get(name);
    if (!managed || !managed.snapshot.running) return;
    await signalExactProcessTree(managed.child, "SIGKILL");
    const stopped = await Promise.race([
      managed.closed.then(() => true),
      delay(this.gracefulStopMs).then(() => false),
    ]);
    if (!stopped) {
      throw new Error(`Exact process tree for ${name} did not stop`);
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.processes.keys()].map((name) => this.stop(name)),
    );
  }
}
