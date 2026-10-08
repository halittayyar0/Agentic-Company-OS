import { verifyPrototypeCodingToolchain } from "./prototype-coding-toolchain";
import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Readable, Writable } from "node:stream";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import {
  assertLocalExecutionEpoch,
  captureLocalExecutionEpoch,
} from "../orchestrator/local-emergency-epoch";
import { registerOwnedAgentRuntime } from "../orchestrator/owned-agent-runtimes";
import { LINUX_OWNED_NAMESPACE_SOURCE } from "./linux-owned-namespace-source";
import { acceptsLinuxBwrapIdentity } from "./linux-bwrap-identity";

const execute = promisify(execFile);
const unsupported = () => new Error("owned_linux_runtime_unsupported");
const unverified = () => new Error("owned_runtime_cleanup_unverified");
const digest = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");
const canonical = (file: string) =>
  typeof file === "string" &&
  file.length <= 4096 &&
  path.isAbsolute(file) &&
  path.normalize(file) === file &&
  !/[\u0000-\u001f\u007f]/u.test(file);
async function exact(file: string, directory = false) {
  if (!canonical(file)) throw unsupported();
  const stat = await lstat(file);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    (await realpath(file)) !== file
  )
    throw unsupported();
  return stat;
}
async function systemTool(file: string) {
  const resolved = await realpath(file);
  const stat = await exact(resolved);
  if (
    stat.uid !== 0 ||
    (stat.mode & 0o6022) !== 0 ||
    stat.size <= 0 ||
    stat.size > 32 * 1024 * 1024
  )
    throw unsupported();
  for (let parent = path.dirname(resolved); ; parent = path.dirname(parent)) {
    const metadata = await lstat(parent);
    if (
      !metadata.isDirectory() ||
      metadata.uid !== 0 ||
      (metadata.mode & 0o022) !== 0
    )
      throw unsupported();
    if (parent === "/") break;
  }
  return Object.freeze({
    executable: resolved,
    sha256: digest(await readFile(resolved)),
  });
}
export async function prepareLinuxOwnedNamespace(directory: string) {
  if (process.platform !== "linux" || !process.getuid) throw unsupported();
  await verifyPrototypeCodingToolchain();
  const bwrap = await systemTool("/usr/bin/bwrap"),
    python = await systemTool("/usr/bin/python3");
  const environment = {
    PATH: "/usr/bin:/bin",
    HOME: directory,
    LANG: "C.UTF-8",
  };
  const version = await execute(bwrap.executable, ["--version"], {
    env: environment,
    timeout: 5000,
    maxBuffer: 4096,
  });
  const help = await execute(bwrap.executable, ["--help"], {
    env: environment,
    timeout: 5000,
    maxBuffer: 32 * 1024,
  });
  // Pinned Codex must re-exec its verified binary with the sandbox argv0.
  // Legacy Bubblewrap falls back to an alias inside the denied private home.
  // Refuse early instead of granting read access to credentials/history.
  if (
    !acceptsLinuxBwrapIdentity({
      version: version.stdout,
      help: help.stdout,
      sha256: bwrap.sha256,
      architecture: process.arch,
    })
  )
    throw unsupported();
  const py = await execute(
    python.executable,
    [
      "-I",
      "-S",
      "-c",
      "import sys; assert sys.version_info >= (3,9); print('PYTHON_OK')",
    ],
    {
      env: environment,
      timeout: 5000,
      maxBuffer: 4096,
    },
  );
  if (py.stdout.trim() !== "PYTHON_OK") throw unsupported();
  const storage = new OwnerPrivateStorage(directory);
  await storage.initialize(true);
  await storage.write("guardian.py", LINUX_OWNED_NAMESPACE_SOURCE);
  return Object.freeze({
    script: path.join(directory, "guardian.py"),
    bwrap,
    python,
  });
}
interface Input {
  helper: Awaited<ReturnType<typeof prepareLinuxOwnedNamespace>>;
  executable: string;
  /** Backend arguments only. The production caller fixes these to app-server. */
  args: readonly string[];
  cwd: string;
  workspace: string;
  controlDirectory: string;
  environment: NodeJS.ProcessEnv;
  assertOwned(): Promise<void>;
  startupTimeoutMs?: number;
  /** Backend-only offline verification; additionally isolates the server's
   * network. Normal model tasks need server networking and omit this flag. */
  isolateNetwork?: boolean;
}
type Identity = { pid: number; start: string; namespace: string };
async function kernelIdentity(pid: number): Promise<Identity | null> {
  try {
    const statPath = `/proc/${pid}/stat`,
      first = await readFile(statPath, "utf8");
    const start = first.slice(first.lastIndexOf(")") + 2).split(" ")[19];
    const namespace = await readlink(`/proc/${pid}/ns/pid`);
    const second = await readFile(statPath, "utf8");
    if (
      !/^\d+$/u.test(start ?? "") ||
      !/^pid:\[\d+\]$/u.test(namespace) ||
      second.slice(second.lastIndexOf(")") + 2).split(" ")[19] !== start
    )
      throw unverified();
    return { pid, start, namespace };
  } catch (error) {
    if (
      ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")
    )
      return null;
    throw error;
  }
}
const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, 25));
/** Dedicated PID namespace lifetime, independently of the CLI permission sandbox.
 * Never closes an operator's process or selects a termination target by name. */
