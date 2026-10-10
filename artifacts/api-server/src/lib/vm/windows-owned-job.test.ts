import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import {
  compileWindowsOwnedJob,
  launchWindowsOwnedJob,
  WINDOWS_PUBLIC_SOURCE_COMPILE_TIMEOUT_MS,
} from "./windows-owned-job";
import {
  ownedAgentRuntimeCount,
  stopOwnedAgentRuntimes,
} from "../orchestrator/owned-agent-runtimes";
import {
  activateLocalEmergencyStop,
  deactivateLocalEmergencyStop,
} from "../orchestrator/local-emergency-epoch";

const FIXTURE = String.raw`
using System; using System.IO; using System.Diagnostics; using System.Threading; using System.Text;
public static class JobFixture {
  public static int Main(string[] args) {
    Console.InputEncoding = Encoding.UTF8; Console.OutputEncoding = new UTF8Encoding(false);
    string root = Environment.GetEnvironmentVariable("ACOS_JOB_FIXTURE_ROOT");
    if (args.Length > 0 && args[0] == "--fixture-descendant") {
      File.WriteAllText(Path.Combine(root,"descendant.pid"), Process.GetCurrentProcess().Id.ToString());
      while (true) { File.AppendAllText(Path.Combine(root,"heartbeat"),"."); Thread.Sleep(50); }
    }
    Process.Start(new ProcessStartInfo(System.Reflection.Assembly.GetExecutingAssembly().Location, "--fixture-descendant") { UseShellExecute=false, CreateNoWindow=true });
    string line;
    while ((line = Console.ReadLine()) != null) {
      if (line == "finish") return 0;
      Console.WriteLine(line);
    }
    return 0;
  }
}
`;
let root: string,
  fixtureExecutable: string,
  helper: Awaited<ReturnType<typeof compileWindowsOwnedJob>>;
