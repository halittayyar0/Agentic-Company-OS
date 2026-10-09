import { spawn } from "node:child_process";
import { resolveProcessLaunch } from "./process-launch";
import { stopOwnedAgentRuntimes } from "../orchestrator/owned-agent-runtimes";
import type { WorkspaceLocale } from "../workspace-locale";
import type { TerminalMessage } from "./terminal-copy";
import { getTerminalCopy, terminalMessage } from "./terminal-localization";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  approvalRequestsTable,
  db,
  dbReady,
  tasksTable,
} from "@workspace/db";
import { isCanonicalRootCeo } from "../orchestrator/agent-authority";
import { canonicalArgumentHash } from "../orchestrator/operation-receipts";
import {
  activateLocalEmergencyStop,
  assertLocalExecutionEpoch,
  captureLocalExecutionEpoch,
} from "../orchestrator/local-emergency-epoch";
import {
  withFileOperationLock,
  type FileEffectHook,
} from "./file-operation-lock";

/**
 * Per-agent virtual computer.
 *
 * Every agent owns a workspace directory with path-safe, in-process file
 * commands. Spawning host binaries is deliberately disabled by default:
 * process allowlists are not an OS security boundary and a Node/Python script
 * can otherwise reach the host filesystem. Operators may opt in only when the
 * whole service already runs inside a hardened container/VM.
 */

const MAX_LIST_ENTRIES = 2000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_BINARY_FILE_BYTES = 10 * 1024 * 1024;
const MAX_READ_BYTES = 128 * 1024;
const MAX_OUTPUT_CHARS = 48 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

type BeforeEffectHook = FileEffectHook;

let cachedBase: string | null = null;
const sandboxWorkingDirectories = new Map<number, string>();
const sandboxCommandQueues = new Map<number, Promise<void>>();
const activeAgentProcesses = new Set<ReturnType<typeof spawn>>();
let agentProcessStopGeneration = 0;
const AGENT_PROCESS_TERMINATION_GRACE_MS = 1_500;

/**
 * Windows may report EPIPE/ECONNRESET/ECONNABORTED on a child stdio pipe when
 * taskkill tears down the process tree. Those are operation-local failures;
 * leaving any of the three streams without an error listener would promote a
 * normal emergency-stop race into an uncaught exception for the API process.
 */
export function guardChildProcessPipes(
  child: Pick<ReturnType<typeof spawn>, "stdin" | "stdout" | "stderr">,
  onError: (error: NodeJS.ErrnoException) => void = () => undefined,
): void {
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream?.on("error", (error: NodeJS.ErrnoException) => onError(error));
  }
}

function childPipeFailureNote(
  error: NodeJS.ErrnoException | null,
): string | null {
  if (!error) return null;
  const code =
    typeof error.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : "IO_ERROR";
  return `pipe-error: ${code}`;
}

/**
 * Terminates the whole process tree owned by an autonomous agent command.
 * A signal sent only to the immediate shell/interpreter is insufficient:
 * spawned descendants can otherwise survive an emergency stop or timeout.
 *
 * Founder shell processes are never registered in `activeAgentProcesses` and
 * deliberately remain an operator recovery channel.
 */
function terminateAgentProcessTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid;
  if (!pid) {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process may already have exited.
    }
    return;
  }

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
    const taskkill = systemRoot
      ? path.join(systemRoot, "System32", "taskkill.exe")
      : "taskkill.exe";
    try {
      const killer = spawn(taskkill, ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      const fallback = () => {
        try {
          child.kill("SIGTERM");
        } catch {
          // Best effort; persisted execution gates remain authoritative.
        }
      };
      killer.once("error", fallback);
      killer.once("close", (code) => {
        if (code !== 0) fallback();
      });
      killer.unref();
      return;
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // Best effort; persisted execution gates remain authoritative.
      }
      return;
    }
  }

  try {
    // Agent commands are launched as process-group leaders on POSIX.
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process may already have exited.
    }
  }

  const forceTimer = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process group is already gone.
      }
    }
  }, AGENT_PROCESS_TERMINATION_GRACE_MS);
  forceTimer.unref();
}

/**
 * Emergency-stop cleanup for autonomous agent processes. Founder/operator
 * shell processes are deliberately outside this set so the operator retains a
 * recovery channel. A generation bump also cancels commands that were queued
 * behind another agent command but had not spawned yet.
 */
export function stopAllAgentProcesses(): number {
  activateLocalEmergencyStop();
  agentProcessStopGeneration += 1;
  const active = [...activeAgentProcesses];
  for (const child of active) {
    terminateAgentProcessTree(child);
  }
  return active.length + stopOwnedAgentRuntimes();
}

function findWorkspaceRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function getSandboxBaseDir(): string {
  cachedBase ??= path.resolve(
    process.env.AGENT_SANDBOX_ROOT ??
      path.join(findWorkspaceRoot(), "agent-sandboxes"),
  );
  return cachedBase;
}

export function getSandboxRoot(agentId: number): string {
  if (!Number.isSafeInteger(agentId) || agentId <= 0 || agentId > 2147483647)
    throw new VmError("Invalid workspace identity", {
      key: "invalidWorkspace",
    });
  return path.join(getSandboxBaseDir(), `agent-${agentId}`);
}

export async function ensureSandbox(
  agentId: number,
  beforeEffect?: BeforeEffectHook,
): Promise<string> {
  const root = getSandboxRoot(agentId);
  if (beforeEffect?.revalidate) {
    const executionEpoch = captureLocalExecutionEpoch();
    await beforeEffect.revalidate();
    assertLocalExecutionEpoch(executionEpoch);
  }
  await fsp.mkdir(root, { recursive: true });
  return root;
}

/**
 * Resolves a user/agent supplied relative path against the sandbox root,
 * refusing any attempt to escape it. Returns the absolute path + normalized
 * relative form (always POSIX-styled for UI stability).
 */
export function safeResolve(
  agentId: number,
  relPath: string | undefined | null,
): { abs: string; rel: string } {
  const root = getSandboxRoot(agentId);
  const supplied = relPath ?? "";
  if (supplied !== supplied.trim()) {
    throw new VmError(`Guvensiz yol reddedildi: "${supplied}"`, {
      key: "unsafePath",
      params: { path: supplied },
    });
  }
  const raw = supplied.replace(/\\/g, "/");
  if (!raw || raw === "." || raw === "./" || raw === "/") {
    return { abs: root, rel: "" };
  }
  const cleaned = raw.replace(/^\/+/, "");
  const abs = path.resolve(root, cleaned);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw new VmError(`Guvensiz yol reddedildi: "${raw}"`, {
      key: "unsafePath",
      params: { path: raw },
    });
  }
  const rel = path
    .relative(root, abs)
    .split(path.sep)
    .filter((p) => p.length > 0)
    .join("/");
  return { abs, rel };
}

export class VmError extends Error {
  constructor(
    message: string,
    readonly terminalMessage?: TerminalMessage,
  ) {
    super(message);
  }
}

/** Only app-owned typed errors are translated. Native errors remain source. */
export function localizedVmErrorMessage(
  error: unknown,
  locale: WorkspaceLocale,
  fallback: string,
): string {
  if (error instanceof VmError && error.terminalMessage) {
    return terminalMessage(
      locale,
      error.terminalMessage.key,
      error.terminalMessage.params,
    );
  }
  return error instanceof Error ? error.message : fallback;
}

export class VmFileMissingError extends VmError {
  readonly code = "VM_FILE_MISSING";
}

