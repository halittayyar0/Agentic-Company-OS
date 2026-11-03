import { type ChildProcess, execFile } from "node:child_process";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  windowsPrivateHelperExecutable,
  parseWindowsDirectoryReceipt,
  type WindowsDirectoryReceipt,
} from "./windows-private-helper";

const executeFile = promisify(execFile);
const MAX_RECORD_BYTES = 128 * 1024;

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

export function windowsOwnerSid(identity: string): string {
  const sid = identity
    .trim()
    .match(/^"(?:[^"\r\n]|"")*","(S-1-\d+(?:-\d+){1,15})"$/u)?.[1];
  if (!sid) throw new Error("Cannot establish installation owner");
  return sid;
}

export function assertPrivateUnixMetadata(
  metadata: {
    uid: number;
    mode: number;
    isDirectory: boolean;
    isFile: boolean;
    isSymbolicLink: boolean;
  },
  owner: number,
  directory: boolean,
): void {
  if (
    metadata.uid !== owner ||
    metadata.isSymbolicLink ||
    (directory ? !metadata.isDirectory : !metadata.isFile) ||
    (metadata.mode & 0o777) !== (directory ? 0o700 : 0o600)
  ) {
    throw new Error("private_storage_protection_invalid");
  }
}

interface WindowsObjectIdentity {
  dev: bigint;
  ino: bigint;
}
const CREATED_DIRECTORY = Symbol("private-created-directory");
const CREATED = "ACOS_PRIVATE_STORAGE_CREATED ";

function identityFromReceipt(
  value: WindowsDirectoryReceipt,
): WindowsObjectIdentity {
  return { dev: BigInt(value.device), ino: BigInt(value.inode) };
}

/** Entire native validation/creation handshake retains the original deadline. */
async function windowsPrivateCommand(
  mode: "--check" | "--initialize-directory",
  environment: Record<string, string>,
): Promise<{ stdout: string; receipt?: WindowsDirectoryReceipt }> {
  let diagnostics:
    ReturnType<typeof beginWindowsStorageDiagnostics> | undefined;
  let pending:
    | (Promise<{ stdout: string; stderr: string }> & { child: ChildProcess })
    | undefined;
  let receipt: WindowsDirectoryReceipt | undefined;
  let protocolFailed = false;
  let tail = "";
  const onInputError = () => {
    protocolFailed = true;
    pending?.child?.kill();
  };
  const onReceipt = (chunk: Buffer | string) => {
    if (mode !== "--initialize-directory" || protocolFailed) return;
    tail += chunk.toString("utf8");
    if (tail.length > 16_384) {
      protocolFailed = true;
      pending?.child?.kill();
      return;
    }
    const start = tail.indexOf(CREATED);
    if (start < 0) return;
    const end = tail.indexOf("\n", start);
    if (end < 0) return;
    try {
      const value = parseWindowsDirectoryReceipt(
        tail.slice(start + CREATED.length, end),
      );
      if (receipt || !value.created) throw new Error("postcondition");
      // Synchronous assignment precedes ACK: a later child death cannot erase
      // our authority to remove only this unchanged, still-empty directory.
      receipt = value;
      tail = tail.slice(end + 1);
      pending!.child!.stdin!.end("COMMIT\n");
    } catch {
      protocolFailed = true;
      pending?.child?.kill();
    }
  };
  try {
    const executable = await windowsPrivateHelperExecutable();
    diagnostics = beginWindowsStorageDiagnostics();
    pending = executeFile(executable, [mode], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 16_384,
      env: environment,
    });
    diagnostics.attach(pending.child);
    pending.child?.stdin?.on("error", onInputError);
    if (mode === "--initialize-directory")
      pending.child?.stderr?.on("data", onReceipt);
    const { stdout, stderr } = await pending;
    const expectedStderr =
      START + (receipt ? CREATED + JSON.stringify(receipt) + "\n" : "");
    if (protocolFailed || stderr !== expectedStderr)
      throw new Error("postcondition");
    if (mode === "--check" && stdout !== "PRIVATE_OK")
      throw new Error("postcondition");
    if (mode === "--initialize-directory") {
      const final = parseWindowsDirectoryReceipt(stdout);
      if (
        final.created !== Boolean(receipt) ||
        (receipt && JSON.stringify(final) !== JSON.stringify(receipt))
      )
        throw new Error("postcondition");
    }
    return { stdout, receipt };
  } catch (error) {
    const failure = error as {
      code?: unknown;
      killed?: unknown;
      stderr?: unknown;
      message?: unknown;
    };
    if (
      mode === "--initialize-directory" &&
      failure.code === 17 &&
      !receipt &&
      !protocolFailed
    ) {
      throw Object.assign(new Error("Private storage already exists"), {
        code: "EEXIST",
      });
    }
    const knownHelperFailure =
      failure.message === "windows_private_storage_helper_unavailable" ||
      failure.message === "windows_private_storage_helper_invalid";
    const reason =
      protocolFailed ||
      failure.message === "postcondition" ||
      failure.message === "windows_private_storage_postcondition"
        ? "windows_private_storage_postcondition"
        : knownHelperFailure
          ? String(failure.message)
          : failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
            ? "windows_private_storage_output_limit"
            : failure.killed === true
              ? typeof failure.stderr === "string" &&
                failure.stderr.includes(START)
                ? "windows_private_storage_operation_timeout"
                : "windows_private_storage_startup_timeout"
              : failure.code === "ENOENT"
                ? "windows_private_storage_spawn_failed"
                : "windows_private_storage_check_failed";
    const result = new Error("private_storage_protection_invalid", {
      cause: new Error(
        reason,
        diagnostics
          ? {
              cause: new Error(
                formatWindowsStorageDiagnostics(diagnostics.finish()),
              ),
            }
          : undefined,
      ),
    });
    if (receipt)
      Object.defineProperty(result, CREATED_DIRECTORY, {
        value: identityFromReceipt(receipt),
      });
    throw result;
  } finally {
    pending?.child?.stderr?.removeListener("data", onReceipt);
    pending?.child?.stdin?.removeListener("error", onInputError);
    diagnostics?.finish();
  }
}