let fixtureEnvironment: NodeJS.ProcessEnv;
let sourceBefore: string;
const evidence: Record<string, unknown>[] = [];
const preparation: {
  phase: "helper-preparation" | "fixture-compilation";
  compilerDeadlineMs: number;
  elapsedMs: number;
  outcome: "completed" | "failed" | "terminated";
}[] = [];
async function sourceDigest() {
  const hash = createHash("sha256");
  for (const relative of [
    "./windows-owned-job.ts",
    "./windows-owned-job-source.ts",
    "./windows-owned-job.test.ts",
    "../orchestrator/owned-agent-runtimes.ts",
    "./sandbox.ts",
  ])
    hash
      .update(relative)
      .update(await readFile(new URL(relative, import.meta.url)));
  return hash.digest("hex");
}
test.before(async () => {
  if (process.platform !== "win32") return;
  sourceBefore = await sourceDigest();
  root = await realpath(
    await mkdtemp(path.join(await realpath(tmpdir()), "acos-owned-job-proof-")),
  );
  const helperStarted = performance.now();
  try {
    helper = await compileWindowsOwnedJob(path.join(root, "private-helper"));
    preparation.push({
      phase: "helper-preparation",
      compilerDeadlineMs: WINDOWS_PUBLIC_SOURCE_COMPILE_TIMEOUT_MS,
      elapsedMs: Math.round(performance.now() - helperStarted),
      outcome: "completed",
    });
  } catch (error) {
    preparation.push({
      phase: "helper-preparation",
      compilerDeadlineMs: WINDOWS_PUBLIC_SOURCE_COMPILE_TIMEOUT_MS,
      elapsedMs: Math.round(performance.now() - helperStarted),
      outcome: "failed",
    });
    throw error;
  }
  const sourceStorage = new OwnerPrivateStorage(
    path.join(root, "private-fixture"),
  );
  await sourceStorage.initialize(true);
  await sourceStorage.write("fixture.cs", FIXTURE);
  fixtureExecutable = path.join(sourceStorage.directory, "fixture.exe");
  const systemRoot = process.env.SystemRoot!;
  fixtureEnvironment = {
    SystemRoot: systemRoot,
    PATH: path.join(systemRoot, "System32"),
    TEMP: root,
    TMP: root,
    HOME: root,
    USERPROFILE: root,
  };
  const script =
    "Add-Type -TypeDefinition ([System.IO.File]::ReadAllText($env:ACOS_FIXTURE_SOURCE)) -OutputAssembly $env:ACOS_FIXTURE_BINARY -OutputType ConsoleApplication";
  const fixtureStarted = performance.now();
  try {
    await promisify(execFile)(
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
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        timeout: WINDOWS_PUBLIC_SOURCE_COMPILE_TIMEOUT_MS,
        maxBuffer: 16_384,
        env: {
          ...fixtureEnvironment,
          ACOS_FIXTURE_SOURCE: path.join(sourceStorage.directory, "fixture.cs"),
          ACOS_FIXTURE_BINARY: fixtureExecutable,
        },
      },
    );
    preparation.push({
      phase: "fixture-compilation",
      compilerDeadlineMs: WINDOWS_PUBLIC_SOURCE_COMPILE_TIMEOUT_MS,
      elapsedMs: Math.round(performance.now() - fixtureStarted),
      outcome: "completed",
    });
  } catch (error) {
    // Retain no compiler message, command, environment or output. The original
    // exception still fails the suite; this receipt only locates preparation.
    preparation.push({
      phase: "fixture-compilation",
      compilerDeadlineMs: WINDOWS_PUBLIC_SOURCE_COMPILE_TIMEOUT_MS,
      elapsedMs: Math.round(performance.now() - fixtureStarted),
      outcome:
        error instanceof Error && "killed" in error && error.killed === true
          ? "terminated"
          : "failed",
    });
    throw error;
  }
});
async function until(check: () => Promise<boolean>, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("fixture observation deadline");
}
async function pid(directory: string) {
  let result = 0;
  await until(async () => {
    try {
      result = Number(
        await readFile(path.join(directory, "descendant.pid"), "utf8"),
      );
      return Number.isSafeInteger(result) && result > 0;
    } catch {
      return false;
    }
  });
  return result;
}
function exists(processId: number) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
async function sibling(directory: string) {
  await mkdir(directory);
  const child = spawn(fixtureExecutable, ["--fixture-descendant"], {
    cwd: root,
    shell: false,
    windowsHide: true,
    env: { ...fixtureEnvironment, ACOS_JOB_FIXTURE_ROOT: directory },
    stdio: "ignore",
  });
  await pid(directory);
  return child;
}
async function stopSibling(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  child.kill();
  await closed;
}
test(
  "a Windows job relays UTF-8 stdin/stdout and emergency stop kills the owned descendants while an unrelated fixture continues",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = path.join(root, "emergency-target");
    await mkdir(directory);
    const other = await sibling(path.join(root, "unrelated-fixture"));
    let runtime: Awaited<ReturnType<typeof launchWindowsOwnedJob>> | undefined;
    try {
      runtime = await launchWindowsOwnedJob({
        helper,
        executable: fixtureExecutable,
        cwd: root,
        controlDirectory: path.join(root, "emergency-control"),
        environment: {
          ...fixtureEnvironment,
          ACOS_JOB_FIXTURE_ROOT: directory,
        },
        assertOwned: async () => {},
      });
      const descendant = await pid(directory);
      const output = new Promise<string>((resolve) =>
        runtime!.child.stdout.once("data", (data) =>
          resolve(data.toString("utf8")),
        ),
      );
      runtime.child.stdin.write("İş ✅\n");
      assert.match(await output, /İş ✅/u);
      assert.equal(ownedAgentRuntimeCount(), 1);
      activateLocalEmergencyStop();
      assert.equal(stopOwnedAgentRuntimes(), 1);
      await runtime.stop();
      assert.equal(exists(descendant), false);
      assert.equal(ownedAgentRuntimeCount(), 0);
      const before = (
        await stat(path.join(root, "unrelated-fixture", "heartbeat"))
      ).size;
      await until(
        async () =>
          (await stat(path.join(root, "unrelated-fixture", "heartbeat"))).size >
          before,
      );
      assert.equal(other.exitCode, null);
      const proof = JSON.parse(
        await readFile(
          path.join(root, "emergency-control", "stopped.json"),
          "utf8",
        ),
      );
      assert.equal(proof.activeProcesses, 0);
      evidence.push({
        scenario: "emergency-stop",
        zeroMembersReceipt: true,
        unrelatedFixtureContinued: true,
      });
    } finally {
      deactivateLocalEmergencyStop();
      await runtime?.stop();
      await stopSibling(other);
    }
  },
);
test(
  "a naturally exited Windows target cannot leave its descendant alive or unregister without a job receipt",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = path.join(root, "natural-target");
    await mkdir(directory);
    const runtime = await launchWindowsOwnedJob({
      helper,
      executable: fixtureExecutable,
      cwd: root,
      controlDirectory: path.join(root, "natural-control"),
      environment: { ...fixtureEnvironment, ACOS_JOB_FIXTURE_ROOT: directory },
      assertOwned: async () => {},
    });
    try {
      const descendant = await pid(directory);
      const closed = new Promise<void>((resolve) =>
        runtime.child.once("close", () => resolve()),
      );
      runtime.child.stdin.write("finish\n");
      await closed;
      assert.equal(exists(descendant), false);
      assert.equal(ownedAgentRuntimeCount(), 1);
      await runtime.stop();
      assert.equal(ownedAgentRuntimeCount(), 0);
      const proof = JSON.parse(
        await readFile(
          path.join(root, "natural-control", "stopped.json"),
          "utf8",
        ),
      );
      assert.equal(proof.childExitCode, 0);
      assert.equal(proof.activeProcesses, 0);
      evidence.push({
        scenario: "natural-parent-exit",
        activeProcesses: proof.activeProcesses,
        childExitCode: proof.childExitCode,
        ownedDescendantGone: !exists(descendant),
      });
    } finally {
      await runtime.stop();
    }
  },
);
test.after(async () => {
  if (root)
    await writeFile(
      path.join(root, "fixture-scope.json"),
      JSON.stringify({
        scope:
          "Owned compiled fixture processes, private Windows Job lifetime and stdio only. No Codex inference or human credential; not filesystem/network sandbox proof.",
        helperSha256: helper?.sha256,
        completedAt: new Date().toISOString(),
        sourceBefore,
        sourceAfter: await sourceDigest(),
        preparation,
        evidence,
      }),
    );
});

test(
  "failure during Windows job startup leaves no target process or stale runtime registration",
  { skip: process.platform !== "win32" },
  async () => {
    const storage = new OwnerPrivateStorage(path.join(root, "invalid-fixture"));
    await storage.initialize(true);
    await storage.write("invalid.exe", "not an executable fixture");
    await assert.rejects(
      launchWindowsOwnedJob({
        helper,
        executable: path.join(storage.directory, "invalid.exe"),
        cwd: root,
        controlDirectory: path.join(root, "invalid-control"),
        environment: fixtureEnvironment,
        assertOwned: async () => {},
      }),
      { message: "owned_windows_runtime_unsupported" },
    );
    assert.equal(ownedAgentRuntimeCount(), 0);
    const proof = JSON.parse(
      await readFile(
        path.join(root, "invalid-control", "stopped.json"),
        "utf8",
      ),
    );
    assert.equal(proof.startFailed, true);
    assert.equal(proof.activeProcesses, 0);
    evidence.push({
      scenario: "failed-start",
      activeProcesses: proof.activeProcesses,
      startFailed: proof.startFailed,
      runtimesRemaining: ownedAgentRuntimeCount(),
    });
  },
);