export class VmFileEditError extends VmError {
  constructor(
    readonly code:
      "VM_FILE_CHANGED" | "VM_FILE_NOT_EDITABLE" | "VM_FILE_VERSION_REQUIRED",
  ) {
    const keys = {
      VM_FILE_CHANGED: "fileChanged",
      VM_FILE_NOT_EDITABLE: "fileNotEditable",
      VM_FILE_VERSION_REQUIRED: "fileVersionRequired",
    } as const;
    super(code, { key: keys[code] });
  }
}

export class VmDeleteReviewError extends VmError {
  constructor(
    readonly code:
      | "VM_DELETE_CHANGED"
      | "VM_DELETE_MISSING"
      | "VM_DELETE_NOT_REVIEWABLE"
      | "VM_DELETE_VERSION_REQUIRED",
  ) {
    const keys = {
      VM_DELETE_CHANGED: "deleteChanged",
      VM_DELETE_MISSING: "deleteMissing",
      VM_DELETE_NOT_REVIEWABLE: "deleteNotReviewable",
      VM_DELETE_VERSION_REQUIRED: "deleteVersionRequired",
    } as const;
    super(code, { key: keys[code] });
  }
}

export interface VmDeletionPreview {
  path: string;
  version: string;
  entryCount: number;
  totalBytes: number;
  entries: { path: string; type: "file" | "directory"; sizeBytes: number }[];
}

// The manifest is complete, never a sample. Reject a scope that cannot be
// inspected within these limits instead of enabling a blind recursive delete.
const DELETE_REVIEW_MAX_ENTRIES = 1000;
const DELETE_REVIEW_MAX_BYTES = 64 * 1024 * 1024;
const DELETE_REVIEW_MAX_DEPTH = 32;
const DELETE_REVIEW_MAX_MS = 5000;

async function inspectDeletion(
  agentId: number,
  abs: string,
  rel: string,
): Promise<VmDeletionPreview> {
  const deadline = Date.now() + DELETE_REVIEW_MAX_MS;
  const entries: VmDeletionPreview["entries"] = [];
  const fingerprints: { path: string; value: string }[] = [];
  let totalBytes = 0;
  const limited = () => {
    if (Date.now() > deadline)
      throw new VmDeleteReviewError("VM_DELETE_NOT_REVIEWABLE");
  };
  const identity = (stat: fs.Stats) =>
    JSON.stringify([
      stat.dev,
      stat.ino,
      stat.mode,
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs,
    ]);
  async function visit(target: string, relative: string, depth: number) {
    limited();
    if (
      depth > DELETE_REVIEW_MAX_DEPTH ||
      entries.length >= DELETE_REVIEW_MAX_ENTRIES ||
      relative.length > 2048
    )
      throw new VmDeleteReviewError("VM_DELETE_NOT_REVIEWABLE");
    await assertNoSymlinkPath(agentId, target);
    const before = await fsp.lstat(target);
    if (!before.isFile() && !before.isDirectory())
      throw new VmDeleteReviewError("VM_DELETE_NOT_REVIEWABLE");
    const type = before.isDirectory() ? "directory" : "file";
    entries.push({
      path: relative,
      type,
      sizeBytes: type === "file" ? before.size : 0,
    });
    let digest = "";
    if (type === "directory") {
      // opendir bounds enumeration memory even for an oversized directory.
      const directory = await fsp.opendir(target);
      for await (const child of directory) {
        await visit(
          path.join(target, child.name),
          `${relative}/${child.name}`,
          depth + 1,
        );
      }
    } else {
      if (totalBytes + before.size > DELETE_REVIEW_MAX_BYTES)
        throw new VmDeleteReviewError("VM_DELETE_NOT_REVIEWABLE");
      const file = await fsp.open(
        target,
        fs.constants.O_RDONLY |
          (process.platform === "win32"
            ? 0
            : fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK),
      );
      try {
        const opened = await file.stat();
        if (!opened.isFile() || identity(opened) !== identity(before))
          throw new VmDeleteReviewError("VM_DELETE_CHANGED");
        const hash = createHash("sha256");
        const buffer = Buffer.alloc(64 * 1024);
        let length = 0;
        while (true) {
          limited();
          const { bytesRead } = await file.read(
            buffer,
            0,
            buffer.length,
            length,
          );
          if (!bytesRead) break;
          totalBytes += bytesRead;
          length += bytesRead;
          if (totalBytes > DELETE_REVIEW_MAX_BYTES)
            throw new VmDeleteReviewError("VM_DELETE_NOT_REVIEWABLE");
          hash.update(buffer.subarray(0, bytesRead));
        }
        if (
          length !== before.size ||
          identity(await file.stat()) !== identity(before)
        )
          throw new VmDeleteReviewError("VM_DELETE_CHANGED");
        digest = hash.digest("hex");
      } finally {
        await file.close();
      }
    }
    await assertNoSymlinkPath(agentId, target);
    if (identity(await fsp.lstat(target)) !== identity(before))
      throw new VmDeleteReviewError("VM_DELETE_CHANGED");
    fingerprints.push({
      path: relative,
      value: JSON.stringify([relative, type, identity(before), digest]),
    });
  }
  try {
    // Distinguish an absent target from a tree that changes during inspection.
    await fsp.lstat(abs).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR")
        throw new VmDeleteReviewError("VM_DELETE_MISSING");
      throw error;
    });
    await visit(abs, rel, 0);
    limited();
  } catch (error) {
    if (error instanceof VmDeleteReviewError) throw error;
    // Do not expose host paths, symlink targets, or filesystem error details.
    throw new VmDeleteReviewError("VM_DELETE_NOT_REVIEWABLE");
  }
  const byPath = (a: { path: string }, b: { path: string }) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  entries.sort(byPath);
  fingerprints.sort(byPath);
  const version = createHash("sha256")
    .update(JSON.stringify([agentId, rel, fingerprints]))
    .digest("hex");
  return {
    path: rel,
    version,
    entryCount: entries.length,
    totalBytes,
    entries,
  };
}

export async function previewDeletion(
  agentId: number,
  relPath: string,
): Promise<VmDeletionPreview> {
  const { abs, rel } = safeResolve(agentId, relPath);
  if (!rel) throw new VmDeleteReviewError("VM_DELETE_NOT_REVIEWABLE");
  return withFileOperationLock(agentId, () =>
    inspectDeletion(agentId, abs, rel),
  );
}

const fileVersion = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function editableBytes(bytes: Buffer): boolean {
  return (
    bytes.length <= MAX_READ_BYTES &&
    !bytes.includes(0) &&
    Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)
  );
}

async function readFileBytes(abs: string): Promise<Buffer> {
  const before = await fsp.lstat(abs);
  if (!before.isFile())
    throw new VmError("Only regular files can be read.", {
      key: "regularFileReadOnly",
    });
  const file = await fsp.open(
    abs,
    fs.constants.O_RDONLY |
      (process.platform === "win32"
        ? 0
        : fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK),
  );
  try {
    const stat = await file.stat();
    const leaf = await fsp.lstat(abs);
    if (
      !stat.isFile() ||
      leaf.isSymbolicLink() ||
      stat.dev !== before.dev ||
      stat.ino !== before.ino ||
      stat.dev !== leaf.dev ||
      stat.ino !== leaf.ino
    )
      throw new VmError("Only regular files can be read.", {
        key: "regularFileReadOnly",
      });
    if (stat.size > MAX_FILE_BYTES)
      throw new VmError("File exceeds the read limit.", { key: "readLimit" });
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await file.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > MAX_FILE_BYTES)
      throw new VmError("File exceeds the read limit.", { key: "readLimit" });
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}

/** Same-directory replacement keeps a failed or interrupted write from
 * exposing a partially overwritten file. A missing-only publication uses
 * link rather than rename so an independently created target cannot be lost.
 */
