import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import {
  assertLocalExecutionEpoch,
  captureLocalExecutionEpoch,
} from "../orchestrator/local-emergency-epoch";
import { registerOwnedAgentRuntime } from "../orchestrator/owned-agent-runtimes";
import { WINDOWS_OWNED_JOB_SOURCE } from "./windows-owned-job-source";

const executeFile = promisify(execFile);
const COMPILE = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition ([System.IO.File]::ReadAllText($env:ACOS_JOB_SOURCE)) -OutputAssembly $env:ACOS_JOB_BINARY -OutputType ConsoleApplication
`;
const safeFailure = () => new Error("owned_windows_runtime_unsupported");
const cleanupFailure = () => new Error("owned_runtime_cleanup_unverified");
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
async function exactFile(file: string) {
  if (
    !path.isAbsolute(file) ||
    (await lstat(file)).isSymbolicLink() ||
    !(await lstat(file)).isFile() ||
    (await realpath(file)).toLowerCase() !== path.resolve(file).toLowerCase()
  )
    throw safeFailure();
}

/** Prepare before any credential is passed to a child. The public source is
 * compiled using the OS's fixed PowerShell/.NET path into a new private home. */
export async function compileWindowsOwnedJob(directory: string) {
  if (process.platform !== "win32") throw safeFailure();
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.isAbsolute(systemRoot)) throw safeFailure();
  const storage = new OwnerPrivateStorage(directory);
  await storage.initialize(true);
  await storage.write("owned-job.cs", WINDOWS_OWNED_JOB_SOURCE);
  const executable = path.join(directory, "owned-job.exe");
  const diagnosticStart = performance.now();
  let diagnosticPhase = "compiler";
  try {
    await executeFile(
      path.join(
        systemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(COMPILE, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 16_384,
        env: {
          SystemRoot: systemRoot,
          PATH: path.join(systemRoot, "System32"),
          TEMP: directory,
          TMP: directory,
          HOME: directory,
          USERPROFILE: directory,
          ACOS_JOB_SOURCE: path.join(directory, "owned-job.cs"),
          ACOS_JOB_BINARY: executable,
        },
      },
    );
    // read verifies inherited owner/SYSTEM-only metadata without exposing any
    // binary bytes. The bounded helper is then hashed as bytes for launch.
    diagnosticPhase = "binary-protection";
    await storage.read("owned-job.exe");
    await exactFile(executable);
    return { executable, sha256: digest(await readFile(executable)) };
  } catch (error: any) {
    console.error("ACOS_FIXED_WINDOWS_COMPILER_DIAGNOSTIC:" + JSON.stringify({ phase: diagnosticPhase, elapsedMs: performance.now() - diagnosticStart, code: error?.code ?? null, signal: error?.signal ?? null, killed: error?.killed === true, boundedPublicCompilerError: diagnosticPhase === "compiler" ? String(error?.stderr ?? "").slice(-2048) : String(error?.message ?? "").slice(-120) }));
    throw safeFailure();
  }
}

interface Input {
  helper: Awaited<ReturnType<typeof compileWindowsOwnedJob>>;
  executable: string;
  cwd: string;
  controlDirectory: string;
  /** Explicit backend environment only; the caller must never spread human
   * process.env. Credential remains in process memory, not argv/control files. */
  environment: NodeJS.ProcessEnv;
  assertOwned(): Promise<void>;
  startupTimeoutMs?: number;
}
/** A lifetime controller, not an OS filesystem/network sandbox. Codex still
 * must pass effective permission/configuration and platform containment checks.
 * The suspended target joins its private Windows job before it can run. */
export async function launchWindowsOwnedJob(input: Input): Promise<{
  child: ChildProcessWithoutNullStreams;
  targetPid: number;
  stop(): Promise<void>;
}> {
  if (process.platform !== "win32") throw safeFailure();
  const epoch = captureLocalExecutionEpoch(),
    timeout = input.startupTimeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 30_000)
    throw safeFailure();
  await exactFile(input.executable);
  await exactFile(input.helper.executable);
  if (
    digest(await readFile(input.helper.executable)) !== input.helper.sha256 ||
    (await realpath(input.cwd)).toLowerCase() !==
      path.resolve(input.cwd).toLowerCase()
  )
    throw safeFailure();
  const storage = new OwnerPrivateStorage(input.controlDirectory);
  await storage.initialize(true);
  const runId = randomUUID();
  await input.assertOwned();
  assertLocalExecutionEpoch(epoch);
  const child = spawn(
    input.helper.executable,
    [input.executable, input.controlDirectory, String(process.pid), runId],
    {
      cwd: input.cwd,
      shell: false,
      windowsHide: true,
      env: { ...input.environment },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  // Register in the same synchronous segment as spawn. No process-name scan,
  // shared PID lookup or operator process is a termination target.
  let closed = false,
    childFailure = false;
  child.once("close", () => {
    closed = true;
  });
  child.once("error", () => {
    childFailure = true;
  });
  for (const stream of [child.stdin, child.stdout, child.stderr])
    stream.on("error", () => {});
  async function record(name: string) {
    const raw = await storage.read(name);
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== "object" || value.runId !== runId)
        throw cleanupFailure();
      return value as Record<string, unknown>;
    } catch {
      throw cleanupFailure();
    }
  }
  const runtime = registerOwnedAgentRuntime(epoch, async () => {
    await storage.write("stop.json", '{"stop":true}');
    const until = Date.now() + 8_000;
    while (Date.now() < until) {
      const stopped = await record("stopped.json");
      if (stopped && stopped.activeProcesses === 0 && closed) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Parent exit alone is insufficient. Keep the runtime registered on this
    // error; kernel kill-on-close is a backstop, not an invented receipt.
    throw cleanupFailure();
  });
  try {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      assertLocalExecutionEpoch(epoch);
      const ready = await record("ready.json");
      if (
        ready &&
        Number.isSafeInteger(ready.childPid) &&
        Number(ready.childPid) > 0
      ) {
        await input.assertOwned();
        assertLocalExecutionEpoch(epoch);
        return { child, targetPid: Number(ready.childPid), stop: runtime.stop };
      }
      if (closed || childFailure) throw safeFailure();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw safeFailure();
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}
