import { randomUUID } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";

export type EnduranceFaultOutcome =
  "success" | "timeout" | "rate_limit" | "malformed" | "unknown_outcome";

export interface EnduranceFaultControlEntry {
  taskId: number;
  attemptNumber: number;
  step: number;
  outcome: EnduranceFaultOutcome;
  delayMs?: number;
}

export interface EnduranceFaultControlWriterOptions {
  runId: string;
  seed: number;
  runDirectory: string;
  controlFile: string;
  /** Group-readable only for a read-only Docker bind inside a private host parent. */
  fileMode?: 0o600 | 0o640;
}

export interface EnduranceFaultControlWriter {
  set(entries: ReadonlyArray<EnduranceFaultControlEntry>): Promise<number>;
  clear(): Promise<number>;
}

interface FaultControlDocument {
  schemaVersion: 1;
  runId: string;
  revision: number;
  seed: number;
  entries: EnduranceFaultControlEntry[];
}

const SAFE_RUN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/u;
const UINT32_MAX = 0xffff_ffff;
const MAX_ENTRIES = 10_000;
const MAX_DELAY_MS = 10 * 60_000;
const MAX_DOCUMENT_BYTES = 256 * 1024;
const OUTCOMES = new Set<EnduranceFaultOutcome>([
  "success",
  "timeout",
  "rate_limit",
  "malformed",
  "unknown_outcome",
]);

function normalizedPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function validateOptions(
  options: EnduranceFaultControlWriterOptions,
): EnduranceFaultControlWriterOptions {
  if (
    options.fileMode !== undefined &&
    options.fileMode !== 0o600 &&
    options.fileMode !== 0o640
  ) {
    throw new TypeError("fault control fileMode must be 0600 or 0640");
  }
  if (!SAFE_RUN_ID.test(options.runId)) {
    throw new TypeError(
      "runId must use lowercase letters, digits, and hyphens with no path segments",
    );
  }
  if (
    !Number.isSafeInteger(options.seed) ||
    options.seed < 0 ||
    options.seed > UINT32_MAX
  ) {
    throw new TypeError("seed must be an unsigned 32-bit integer");
  }
  if (
    !path.isAbsolute(options.runDirectory) ||
    !path.isAbsolute(options.controlFile)
  ) {
    throw new TypeError("fault control paths must be absolute local paths");
  }
  if (
    process.platform === "win32" &&
    (options.runDirectory.startsWith("\\\\") ||
      options.controlFile.startsWith("\\\\"))
  ) {
    throw new TypeError("fault control paths cannot use a network share");
  }
  if (
    normalizedPath(path.dirname(options.controlFile)) !==
    normalizedPath(options.runDirectory)
  ) {
    throw new TypeError(
      "fault control file must be directly inside its run directory",
    );
  }
  return {
    ...options,
    runDirectory: path.resolve(options.runDirectory),
    controlFile: path.resolve(options.controlFile),
  };
}

function positiveInteger(
  value: unknown,
  label: string,
  minimum: number,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new TypeError(`${label} must be an integer of at least ${minimum}`);
  }
  return Number(value);
}

function normalizedEntries(
  values: ReadonlyArray<EnduranceFaultControlEntry>,
): EnduranceFaultControlEntry[] {
  if (values.length > MAX_ENTRIES) {
    throw new TypeError(`fault control cannot exceed ${MAX_ENTRIES} entries`);
  }
  const identities = new Set<string>();
  return values.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`fault control entry ${index} must be an object`);
    }
    const taskId = positiveInteger(value.taskId, `entry ${index} taskId`, 1);
    const attemptNumber = positiveInteger(
      value.attemptNumber,
      `entry ${index} attemptNumber`,
      1,
    );
    const step = positiveInteger(value.step, `entry ${index} step`, 0);
    if (!OUTCOMES.has(value.outcome)) {
      throw new TypeError(
        `fault control entry ${index} has an invalid outcome`,
      );
    }
    if (
      value.delayMs !== undefined &&
      (!Number.isSafeInteger(value.delayMs) ||
        value.delayMs < 0 ||
        value.delayMs > MAX_DELAY_MS)
    ) {
      throw new TypeError(
        `fault control entry ${index} delayMs must be from 0 to ${MAX_DELAY_MS}`,
      );
    }
    const identity = `${taskId}:${attemptNumber}:${step}`;
    if (identities.has(identity)) {
      throw new TypeError(
        `fault control contains duplicate identity ${identity}`,
      );
    }
    identities.add(identity);
    return {
      taskId,
      attemptNumber,
      step,
      outcome: value.outcome,
      ...(value.delayMs === undefined ? {} : { delayMs: value.delayMs }),
    };
  });
}

async function assertRunDirectory(options: EnduranceFaultControlWriterOptions) {
  const stats = await lstat(options.runDirectory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(
      "fault control run directory must be a real local directory",
    );
  }
  const canonicalDirectory = await realpath(options.runDirectory);
  if (
    normalizedPath(canonicalDirectory) !== normalizedPath(options.runDirectory)
  ) {
    throw new Error("fault control run directory must not traverse a symlink");
  }
  try {
    const fileStats = await lstat(options.controlFile);
    if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
      throw new Error("fault control must be a regular non-symlink file");
    }
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
  }
}

async function readCurrent(
  options: EnduranceFaultControlWriterOptions,
): Promise<FaultControlDocument | null> {
  await assertRunDirectory(options);
  let text: string;
  try {
    text = await readFile(options.controlFile, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (Buffer.byteLength(text, "utf8") > MAX_DOCUMENT_BYTES) {
    throw new Error("fault control document exceeds its byte limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("fault control document must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("fault control document must be an object");
  }
  const document = parsed as Partial<FaultControlDocument>;
  if (
    document.schemaVersion !== 1 ||
    document.runId !== options.runId ||
    document.seed !== options.seed ||
    !Number.isSafeInteger(document.revision) ||
    Number(document.revision) < 1 ||
    !Array.isArray(document.entries)
  ) {
    throw new Error("fault control document does not match this endurance run");
  }
  return {
    schemaVersion: 1,
    runId: options.runId,
    revision: Number(document.revision),
    seed: options.seed,
    entries: normalizedEntries(document.entries),
  };
}

async function writeDocument(
  options: EnduranceFaultControlWriterOptions,
  revision: number,
  entries: EnduranceFaultControlEntry[],
): Promise<void> {
  const document: FaultControlDocument = {
    schemaVersion: 1,
    runId: options.runId,
    revision,
    seed: options.seed,
    entries,
  };
  const serialized = `${JSON.stringify(document)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_DOCUMENT_BYTES) {
    throw new Error("fault control document exceeds its byte limit");
  }
  const temporary = path.join(
    options.runDirectory,
    `.fault-control-${process.pid}-${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporary, "wx", options.fileMode ?? 0o600);
    await handle.chmod(options.fileMode ?? 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, options.controlFile);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export function createEnduranceFaultControlWriter(
  rawOptions: EnduranceFaultControlWriterOptions,
): EnduranceFaultControlWriter {
  const options = validateOptions(rawOptions);
  let serialized: Promise<void> = Promise.resolve();
  const update = (
    entries: ReadonlyArray<EnduranceFaultControlEntry>,
  ): Promise<number> => {
    const operation = serialized.then(async () => {
      const normalized = normalizedEntries(entries);
      const current = await readCurrent(options);
      const revision = (current?.revision ?? 0) + 1;
      await writeDocument(options, revision, normalized);
      return revision;
    });
    serialized = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };
  return Object.freeze({
    set: update,
    clear: () => update([]),
  });
}