async function publishFile(
  agentId: number,
  abs: string,
  bytes: Buffer,
  executionEpoch: number,
  missingOnly = false,
  revalidate?: () => Promise<void>,
): Promise<void> {
  await assertNoSymlinkPath(agentId, abs);
  await revalidate?.();
  assertLocalExecutionEpoch(executionEpoch);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await assertNoSymlinkPath(agentId, abs);
  const existing = await fsp
    .lstat(abs)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  const temporary = path.join(
    path.dirname(abs),
    `.acos-write-${randomUUID()}.tmp`,
  );
  try {
    await revalidate?.();
    assertLocalExecutionEpoch(executionEpoch);
    const file = await fsp.open(temporary, "wx", 0o600);
    try {
      await revalidate?.();
      assertLocalExecutionEpoch(executionEpoch);
      await file.writeFile(bytes);
      if (existing?.isFile() && process.platform !== "win32")
        await file.chmod(existing.mode & 0o777);
      await file.sync();
    } finally {
      await file.close();
    }
    await assertNoSymlinkPath(agentId, abs);
    await revalidate?.();
    assertLocalExecutionEpoch(executionEpoch);
    if (missingOnly) {
      try {
        await fsp.link(temporary, abs);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new VmFileEditError("VM_FILE_CHANGED");
        throw error;
      }
    } else await fsp.rename(temporary, abs);
    if (process.platform !== "win32") {
      const directory = await fsp.open(
        path.dirname(abs),
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
      );
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } finally {
    // Only this operation's unique temporary file; never recurse or remove
    // the destination on failure. A crash can leave an orphan temp file.
    await fsp.unlink(temporary).catch(() => undefined);
  }
}

/**
 * Refuse pre-existing symbolic links anywhere below an agent root. This is a
 * second boundary behind lexical safeResolve; without it, a link created by
 * the operator (or by an explicitly enabled host process) could redirect a
 * later file operation outside the sandbox.
 */
async function assertNoSymlinkPath(
  agentId: number,
  abs: string,
): Promise<void> {
  const root = getSandboxRoot(agentId);
  const segments = path.relative(root, abs).split(path.sep).filter(Boolean);
  let cursor = root;

  const rootStat = await fsp.lstat(root).catch(() => null);
  if (rootStat?.isSymbolicLink()) {
    throw new VmError("Ajan calisma alani sembolik bag olamaz.", {
      key: "workspaceSymlink",
    });
  }

  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const stat = await fsp.lstat(cursor).catch(() => null);
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      throw new VmError(
        `Sembolik bag yolu reddedildi: ${path.relative(root, cursor)}`,
        { key: "pathSymlink", params: { path: path.relative(root, cursor) } },
      );
    }
  }
}

async function resolveWorkingDirectory(
  agentId: number,
  beforeEffect?: BeforeEffectHook,
): Promise<{ abs: string; rel: string }> {
  await ensureSandbox(agentId, beforeEffect);
  const remembered = sandboxWorkingDirectories.get(agentId) ?? "";
  let resolved = safeResolve(agentId, remembered);
  await assertNoSymlinkPath(agentId, resolved.abs);
  const stat = await fsp.stat(resolved.abs).catch(() => null);
  if (!stat?.isDirectory()) {
    sandboxWorkingDirectories.delete(agentId);
    resolved = safeResolve(agentId, "");
  }
  return resolved;
}

async function resolveFromWorkingDirectory(
  agentId: number,
  target: string | undefined | null,
  beforeEffect?: BeforeEffectHook,
): Promise<{ abs: string; rel: string }> {
  const cwd = await resolveWorkingDirectory(agentId, beforeEffect);
  const raw = (target ?? "").trim().replace(/\\/g, "/");
  const candidate = raw.startsWith("/")
    ? raw
    : path.posix.join(cwd.rel || ".", raw || ".");
  const resolved = safeResolve(agentId, candidate);
  await assertNoSymlinkPath(agentId, resolved.abs);
  return resolved;
}

export async function getSandboxWorkingDirectory(
  agentId: number,
  beforeEffect?: BeforeEffectHook,
): Promise<string> {
  const cwd = await resolveWorkingDirectory(agentId, beforeEffect);
  return `/${cwd.rel}`.replace(/\/$/, "") || "/";
}

async function changeSandboxWorkingDirectory(
  agentId: number,
  target: string | undefined,
  executionEpoch: number,
  beforeEffect?: BeforeEffectHook,
): Promise<string> {
  const resolved = await resolveFromWorkingDirectory(
    agentId,
    target || "/",
    beforeEffect,
  );
  const stat = await fsp.stat(resolved.abs).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new VmError(`Dizin bulunamadi: ${target || "/"}`, {
      key: "directoryMissing",
      params: { path: target || "/" },
    });
  }
  assertLocalExecutionEpoch(executionEpoch);
  await beforeEffect?.();
  assertLocalExecutionEpoch(executionEpoch);
  await assertNoSymlinkPath(agentId, resolved.abs);
  const currentStat = await fsp.stat(resolved.abs).catch(() => null);
  if (!currentStat?.isDirectory()) {
    throw new VmError(`Dizin bulunamadi: ${target || "/"}`, {
      key: "directoryMissing",
      params: { path: target || "/" },
    });
  }
  await beforeEffect?.revalidate?.();
  assertLocalExecutionEpoch(executionEpoch);
  sandboxWorkingDirectories.set(agentId, resolved.rel);
  return `/${resolved.rel}`.replace(/\/$/, "") || "/";
}

export interface VmEntryInfo {
  name: string;
  path: string;
  type: "file" | "directory";
  sizeBytes: number;
  updatedAt: Date;
}

function toPosixRel(relSegments: string[]): string {
  return relSegments.filter(Boolean).join("/");
}

export async function listDirectory(
  agentId: number,
  relPath?: string | null,
  beforeEffect?: BeforeEffectHook,
): Promise<{
  path: string;
  entries: VmEntryInfo[];
  total: number;
  truncated: boolean;
  skipped: number;
}> {
  const { abs, rel } = safeResolve(agentId, relPath);
  await ensureSandbox(agentId, beforeEffect);
  await assertNoSymlinkPath(agentId, abs);

  let directory;
  try {
    directory = await fsp.opendir(abs);
  } catch {
    throw new VmError(`Dizin okunamadi: ${rel || "/"}`, {
      key: "directoryUnreadable",
      params: { path: rel || "/" },
    });
  }

  const entries: VmEntryInfo[] = [];
  let examined = 0;
  let skipped = 0;
  let truncated = false;
  for await (const dirent of directory) {
    if (examined >= MAX_LIST_ENTRIES) {
      truncated = true;
      break;
    }
    examined++;
    const childRelSegments = [...(rel ? [rel] : []), dirent.name];
    try {
      const childPath = toPosixRel(childRelSegments);
      if (
        childPath.length > 2048 ||
        safeResolve(agentId, childPath).rel !== childPath
      ) {
        skipped++;
        continue;
      }
      const stat = await fsp.lstat(path.join(abs, dirent.name));
      if (!stat.isFile() && !stat.isDirectory()) {
        skipped++;
        continue;
      }
      entries.push({
        name: dirent.name,
        path: childPath,
        type: stat.isDirectory() ? "directory" : "file",
        sizeBytes: Number(stat.size),
        updatedAt: stat.mtime,
      });
    } catch {
      skipped++;
    }
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { path: rel, entries, total: entries.length, truncated, skipped };
}

export async function readTextFile(
  agentId: number,
  relPath: string | null | undefined,
  beforeEffect?: BeforeEffectHook,
): Promise<{
  path: string;
  content: string;
  sizeBytes: number;
  truncated: boolean;
  version: string;
  editable: boolean;
}> {
  if (!relPath || !relPath.trim())
    throw new VmError("Dosya yolu gerekli.", { key: "filePathRequired" });
  const { abs, rel } = safeResolve(agentId, relPath);
  await ensureSandbox(agentId, beforeEffect);
  await assertNoSymlinkPath(agentId, abs);
  const buf = await readFileBytes(abs).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR")
      throw new VmFileMissingError(`Dosya bulunamadi: ${rel}`, {
        key: "fileMissing",
        params: { path: rel },
      });
    if (error.code === "EACCES" || error.code === "EPERM")
      throw new VmError(`Dosya okunamadi: ${rel}`, {
        key: "fileUnreadable",
        params: { path: rel },
      });
    throw error;
  });
  const truncated = buf.byteLength > MAX_READ_BYTES;
  const content = buf.subarray(0, MAX_READ_BYTES).toString("utf8");
  return {
    path: rel,
    content,
    sizeBytes: buf.byteLength,
    truncated,
    version: fileVersion(buf),
    editable: editableBytes(buf),
  };
}