export async function launchLinuxOwnedNamespace(input: Input): Promise<{
  child: ChildProcessWithoutNullStreams;
  namespaceInitPid: number;
  stop(): Promise<void>;
}> {
  if (process.platform !== "linux" || !process.getuid) throw unsupported();
  const epoch = captureLocalExecutionEpoch(),
    timeout = input.startupTimeoutMs ?? 10_000;
  if (
    (input.isolateNetwork !== undefined &&
      typeof input.isolateNetwork !== "boolean") ||
    !Number.isSafeInteger(timeout) ||
    timeout < 100 ||
    timeout > 30_000 ||
    !Array.isArray(input.args) ||
    input.args.length < 1 ||
    input.args.length > 32 ||
    input.args.some(
      (value) =>
        typeof value !== "string" ||
        value.length > 16384 ||
        value.includes("\0"),
    )
  )
    throw unsupported();
  await verifyPrototypeCodingToolchain();
  await exact(input.cwd, true);
  await exact(input.workspace, true);
  await exact(input.executable);
  const relative = path.relative(input.workspace, input.cwd);
  const reverse = path.relative(input.cwd, input.workspace);
  if (
    ![relative, reverse].every(
      (value) => value.startsWith(`..${path.sep}`) || path.isAbsolute(value),
    )
  )
    throw unsupported();
  const bwrap = await systemTool("/usr/bin/bwrap"),
    python = await systemTool("/usr/bin/python3");
  if (
    bwrap.executable !== input.helper.bwrap.executable ||
    bwrap.sha256 !== input.helper.bwrap.sha256 ||
    python.executable !== input.helper.python.executable ||
    python.sha256 !== input.helper.python.sha256
  )
    throw unsupported();
  if (path.basename(input.helper.script) !== "guardian.py") throw unsupported();
  const helperStorage = new OwnerPrivateStorage(
    path.dirname(input.helper.script),
  );
  await helperStorage.initialize();
  if (
    digest((await helperStorage.read("guardian.py")) ?? "") !==
    digest(LINUX_OWNED_NAMESPACE_SOURCE)
  )
    throw unsupported();
  const control = new OwnerPrivateStorage(input.controlDirectory);
  await control.initialize(true);
  const ownerNamespace = await readlink("/proc/self/ns/pid"),
    runId = randomUUID();
  if (!/^pid:\[\d+\]$/u.test(ownerNamespace)) throw unsupported();
  await input.assertOwned();
  assertLocalExecutionEpoch(epoch);
  // Codex's native sandbox helper needs /tmp for its mount registry even when
  // command environments omit TMPDIR. Use fresh namespace storage, never the
  // host's shared /tmp. Retain only the explicit temporary installation tree
  // when the operator's executable itself lives below /tmp.
  const temporaryExecutableMount = input.executable.startsWith("/tmp/")
    ? path.join(
        "/tmp",
        path.relative("/tmp", input.executable).split(path.sep)[0]!,
      )
    : null;
  const child = spawn(
    bwrap.executable,
    [
      "--unshare-user",
      "--unshare-pid",
      ...(input.isolateNetwork ? ["--unshare-net"] : []),
      "--die-with-parent",
      "--as-pid-1",
      "--new-session",
      "--ro-bind",
      "/",
      "/",
      "--tmpfs",
      "/tmp",
      ...(temporaryExecutableMount
        ? ["--ro-bind", temporaryExecutableMount, temporaryExecutableMount]
        : []),
      "--bind",
      input.cwd,
      input.cwd,
      "--bind",
      input.workspace,
      input.workspace,
      "--dev",
      "/dev",
      "--bind",
      "/proc",
      "/proc",
      "--chdir",
      input.cwd,
      "--json-status-fd",
      "5",
      "--",
      python.executable,
      "-I",
      "-S",
      input.helper.script,
      runId,
      ownerNamespace,
      "3",
      "4",
      input.executable,
      ...input.args,
    ],
    {
      cwd: input.cwd,
      env: { ...input.environment },
      shell: false,
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe", "pipe"],
    },
  ) as ChildProcessWithoutNullStreams;
  // Node's convenience type describes five slots even with six explicit pipes.
  const pipes = child.stdio as (Readable | Writable | null | undefined)[];
  const owner = pipes[3] as Writable;
  let closed = false,
    spawnFailed = false,
    bad = false,
    ready = false,
    stopped = false;
  const identityState: { init: Identity | null } = { init: null };
  let initReported = false;
  let information: Promise<void> = Promise.resolve();
  child.once("close", () => {
    closed = true;
  });
  child.once("error", () => {
    spawnFailed = true;
  });
  for (const stream of child.stdio) stream?.on("error", () => {});
  function records(
    stream: Readable,
    receive: (record: Record<string, unknown>) => void,
  ) {
    let buffer = "",
      total = 0;
    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > 8192) {
        bad = true;
        owner.end();
        return;
      }
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
          const record = JSON.parse(line);
          if (!record || typeof record !== "object" || Array.isArray(record))
            throw unsupported();
          receive(record);
        } catch {
          bad = true;
          owner.end();
        }
      }
    });
    stream.once("end", () => {
      if (buffer.trim()) {
        bad = true;
        owner.end();
      }
    });
  }
  records(pipes[4] as Readable, (record) => {
    if (record.runId !== runId) throw unsupported();
    if (
      record.kind === "ready" &&
      !ready &&
      !stopped &&
      record.initPid === 1 &&
      Number.isSafeInteger(record.targetPid) &&
      Number(record.targetPid) > 1
    ) {
      ready = true;
      return;
    }
    if (
      record.kind === "stopped" &&
      ready &&
      !stopped &&
      record.activeProcesses === 0 &&
      Number.isSafeInteger(record.targetExitCode)
    ) {
      stopped = true;
      return;
    }
    throw unsupported();
  });
  records(pipes[5] as Readable, (record) => {
    if (!("child-pid" in record)) return;
    if (
      !Number.isSafeInteger(record["child-pid"]) ||
      Number(record["child-pid"]) <= 1 ||
      initReported
    )
      throw unsupported();
    initReported = true;
    information = information
      .then(async () => {
        const observed = await kernelIdentity(Number(record["child-pid"]));
        if (
          !observed ||
          observed.namespace === ownerNamespace ||
          observed.pid === process.pid
        )
          throw unsupported();
        identityState.init = observed;
      })
      .catch(() => {
        bad = true;
        owner.end();
      });
  });
  // Same synchronous segment as spawn; no await before emergency registration.
  const runtime = registerOwnedAgentRuntime(epoch, async () => {
    owner.end();
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      await information;
      const init = identityState.init;
      let namespaceDestroyed = false;
      if (init) {
        const current = await kernelIdentity(init.pid);
        namespaceDestroyed =
          current === null ||
          current.start !== init.start ||
          current.namespace !== init.namespace;
      }
      if (closed && namespaceDestroyed) {
        await control.write(
          "stopped.json",
          JSON.stringify({
            runId,
            activeProcesses: 0,
            namespaceDestroyed: true,
            cleanupEvidence: stopped
              ? "guardian_and_kernel"
              : "kernel_namespace_destroyed",
          }),
        );
        return;
      }
      if (closed && spawnFailed && !child.pid && !ready && !init) {
        await control.write(
          "stopped.json",
          JSON.stringify({
            runId,
            activeProcesses: 0,
            namespaceDestroyed: true,
            cleanupEvidence: "not_launched",
          }),
        );
        return;
      }
      await sleep();
    }
    throw unverified();
  });
  try {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      await information;
      const init = identityState.init;
      assertLocalExecutionEpoch(epoch);
      if (bad || closed || spawnFailed) throw unsupported();
      if (ready && init) {
        await input.assertOwned();
        assertLocalExecutionEpoch(epoch);
        await control.write(
          "ready.json",
          JSON.stringify({
            runId,
            namespaceInitPid: init.pid,
            namespace: init.namespace,
            start: init.start,
          }),
        );
        return { child, namespaceInitPid: init.pid, stop: runtime.stop };
      }
      await sleep();
    }
    throw unsupported();
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}