async function windowsProtection(
  target: string,
  directory: boolean,
  create: boolean,
  expected: WindowsObjectIdentity,
): Promise<void> {
  await windowsPrivateCommand("--check", {
    ACOS_PRIVATE_STORAGE_TARGET: target,
    ACOS_PRIVATE_STORAGE_DIRECTORY: directory ? "1" : "0",
    ACOS_PRIVATE_STORAGE_CREATE: create ? "1" : "0",
    ACOS_PRIVATE_STORAGE_DEVICE: expected.dev.toString(),
    ACOS_PRIVATE_STORAGE_INODE: expected.ino.toString(),
  });
}

async function initializeWindowsDirectory(target: string, exclusive: boolean) {
  const result = await windowsPrivateCommand("--initialize-directory", {
    ACOS_PRIVATE_STORAGE_TARGET: target,
    ACOS_PRIVATE_STORAGE_EXCLUSIVE: exclusive ? "1" : "0",
  });
  return parseWindowsDirectoryReceipt(result.stdout);
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/** Owner-private, bounded records. No caller may downgrade its protection. */
export class OwnerPrivateStorage {
  readonly directory: string;
  constructor(directory: string) {
    if (!path.isAbsolute(directory))
      throw new Error("private_storage_absolute_path_required");
    this.directory = path.resolve(directory);
  }

  private recordPath(name: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/u.test(name))
      throw new Error("private_storage_record_name_invalid");
    return path.join(this.directory, name);
  }

  private async assertProtected(
    target: string,
    directory: boolean,
  ): Promise<void> {
    const stat = await lstat(target);
    if (
      stat.isSymbolicLink() ||
      (directory ? !stat.isDirectory() : !stat.isFile()) ||
      !samePath(await realpath(target), target)
    )
      throw new Error("private_storage_path_invalid");
    if (process.platform === "win32") {
      await windowsProtection(
        target,
        directory,
        false,
        await lstat(target, { bigint: true }),
      );
    } else {
      if (!process.getuid) throw new Error("private_storage_owner_unavailable");
      assertPrivateUnixMetadata(
        {
          uid: stat.uid,
          mode: stat.mode,
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          isSymbolicLink: stat.isSymbolicLink(),
        },
        process.getuid(),
        directory,
      );
    }
  }

  async initialize(exclusive = false): Promise<void> {
    const parent = path.dirname(this.directory);
    if (!samePath(await realpath(parent), parent))
      throw new Error("private_storage_parent_redirected");
    let createdMetadata: WindowsObjectIdentity | undefined;
    try {
      if (process.platform === "win32") {
        const result = await initializeWindowsDirectory(
          this.directory,
          exclusive,
        );
        const expected = identityFromReceipt(result);
        if (result.created) createdMetadata = expected;
        const actual = await lstat(this.directory, { bigint: true });
        if (actual.dev !== expected.dev || actual.ino !== expected.ino)
          throw new Error("private_storage_path_invalid");
      } else {
        try {
          await mkdir(this.directory, { mode: 0o700 });
          createdMetadata = await lstat(this.directory, { bigint: true });
        } catch (error) {
          if (exclusive || (error as NodeJS.ErrnoException).code !== "EEXIST")
            throw error;
        }
      }
      await this.assertProtected(this.directory, true);
    } catch (error) {
      createdMetadata ??= (
        error as { [CREATED_DIRECTORY]?: WindowsObjectIdentity }
      )[CREATED_DIRECTORY];
      if (createdMetadata) {
        try {
          const current = await lstat(this.directory, { bigint: true });
          if (
            current.dev === createdMetadata.dev &&
            current.ino === createdMetadata.ino &&
            current.isDirectory() &&
            !current.isSymbolicLink()
          )
            // Remove only this attempt's still-empty directory. Never remove
            // contents or repair an existing vault's permissions on failure.
            await rmdir(this.directory);
        } catch {
          /* Retain anything that cannot be proved safe to remove. */
        }
      }
      throw error;
    }
  }

  async read(name: string): Promise<string | null> {
    await this.assertProtected(this.directory, true);
    const target = this.recordPath(name);
    try {
      await this.assertProtected(target, false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const handle = await open(target, "r");
    try {
      if ((await handle.stat()).size > MAX_RECORD_BYTES)
        throw new Error("private_storage_record_too_large");
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  }

  async write(name: string, value: string): Promise<void> {
    if (Buffer.byteLength(value, "utf8") > MAX_RECORD_BYTES)
      throw new Error("private_storage_record_too_large");
    await this.assertProtected(this.directory, true);
    const target = this.recordPath(name);
    try {
      await this.assertProtected(target, false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = this.recordPath(`tmp-${randomUUID()}`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      // Elevated Windows tokens can create files owned by Administrators.
      // Protect only this new empty file before any secret bytes are written.
      if (process.platform === "win32")
        await windowsProtection(
          temporary,
          false,
          true,
          await handle.stat({ bigint: true }),
        );
      await this.assertProtected(temporary, false);
      await handle.writeFile(value, "utf8");
      await handle.sync();
      await handle.close();
      await this.assertProtected(this.directory, true);
      await rename(temporary, target);
      if (process.platform !== "win32") {
        const directory = await open(this.directory, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } finally {
      await handle.close();
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  /** O_EXCL is the cross-process authority; a stale lock never expires by time. */
  async withLock<T>(
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const deadline = Date.now() + 30_000;
    const target = this.recordPath("registration.lock");
    let handle;
    while (!handle) {
      signal?.throwIfAborted();
      await this.assertProtected(this.directory, true);
      try {
        handle = await open(target, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // The owner may release the lock between EEXIST and observation.
        // Never run a slow ACL subprocess against this disappearing marker;
        // no contents are read. The containing directory is already protected.
        try {
          const marker = await lstat(target);
          if (!marker.isFile() || marker.isSymbolicLink())
            throw new Error("private_storage_lock_invalid");
        } catch (observationError) {
          if ((observationError as NodeJS.ErrnoException).code === "ENOENT")
            continue;
          throw observationError;
        }
        if (Date.now() >= deadline)
          throw new Error("private_storage_lock_unavailable");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    try {
      if (process.platform === "win32")
        await windowsProtection(
          target,
          false,
          true,
          await handle.stat({ bigint: true }),
        );
      await this.assertProtected(target, false);
      return await action();
    } finally {
      await handle.close();
      await unlink(target);
    }
  }
}