export async function writeTextFile(
  agentId: number,
  relPath: string | null | undefined,
  content: string,
  executionEpoch = captureLocalExecutionEpoch(),
  beforeEffect?: BeforeEffectHook,
  review?: { expectedVersion: string },
): Promise<{ path: string; sizeBytes: number; version: string }> {
  if (!relPath || !relPath.trim())
    throw new VmError("Dosya yolu gerekli.", { key: "filePathRequired" });
  const { abs, rel } = safeResolve(agentId, relPath);
  const payload = Buffer.from(content ?? "", "utf8");
  if (!rel)
    throw new VmError("Workspace root cannot be replaced by a file.", {
      key: "rootReplaceDenied",
    });
  if (payload.byteLength > MAX_FILE_BYTES) {
    throw new VmError(`Icerik cok buyuk (sinir ${MAX_FILE_BYTES} bayt).`, {
      key: "contentTooLarge",
      params: { bytes: MAX_FILE_BYTES },
    });
  }
  if (
    review &&
    review.expectedVersion !== "missing" &&
    !/^[a-f0-9]{64}$/.test(review.expectedVersion)
  )
    throw new VmFileEditError("VM_FILE_VERSION_REQUIRED");
  if (
    review &&
    (!editableBytes(payload) || payload.toString("utf8") !== content)
  )
    throw new VmFileEditError("VM_FILE_NOT_EDITABLE");
  assertLocalExecutionEpoch(executionEpoch);
  await ensureSandbox(agentId, beforeEffect);
  await assertNoSymlinkPath(agentId, abs);
  assertLocalExecutionEpoch(executionEpoch);
  await beforeEffect?.();
  assertLocalExecutionEpoch(executionEpoch);
  return withFileOperationLock(agentId, async (tx) => {
    await assertNoSymlinkPath(agentId, abs);
    if (review) {
      const existing = await fsp
        .lstat(abs)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (review.expectedVersion === "missing") {
        if (existing) throw new VmFileEditError("VM_FILE_CHANGED");
      } else {
        if (!existing?.isFile()) throw new VmFileEditError("VM_FILE_CHANGED");
        const bytes = await readFileBytes(abs);
        if (fileVersion(bytes) !== review.expectedVersion)
          throw new VmFileEditError("VM_FILE_CHANGED");
        if (!editableBytes(bytes))
          throw new VmFileEditError("VM_FILE_NOT_EDITABLE");
      }
    }
    assertLocalExecutionEpoch(executionEpoch);
    await publishFile(
      agentId,
      abs,
      payload,
      executionEpoch,
      review?.expectedVersion === "missing",
      () => beforeEffect?.revalidate?.(tx) ?? Promise.resolve(),
    );
    return {
      path: rel,
      sizeBytes: payload.byteLength,
      version: fileVersion(payload),
    };
  });
}

export async function writeBinaryFile(
  agentId: number,
  relPath: string | null | undefined,
  content: Buffer,
  executionEpoch = captureLocalExecutionEpoch(),
  beforeEffect?: BeforeEffectHook,
): Promise<{ path: string; sizeBytes: number }> {
  if (!relPath || !relPath.trim())
    throw new VmError("Dosya yolu gerekli.", { key: "filePathRequired" });
  const { abs, rel } = safeResolve(agentId, relPath);
  if (!rel)
    throw new VmError("Workspace root cannot be replaced by a file.", {
      key: "rootReplaceDenied",
    });
  if (content.byteLength > MAX_BINARY_FILE_BYTES) {
    throw new VmError(
      `Binary icerik cok buyuk (sinir ${MAX_BINARY_FILE_BYTES} bayt).`,
      { key: "binaryTooLarge", params: { bytes: MAX_BINARY_FILE_BYTES } },
    );
  }
  assertLocalExecutionEpoch(executionEpoch);
  await ensureSandbox(agentId, beforeEffect);
  await assertNoSymlinkPath(agentId, abs);
  assertLocalExecutionEpoch(executionEpoch);
  await beforeEffect?.();
  assertLocalExecutionEpoch(executionEpoch);
  await withFileOperationLock(agentId, (tx) =>
    publishFile(
      agentId,
      abs,
      content,
      executionEpoch,
      false,
      () => beforeEffect?.revalidate?.(tx) ?? Promise.resolve(),
    ),
  );
  return { path: rel, sizeBytes: content.byteLength };
}

export async function deleteEntry(
  agentId: number,
  relPath: string | null | undefined,
  executionEpoch = captureLocalExecutionEpoch(),
  beforeEffect?: BeforeEffectHook,
  review?: { expectedVersion: string },
): Promise<{ path: string; deleted: boolean }> {
  if (review && !/^[a-f0-9]{64}$/.test(review.expectedVersion))
    throw new VmDeleteReviewError("VM_DELETE_VERSION_REQUIRED");
  if (!relPath || !relPath.trim())
    throw new VmError("Yol gerekli.", { key: "pathRequired" });
  const { abs, rel } = safeResolve(agentId, relPath);
  if (abs === getSandboxRoot(agentId)) {
    throw new VmError("Calisma alani koku silinemez.", {
      key: "rootDeleteDenied",
    });
  }
  assertLocalExecutionEpoch(executionEpoch);
  await ensureSandbox(agentId, beforeEffect);
  await assertNoSymlinkPath(agentId, abs);
  assertLocalExecutionEpoch(executionEpoch);
  await beforeEffect?.();
  assertLocalExecutionEpoch(executionEpoch);
  await withFileOperationLock(agentId, async (tx) => {
    await assertNoSymlinkPath(agentId, abs);
    if (review) {
      const current = await inspectDeletion(agentId, abs, rel);
      if (current.version !== review.expectedVersion)
        throw new VmDeleteReviewError("VM_DELETE_CHANGED");
    }
    await beforeEffect?.revalidate?.(tx);
    assertLocalExecutionEpoch(executionEpoch);
    await fsp.rm(abs, { recursive: true, force: !review });
  });
  return { path: rel, deleted: true };
}

export interface VmSummary {
  agentId: number;
  workspaceId: string;
  lifecycle: "not_created" | "ready";
  isolation: "filesystem_sandbox";
  persistent: boolean;
  processExecutionEnabled: boolean;
  exists: boolean;
  cwd: string;
  totalBytes: number;
  fileCount: number;
  dirCount: number;
}

export async function getVmStatus(agentId: number): Promise<VmSummary> {
  const root = getSandboxRoot(agentId);
  const summary: VmSummary = {
    agentId,
    workspaceId: `agent-${agentId}`,
    lifecycle: "not_created",
    isolation: "filesystem_sandbox",
    persistent: true,
    processExecutionEnabled: isAgentProcessExecEnabled(),
    exists: false,
    cwd: "/",
    totalBytes: 0,
    fileCount: 0,
    dirCount: 0,
  };

  let visitedEntries = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 10 || visitedEntries >= MAX_LIST_ENTRIES) return;
    const dirents = await fsp
      .readdir(dir, { withFileTypes: true })
      .catch(() => []);
    for (const d of dirents.slice(0, MAX_LIST_ENTRIES)) {
      if (++visitedEntries > MAX_LIST_ENTRIES) return;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        summary.dirCount++;
        await walk(full, depth + 1);
      } else if (d.isFile()) {
        summary.fileCount++;
        const st = await fsp.stat(full).catch(() => null);
        summary.totalBytes += st?.size ?? 0;
      }
    }
  };

  if (!fs.existsSync(root)) return summary;
  await assertNoSymlinkPath(agentId, root);
  summary.exists = true;
  summary.lifecycle = "ready";
  summary.cwd = await getSandboxWorkingDirectory(agentId);
  await walk(root, 0);
  summary.totalBytes = Math.min(summary.totalBytes, Number.MAX_SAFE_INTEGER);
  return summary;
}

// ---------------------------------------------------------------------------
// Sandboxed shell
// ---------------------------------------------------------------------------

interface CommandSpec {
  binary: string;
  /** platform-specific binary resolution (e.g. npm -> npm.cmd on Windows) */
  win32Alias?: string;
}

/** Executables agents may spawn inside their sandbox. */
const SPAWNABLE: Record<string, CommandSpec> = {
  node: { binary: "node" },
  npm: { binary: "npm", win32Alias: "npm.cmd" },
  npx: { binary: "npx", win32Alias: "npx.cmd" },
  pnpm: { binary: "pnpm", win32Alias: "pnpm.cmd" },
  python: { binary: "python", win32Alias: "python.exe" },
  python3: { binary: "python3", win32Alias: "python.exe" },
  git: { binary: "git" },
};

/**
 * Host process execution is unsafe without an outer container/VM boundary.
 * Keep the secure default even for local development; explicit opt-in makes
 * the risk visible in deployment configuration and documentation.
 */
export function isAgentProcessExecEnabled(): boolean {
  return process.env.ALLOW_AGENT_PROCESS_EXEC === "true";
}

/** Characters that enable chaining/redirection/injection tricks. */
const FORBIDDEN_CHARS = /[&|<>^`$;"'\\\n\r]/;

/** Built-in virtual commands implemented in-process (no OS process). */
interface BuiltinResult {
  stdout: string;
  stderr?: string;
}

async function runBuiltin(
  agentId: number,
  argv: string[],
  executionEpoch: number,
  beforeEffect: BeforeEffectHook | undefined,
  locale: WorkspaceLocale,
): Promise<BuiltinResult | null> {
  const copy = getTerminalCopy(locale);
  const [cmd, ...args] = argv;

  switch ((cmd ?? "").toLowerCase()) {
    case "pwd":
      return {
        stdout: `${await getSandboxWorkingDirectory(agentId, beforeEffect)}\n`,
      };

    case "cd": {
      const cwd = await changeSandboxWorkingDirectory(
        agentId,
        args[0],
        executionEpoch,
        beforeEffect,
      );
      return { stdout: `${cwd}\n` };
    }

    case "ls":
    case "dir": {
      const target = args.find((a) => !a.startsWith("-")) ?? "";
      const resolved = await resolveFromWorkingDirectory(
        agentId,
        target,
        beforeEffect,
      );
      const listing = await listDirectory(agentId, resolved.rel, beforeEffect);
      if (listing.total === 0) return { stdout: `${copy.emptyDirectory}\n` };
      const lines = listing.entries.map((e) => {
        const kind = e.type === "directory" ? "<DIR> " : "       ";
        return `${kind}${e.name}`;
      });
      return { stdout: lines.join("\n") + "\n" };
    }

    case "cat":
    case "type": {
      const target = args[0];
      if (!target) return { stdout: "", stderr: `${copy.usageCat}\n` };
      const resolved = await resolveFromWorkingDirectory(
        agentId,
        target,
        beforeEffect,
      );
      const file = await readTextFile(agentId, resolved.rel, beforeEffect);
      return { stdout: file.content };
    }

    case "echo":
      return { stdout: `${args.join(" ")}\n` };

    case "mkdir": {
      const target = args.find((a) => !a.startsWith("-"));
      if (!target) return { stdout: "", stderr: `${copy.usageMkdir}\n` };
      const { abs } = await resolveFromWorkingDirectory(
        agentId,
        target,
        beforeEffect,
      );
      await assertNoSymlinkPath(agentId, abs);
      assertLocalExecutionEpoch(executionEpoch);
      await beforeEffect?.();
      assertLocalExecutionEpoch(executionEpoch);
      await withFileOperationLock(agentId, async (tx) => {
        await assertNoSymlinkPath(agentId, abs);
        await beforeEffect?.revalidate?.(tx);
        assertLocalExecutionEpoch(executionEpoch);
        await fsp.mkdir(abs, { recursive: true });
      });
      return { stdout: "" };
    }

    case "touch": {
      const target = args.find((argument) => !argument.startsWith("-"));
      if (!target) return { stdout: "", stderr: `${copy.usageTouch}\n` };
      const { abs, rel } = await resolveFromWorkingDirectory(
        agentId,
        target,
        beforeEffect,
      );
      if (!rel)
        throw new VmError("Workspace root is not a file.", {
          key: "rootNotFile",
        });
      const existing = await fsp
        .lstat(abs)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (existing && !existing.isFile())
        throw new VmError("Only a regular file can be touched.", {
          key: "regularFileTouchOnly",
        });
      assertLocalExecutionEpoch(executionEpoch);
      await beforeEffect?.();
      await withFileOperationLock(agentId, async (tx) => {
        await assertNoSymlinkPath(agentId, abs);
        await beforeEffect?.revalidate?.(tx);
        assertLocalExecutionEpoch(executionEpoch);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await assertNoSymlinkPath(agentId, abs);
        await beforeEffect?.revalidate?.(tx);
        assertLocalExecutionEpoch(executionEpoch);
        const file = await fsp.open(
          abs,
          fs.constants.O_WRONLY |
            fs.constants.O_CREAT |
            fs.constants.O_APPEND |
            (process.platform === "win32"
              ? 0
              : fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK),
          0o600,
        );
        try {
          if (!(await file.stat()).isFile())
            throw new VmError("Only a regular file can be touched.", {
              key: "regularFileTouchOnly",
            });
          const now = new Date();
          await beforeEffect?.revalidate?.(tx);
          assertLocalExecutionEpoch(executionEpoch);
          await file.utimes(now, now);
          await file.sync();
        } finally {
          await file.close();
        }
      });
      return { stdout: "" };
    }
    case "write": {
      // Explicit replacement: write f.txt <content...>.
      const target = args.find((a) => !a.startsWith("-"));
      if (!target) return { stdout: "", stderr: `${copy.usageWrite}\n` };
      const content = args.slice(args.indexOf(target) + 1).join(" ");
      const resolved = await resolveFromWorkingDirectory(
        agentId,
        target,
        beforeEffect,
      );
      const res = await writeTextFile(
        agentId,
        resolved.rel,
        content,
        executionEpoch,
        beforeEffect,
      );
      return {
        stdout: `${terminalMessage(locale, "written", { path: res.path, bytes: res.sizeBytes })}\n`,
      };
    }

    case "rm":
    case "del": {
      const target = args.find((a) => !a.startsWith("-"));
      if (!target) return { stdout: "", stderr: `${copy.usageRemove}\n` };
      const resolved = await resolveFromWorkingDirectory(
        agentId,
        target,
        beforeEffect,
      );
      await deleteEntry(agentId, resolved.rel, executionEpoch, beforeEffect);
      return {
        stdout: `${terminalMessage(locale, "removed", { path: target })}\n`,
      };
    }

    case "whoami":
      return { stdout: `agent-${agentId}@sandbox\n` };

    case "date":
      return { stdout: `${new Date().toISOString()}\n` };

    case "help":
      return {
        stdout: [
          copy.helpBuiltins,
          "  cd, ls/dir, cat/type, echo, mkdir, touch/write, rm/del, pwd, whoami, date, help",
          terminalMessage(
            locale,
            isAgentProcessExecEnabled()
              ? "helpProcessesEnabled"
              : "helpProcessesDisabled",
            { commands: Object.keys(SPAWNABLE).join(", ") },
          ),
          copy.helpDeleteReview,
          "",
        ].join("\n"),
      };

    default:
      return null;
  }
}

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (const ch of command.trim()) {
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

export interface VmExecOutcome {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  note: string | null;
  cwd: string | null;
}

async function execInSandboxUnlocked(
  agentId: number,
  command: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  executionEpoch = captureLocalExecutionEpoch(),
  beforeEffect?: BeforeEffectHook,
  locale: WorkspaceLocale = "tr",
  structuredArgs?: readonly string[],
): Promise<VmExecOutcome> {
  const copy = getTerminalCopy(locale);
  const startedAt = Date.now();
  assertLocalExecutionEpoch(executionEpoch);
  await ensureSandbox(agentId, beforeEffect);
  const cwdState = await resolveWorkingDirectory(agentId, beforeEffect);
  const cwd = cwdState.abs;
  const cwdDisplay = `/${cwdState.rel}`.replace(/\/$/, "") || "/";
  await assertNoSymlinkPath(agentId, cwd);

  const argv = structuredArgs ? [...structuredArgs] : tokenize(command);
  if (argv.length === 0) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: copy.emptyCommand,
      durationMs: 0,
      note: null,
      cwd: cwdDisplay,
    };
  }

  const head = argv[0].toLowerCase();

  if (!structuredArgs && FORBIDDEN_CHARS.test(command)) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: copy.forbiddenCommand,
      durationMs: Date.now() - startedAt,
      note: "forbidden-chars",
      cwd: cwdDisplay,
    };
  }

  let builtin: BuiltinResult | null;
  try {
    builtin = await runBuiltin(
      agentId,
      argv,
      executionEpoch,
      beforeEffect,
      locale,
    );
  } catch (error) {
    if (error instanceof VmError) {
      return {
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: localizedVmErrorMessage(
          error,
          locale,
          copy.terminalFailureFallback,
        ),
        durationMs: Date.now() - startedAt,
        note: "path-policy",
        cwd: await getSandboxWorkingDirectory(agentId, beforeEffect),
      };
    }
    throw error;
  }
  if (builtin) {
    return {
      ok: !builtin.stderr,
      exitCode: builtin.stderr ? 1 : 0,
      stdout: builtin.stdout.slice(0, MAX_OUTPUT_CHARS),
      stderr: (builtin.stderr ?? "").slice(0, MAX_OUTPUT_CHARS),
      durationMs: Date.now() - startedAt,
      note: null,
      cwd: await getSandboxWorkingDirectory(agentId, beforeEffect),
    };
  }

  const spec = SPAWNABLE[head];
  if (!spec) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: terminalMessage(locale, "commandNotAllowed", {
        command: argv[0],
      }),
      durationMs: Date.now() - startedAt,
      note: "allowlist",
      cwd: cwdDisplay,
    };
  }

  if (!isAgentProcessExecEnabled()) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: copy.processDisabled,
      durationMs: Date.now() - startedAt,
      note: "process-exec-disabled",
      cwd: cwdDisplay,
    };
  }

  const args = argv.slice(1);
  let launch: { command: string; args: string[] };
  try {
    launch = await resolveProcessLaunch(spec.binary, args);
  } catch {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: copy.commandNotStarted,
      durationMs: Date.now() - startedAt,
      note: "PACKAGE_MANAGER_UNAVAILABLE",
      cwd: cwdDisplay,
    };
  }

  // The durable effect hook runs only after command policy and path preflight.
  // Re-check the emergency epoch after awaiting it, then spawn and register the
  // child without another asynchronous gap.
  assertLocalExecutionEpoch(executionEpoch);
  await beforeEffect?.();
  assertLocalExecutionEpoch(executionEpoch);
  await assertNoSymlinkPath(agentId, cwd);
  await beforeEffect?.revalidate?.();
  assertLocalExecutionEpoch(executionEpoch);

  return new Promise<VmExecOutcome>((resolve) => {
    const child = spawn(launch.command, launch.args, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: cwd,
        USERPROFILE: cwd,
        TMPDIR: os.tmpdir(),
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        NODE_ENV: "sandbox",
        NO_COLOR: "1",
      },
    });
    activeAgentProcesses.add(child);
    try {
      assertLocalExecutionEpoch(executionEpoch);
    } catch {
      terminateAgentProcessTree(child);
    }

    let out = "";
    let err = "";
    let settled = false;
    let pipeError: NodeJS.ErrnoException | null = null;
    guardChildProcessPipes(child, (error) => {
      pipeError ??= error;
    });

    const finish = (exitCode: number | null, note: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      activeAgentProcesses.delete(child);
      resolve({
        ok: exitCode === 0,
        exitCode,
        stdout: out.slice(0, MAX_OUTPUT_CHARS),
        stderr: err.slice(0, MAX_OUTPUT_CHARS),
        durationMs: Date.now() - startedAt,
        note: note ?? childPipeFailureNote(pipeError),
        cwd: cwdDisplay,
      });
    };

    const timeoutHandle = setTimeout(
      () => terminateAgentProcessTree(child),
      timeoutMs,
    );
    timeoutHandle.unref();

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (out.length < MAX_OUTPUT_CHARS) out += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (err.length < MAX_OUTPUT_CHARS) err += chunk;
    });
    child.on("error", (e: Error) => finish(null, `spawn-error: ${e.message}`));
    child.on("close", (code, signal) =>
      finish(code, signal ? `signal: ${signal}` : null),
    );
  });
}

/**
 * Per-agent FIFO actor queue. Agent orchestration and operator `/vm/exec`
 * share the same virtual cwd, so their commands must never resolve `cd` and
 * relative paths concurrently.
 */
async function runQueuedSandboxCommand(
  agentId: number,
  command: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  beforeEffect?: BeforeEffectHook,
  locale: WorkspaceLocale = "tr",
  structuredArgs?: readonly string[],
): Promise<VmExecOutcome> {
  const copy = getTerminalCopy(locale);
  const executionEpoch = captureLocalExecutionEpoch();
  const invocationGeneration = agentProcessStopGeneration;
  const previous = sandboxCommandQueues.get(agentId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  sandboxCommandQueues.set(agentId, tail);
  await previous.catch(() => undefined);
  try {
    if (invocationGeneration !== agentProcessStopGeneration) {
      return {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: copy.queuedCancelled,
        durationMs: 0,
        note: "emergency-stop",
        cwd: null,
      };
    }
    assertLocalExecutionEpoch(executionEpoch);
    return await execInSandboxUnlocked(
      agentId,
      command,
      timeoutMs,
      executionEpoch,
      beforeEffect,
      locale,
      structuredArgs,
    );
  } finally {
    release();
    if (sandboxCommandQueues.get(agentId) === tail) {
      sandboxCommandQueues.delete(agentId);
    }
  }
}

// ---------------------------------------------------------------------------
// Agent sudo -- approval-controlled full-authority host execution
// ---------------------------------------------------------------------------

export function execInSandbox(
  agentId: number,
  command: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  beforeEffect?: BeforeEffectHook,
  locale: WorkspaceLocale = "tr",
) {
  return runQueuedSandboxCommand(
    agentId,
    command,
    timeoutMs,
    beforeEffect,
    locale,
  );
}

/** Internal structured invocation for reviewed workflows. Retains executable
 * allowlist, OS gate, FIFO ownership, stop epoch and the effect hook. Arguments
 * go directly to spawn(shell:false); no shell parsing occurs. */
export function execArgvInSandbox(
  agentId: number,
  argv: readonly string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  beforeEffect?: BeforeEffectHook,
  locale: WorkspaceLocale = "tr",
) {
  if (
    !Array.isArray(argv) ||
    argv.length < 1 ||
    argv.length > 128 ||
    argv.some((value) => typeof value !== "string" || value.includes("\0")) ||
    JSON.stringify(argv).length > 16000
  )
    throw new TypeError("Invalid structured command arguments");
  return runQueuedSandboxCommand(
    agentId,
    argv.join(" "),
    timeoutMs,
    beforeEffect,
    locale,
    argv,
  );
}

const AGENT_SUDO_TIMEOUT_MS = 120_000;
const AGENT_SUDO_MAX_OUTPUT = 256 * 1024;
export const MAX_AGENT_SUDO_COMMAND_CHARS = 1_000;
const FORBIDDEN_AGENT_SUDO_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;

export interface AgentSudoTarget {
  executionInstanceId: string;
  hostname: string;
  cwd: string;
  target: string;
}

const AGENT_SUDO_EXECUTION_INSTANCE_ID = randomUUID();

export function validateAgentSudoCommand(
  command: unknown,
  locale: WorkspaceLocale = "tr",
): { ok: true; command: string } | { ok: false; error: string } {
  const copy = getTerminalCopy(locale);
  if (typeof command !== "string" || !command.trim()) {
    return { ok: false, error: copy.commandRequired };
  }
  if (command.length > MAX_AGENT_SUDO_COMMAND_CHARS) {
    return {
      ok: false,
      error: terminalMessage(locale, "sudoCommandTooLong", {
        limit: MAX_AGENT_SUDO_COMMAND_CHARS,
      }),
    };
  }
  if (FORBIDDEN_AGENT_SUDO_CHARS.test(command)) {
    return {
      ok: false,
      error: copy.sudoCommandControls,
    };
  }
  return { ok: true, command };
}

export async function getAgentSudoTarget(
  agentId: number,
): Promise<AgentSudoTarget> {
  const root = path.resolve(await ensureSandbox(agentId));
  const rootStat = await fsp.lstat(root);
  if (rootStat.isSymbolicLink()) {
    throw new VmError("Ajan sudo calisma alani sembolik bag olamaz.", {
      key: "sudoWorkspaceSymlink",
    });
  }
  const cwd = await fsp.realpath(root);
  const hostname = os.hostname().trim().toLowerCase() || "unknown-host";
  return {
    executionInstanceId: AGENT_SUDO_EXECUTION_INSTANCE_ID,
    hostname,
    cwd,
    target: `instance=${AGENT_SUDO_EXECUTION_INSTANCE_ID};host=${hostname};cwd=${cwd}`,
  };
}

function buildAgentSudoEnvironment(cwd: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: cwd,
    USERPROFILE: cwd,
    TEMP: cwd,
    TMP: cwd,
    TMPDIR: cwd,
    NO_COLOR: "1",
  };
  const allowed = [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "ComSpec",
    "COMSPEC",
    "PATHEXT",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
  ];
  for (const key of allowed) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

export function redactAgentSudoText(value: string): string {
  let redacted = value;
  const secretName =
    /(?:token|secret|pass(?:word|wd)?|api[_-]?key|private[_-]?key|authorization|cookie|credential|database[_-]?url)/i;
  for (const [key, secret] of Object.entries(process.env)) {
    if (!secret || secret.length < 4 || !secretName.test(key)) continue;
    redacted = redacted.split(secret).join("[REDACTED]");
  }

  redacted = redacted
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|AUTHORIZATION|COOKIE|CREDENTIAL|DATABASE_URL)[A-Z0-9_]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:sk|pk|ghp|github_pat|glpat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gi,
      "[REDACTED]",
    )
    .replace(/:\/\/[^\s/@:]+:[^\s/@]+@/g, "://[REDACTED]@");
  return redacted;
}

/**
 * This gate is intentionally independent from the operator-only founder
 * shell. Enabling one authority must never enable the other by accident.
 */
export function isAgentSudoEnabled(): boolean {
  return process.env.ALLOW_AGENT_SUDO === "true";
}

/**
 * Runs an already human-approved command through the platform shell with the
 * API service account's full host authority. The initial working directory is
 * always the requesting agent's sandbox, but the command is deliberately not
 * confined to it. Callers must enforce live canUseSudo permission and an
 * exact, single-use approval before reaching this function. Timeout and
 * emergency-stop paths terminate the tracked process tree, but this remains
 * best effort rather than an OS containment boundary; a deliberately escaped
 * process or compromised service account still requires container/VM controls.
 */
export async function execAgentSudo(input: {
  agentId: number;
  command: string;
  approvalId: number;
  leaseOwner: string;
  argsHash: string;
  beforeEffect?: BeforeEffectHook;
  locale?: WorkspaceLocale;
}): Promise<VmExecOutcome> {
  const locale = input.locale ?? "tr";
  const copy = getTerminalCopy(locale);
  const executionEpoch = captureLocalExecutionEpoch();
  const startedAt = Date.now();
  const validated = validateAgentSudoCommand(input.command, locale);
  if (!validated.ok) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: validated.error,
      durationMs: 0,
      note: null,
      cwd: null,
    };
  }
  if (!isAgentSudoEnabled()) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: copy.sudoDisabled,
      durationMs: 0,
      note: "disabled",
      cwd: null,
    };
  }

  await dbReady;
  const [[liveAgent], [approval]] = await Promise.all([
    db.select().from(agentsTable).where(eq(agentsTable.id, input.agentId)),
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, input.approvalId)),
  ]);
  const [task] = approval
    ? await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, approval.taskId))
    : [];
  const computedArgsHash = canonicalArgumentHash({
    command: validated.command,
  });
  const capabilityPayload = approval?.actionPayload;
  const capabilityArgs = capabilityPayload?.args;
  const capabilityKeys = capabilityArgs ? Object.keys(capabilityArgs) : [];
  const capabilityCommand = validateAgentSudoCommand(capabilityArgs?.command);
  const proofNow = Date.now();
  if (
    !liveAgent?.isActive ||
    !liveAgent.permissions.canUseSudo ||
    !(await isCanonicalRootCeo(liveAgent)) ||
    liveAgent.runLeaseOwner !== input.leaseOwner ||
    !liveAgent.runLeaseExpiresAt ||
    liveAgent.runLeaseExpiresAt.getTime() <= proofNow ||
    !approval ||
    approval.agentId !== input.agentId ||
    approval.status !== "approved" ||
    approval.consumedAt !== null ||
    approval.bindingInvalidatedAt !== null ||
    !approval.expiresAt ||
    approval.expiresAt.getTime() <= proofNow ||
    approval.scope?.toolName !== "vm_run_sudo_command" ||
    approval.scope.argsHash !== input.argsHash ||
    approval.scope.argsHash !== computedArgsHash ||
    capabilityPayload?.toolName !== "vm_run_sudo_command" ||
    capabilityKeys.length !== 1 ||
    capabilityKeys[0] !== "command" ||
    !capabilityCommand.ok ||
    capabilityCommand.command !== validated.command ||
    canonicalArgumentHash(capabilityArgs) !== computedArgsHash ||
    !task ||
    task.id !== approval.taskId ||
    task.ownerAgentId !== input.agentId ||
    task.status !== "awaiting_approval" ||
    task.leaseOwner !== input.leaseOwner ||
    !task.leaseExpiresAt ||
    task.leaseExpiresAt.getTime() <= proofNow
  ) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: copy.sudoAuthorityDenied,
      durationMs: Date.now() - startedAt,
      note: "permission-denied",
      cwd: null,
    };
  }

  let currentTarget: AgentSudoTarget;
  try {
    currentTarget = await getAgentSudoTarget(input.agentId);
  } catch {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: copy.sudoTargetUnverified,
      durationMs: Date.now() - startedAt,
      note: "target-denied",
      cwd: null,
    };
  }
  if (approval.scope.target !== currentTarget.target) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: copy.sudoTargetMismatch,
      durationMs: Date.now() - startedAt,
      note: "target-denied",
      cwd: currentTarget.cwd,
    };
  }

  assertLocalExecutionEpoch(executionEpoch);
  await input.beforeEffect?.();
  assertLocalExecutionEpoch(executionEpoch);

  const [[postAgent], [postApproval]] = await Promise.all([
    db.select().from(agentsTable).where(eq(agentsTable.id, input.agentId)),
    db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, input.approvalId)),
  ]);
  const [postTask] = postApproval
    ? await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, postApproval.taskId))
    : [];
  const postProofNow = Date.now();
  if (
    !postAgent?.isActive ||
    !postAgent.permissions.canUseSudo ||
    !(await isCanonicalRootCeo(postAgent)) ||
    postAgent.runLeaseOwner !== input.leaseOwner ||
    !postAgent.runLeaseExpiresAt ||
    postAgent.runLeaseExpiresAt.getTime() <= postProofNow ||
    !postApproval ||
    postApproval.taskId !== approval.taskId ||
    postApproval.agentId !== input.agentId ||
    postApproval.status !== "approved" ||
    postApproval.bindingInvalidatedAt !== null ||
    !postApproval.consumedAt ||
    postApproval.consumedAt.getTime() > postProofNow ||
    postProofNow - postApproval.consumedAt.getTime() > 5 * 60_000 ||
    !postApproval.expiresAt ||
    postApproval.expiresAt.getTime() <= postProofNow ||
    postApproval.scope?.toolName !== "vm_run_sudo_command" ||
    postApproval.scope.argsHash !== input.argsHash ||
    postApproval.scope.argsHash !== computedArgsHash ||
    postApproval.scope.target !== approval.scope.target ||
    postApproval.actionPayload !== null ||
    !postTask ||
    postTask.id !== postApproval.taskId ||
    postTask.ownerAgentId !== input.agentId ||
    postTask.status !== "awaiting_approval" ||
    postTask.leaseOwner !== input.leaseOwner ||
    !postTask.leaseExpiresAt ||
    postTask.leaseExpiresAt.getTime() <= postProofNow
  ) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: copy.sudoAuthorityChanged,
      durationMs: Date.now() - startedAt,
      note: "permission-denied",
      cwd: null,
    };
  }

  let postTarget: AgentSudoTarget;
  try {
    postTarget = await getAgentSudoTarget(input.agentId);
  } catch {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: copy.sudoTargetRecheckFailed,
      durationMs: Date.now() - startedAt,
      note: "target-denied",
      cwd: null,
    };
  }
  if (
    postApproval.scope.target !== postTarget.target ||
    postTarget.target !== currentTarget.target
  ) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: copy.sudoTargetChanged,
      durationMs: Date.now() - startedAt,
      note: "target-denied",
      cwd: postTarget.cwd,
    };
  }

  const { cwd: workdir } = postTarget;
  assertLocalExecutionEpoch(executionEpoch);
  return new Promise<VmExecOutcome>((resolve) => {
    const child = spawn(validated.command, {
      cwd: workdir,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: buildAgentSudoEnvironment(workdir),
    });
    activeAgentProcesses.add(child);
    try {
      assertLocalExecutionEpoch(executionEpoch);
    } catch {
      terminateAgentProcessTree(child);
    }

    let out = "";
    let err = "";
    let settled = false;
    let pipeError: NodeJS.ErrnoException | null = null;
    guardChildProcessPipes(child, (error) => {
      pipeError ??= error;
    });

    const finish = (exitCode: number | null, note: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      activeAgentProcesses.delete(child);
      resolve({
        ok: exitCode === 0,
        exitCode,
        stdout: redactAgentSudoText(out.slice(0, AGENT_SUDO_MAX_OUTPUT)),
        stderr: redactAgentSudoText(err.slice(0, AGENT_SUDO_MAX_OUTPUT)),
        durationMs: Date.now() - startedAt,
        note: note ?? childPipeFailureNote(pipeError),
        cwd: workdir,
      });
    };

    const timeoutHandle = setTimeout(
      () => terminateAgentProcessTree(child),
      AGENT_SUDO_TIMEOUT_MS,
    );
    timeoutHandle.unref();

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (out.length < AGENT_SUDO_MAX_OUTPUT) out += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (err.length < AGENT_SUDO_MAX_OUTPUT) err += chunk;
    });
    child.on("error", (error: Error) =>
      finish(null, `spawn-error: ${error.message}`),
    );
    child.on("close", (code, signal) =>
      finish(code, signal ? `signal: ${signal}` : "agent-sudo"),
    );
  });
}

// ---------------------------------------------------------------------------
// Founder shell ("sudo") -- full-authority host execution
// ---------------------------------------------------------------------------

const FOUNDER_TIMEOUT_MS = 120_000;
const FOUNDER_MAX_OUTPUT = 256 * 1024;

export function isFounderShellEnabled(): boolean {
  return process.env.ALLOW_FOUNDER_SHELL === "true";
}

/**
 * The operator ("Kurucu") is not constrained by the agent allowlist: the
 * command runs through the platform shell with the inherited environment
 * and full PATH. Working directory starts at the requested agent's sandbox
 * root but nothing prevents traversal -- that authority is the point.
 */
export async function execFounderShell(
  command: string,
  cwd?: string,
  beforeEffect?: BeforeEffectHook,
  locale: WorkspaceLocale = "tr",
): Promise<VmExecOutcome> {
  const copy = getTerminalCopy(locale);
  const startedAt = Date.now();
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: copy.emptyCommand,
      durationMs: 0,
      note: null,
      cwd: null,
    };
  }
  if (!isFounderShellEnabled()) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: copy.founderDisabled,
      durationMs: 0,
      note: "disabled",
      cwd: null,
    };
  }

  const workdir =
    cwd && cwd.trim() ? path.resolve(cwd.trim()) : getSandboxRoot(0);

  await beforeEffect?.();
  await fsp.mkdir(workdir, { recursive: true }).catch(() => undefined);
  await beforeEffect?.();

  return new Promise<VmExecOutcome>((resolve) => {
    const child = spawn(trimmed, {
      cwd: workdir,
      shell: true,
      windowsHide: true,
      timeout: FOUNDER_TIMEOUT_MS,
      env: process.env,
    });

    let out = "";
    let err = "";
    let settled = false;
    let pipeError: NodeJS.ErrnoException | null = null;
    guardChildProcessPipes(child, (error) => {
      pipeError ??= error;
    });

    const finish = (exitCode: number | null, note: string | null) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: exitCode === 0,
        exitCode,
        stdout: out.slice(0, FOUNDER_MAX_OUTPUT),
        stderr: err.slice(0, FOUNDER_MAX_OUTPUT),
        durationMs: Date.now() - startedAt,
        note: note ?? childPipeFailureNote(pipeError),
        cwd: workdir,
      });
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (out.length < FOUNDER_MAX_OUTPUT) out += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (err.length < FOUNDER_MAX_OUTPUT) err += chunk;
    });
    child.on("error", (e: Error) => finish(null, `spawn-error: ${e.message}`));
    child.on("close", (code, signal) =>
      finish(code, signal ? `signal: ${signal}` : null),
    );
  });
}
