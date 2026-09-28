import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";

export const syntheticFaultOutcomes = [
  "success",
  "timeout",
  "rate_limit",
  "malformed",
  "unknown_outcome",
] as const;

// Fault controls contain no secrets and may cross a host/container uid
// boundary. Set an explicit post-umask mode before the atomic rename so every
// worker can read the complete replacement without a permission race.
export const SYNTHETIC_FAULT_CONTROL_FILE_MODE = 0o644;

export type SyntheticFaultOutcome = (typeof syntheticFaultOutcomes)[number];

export interface SyntheticStepIdentity {
  taskId: number;
  attemptNumber: number;
  step: number;
}

export interface SyntheticFaultPlanEntry extends SyntheticStepIdentity {
  outcome: SyntheticFaultOutcome;
  delayMs?: number;
}

export interface SyntheticFaultPlan {
  readonly schemaVersion: 1;
  readonly seed: number;
  readonly entries: ReadonlyArray<Readonly<SyntheticFaultPlanEntry>>;
}

export interface SyntheticFaultSource {
  resolve(
    identity: SyntheticStepIdentity,
  ): Promise<Readonly<SyntheticFaultPlanEntry>>;
}

export interface SyntheticFaultControlOptions {
  runId: string;
  seed: number;
  runDirectory: string;
  controlFile: string;
}

interface SyntheticFaultControlDocument {
  schemaVersion: 1;
  runId: string;
  revision: number;
  seed: number;
  entries: ReadonlyArray<Readonly<SyntheticFaultPlanEntry>>;
}

export interface SyntheticFixtureArguments {
  runId: string;
  operationKey: string;
  value: string;
}

const UINT32_MAX = 0xffff_ffff;
const MAX_FAULT_PLAN_BYTES = 256 * 1024;
const MAX_FAULT_PLAN_ENTRIES = 10_000;
const MAX_FAULT_DELAY_MS = 10 * 60_000;
const FAULT_OUTCOME_SET = new Set<string>(syntheticFaultOutcomes);
const ENTRY_KEYS = new Set([
  "taskId",
  "attemptNumber",
  "step",
  "outcome",
  "delayMs",
]);
const CONTROL_DOCUMENT_KEYS = new Set([
  "schemaVersion",
  "runId",
  "revision",
  "seed",
  "entries",
]);
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `Synthetic fault plan ${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

export function parseSyntheticSeed(raw: string | undefined): number {
  if (!raw || !/^(?:0|[1-9][0-9]{0,9})$/u.test(raw)) {
    throw new Error(
      "SYNTHETIC_RUNTIME_SEED must be a canonical unsigned 32-bit seed.",
    );
  }
  const seed = Number(raw);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > UINT32_MAX) {
    throw new Error(
      "SYNTHETIC_RUNTIME_SEED must be a canonical unsigned 32-bit seed.",
    );
  }
  return seed;
}

function normalizedEntry(
  value: unknown,
  index: number,
): Readonly<SyntheticFaultPlanEntry> {
  if (!isRecord(value)) {
    throw new Error(`Synthetic fault plan entry ${index} must be an object.`);
  }
  const unexpected = Object.keys(value).filter((key) => !ENTRY_KEYS.has(key));
  if (unexpected.length > 0) {
    throw new Error(
      `Synthetic fault plan entry ${index} contains unsupported fields.`,
    );
  }
  const outcome = value.outcome;
  if (typeof outcome !== "string" || !FAULT_OUTCOME_SET.has(outcome)) {
    throw new Error(
      `Synthetic fault plan entry ${index} has an invalid outcome.`,
    );
  }
  const delayMs =
    value.delayMs === undefined
      ? undefined
      : assertSafeInteger(
          value.delayMs,
          `entry ${index} delayMs`,
          0,
          MAX_FAULT_DELAY_MS,
        );
  return Object.freeze({
    taskId: assertSafeInteger(value.taskId, `entry ${index} taskId`, 1),
    attemptNumber: assertSafeInteger(
      value.attemptNumber,
      `entry ${index} attemptNumber`,
      1,
    ),
    step: assertSafeInteger(value.step, `entry ${index} step`, 0),
    outcome: outcome as SyntheticFaultOutcome,
    ...(delayMs === undefined ? {} : { delayMs }),
  });
}

function identityKey(identity: SyntheticStepIdentity): string {
  return `${identity.taskId}:${identity.attemptNumber}:${identity.step}`;
}

export function createSyntheticFaultPlan(input: {
  seed: number;
  entries?: ReadonlyArray<SyntheticFaultPlanEntry>;
}): SyntheticFaultPlan {
  const seed = parseSyntheticSeed(String(input.seed));
  const source = input.entries ?? [];
  if (source.length > MAX_FAULT_PLAN_ENTRIES) {
    throw new Error(
      `Synthetic fault plan cannot exceed ${MAX_FAULT_PLAN_ENTRIES} entries.`,
    );
  }
  const entries = source.map((entry, index) => normalizedEntry(entry, index));
  const identities = new Set<string>();
  for (const entry of entries) {
    const key = identityKey(entry);
    if (identities.has(key)) {
      throw new Error(
        `Synthetic fault plan contains duplicate identity ${key}.`,
      );
    }
    identities.add(key);
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    seed,
    entries: Object.freeze(entries),
  });
}

export function parseSyntheticFaultPlan(
  raw: string | undefined,
  seed: number,
): SyntheticFaultPlan {
  if (raw === undefined || raw === "") {
    return createSyntheticFaultPlan({ seed });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_FAULT_PLAN_BYTES) {
    throw new Error("Synthetic fault plan exceeds its byte limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Synthetic fault plan must be valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Synthetic fault plan must be a JSON array.");
  }
  return createSyntheticFaultPlan({
    seed,
    entries: parsed as SyntheticFaultPlanEntry[],
  });
}

export function resolveSyntheticFault(
  plan: SyntheticFaultPlan,
  identity: SyntheticStepIdentity,
): Readonly<SyntheticFaultPlanEntry> {
  const exact = plan.entries.find(
    (entry) => identityKey(entry) === identityKey(identity),
  );
  return (
    exact ??
    Object.freeze({
      ...identity,
      outcome: "success" as const,
      delayMs: 0,
    })
  );
}

function normalizedPathForComparison(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertRunScopedControlPath(
  options: SyntheticFaultControlOptions,
): void {
  if (!RUN_ID_PATTERN.test(options.runId)) {
    throw new Error("Synthetic fault control runId is invalid.");
  }
  parseSyntheticSeed(String(options.seed));
  if (
    !path.isAbsolute(options.runDirectory) ||
    !path.isAbsolute(options.controlFile)
  ) {
    throw new Error(
      "Synthetic fault control paths must be absolute and run scoped.",
    );
  }
  if (
    process.platform === "win32" &&
    (options.runDirectory.startsWith("\\\\") ||
      options.controlFile.startsWith("\\\\"))
  ) {
    throw new Error("Synthetic fault control cannot use a network path.");
  }
  const runDirectory = normalizedPathForComparison(options.runDirectory);
  const controlDirectory = normalizedPathForComparison(
    path.dirname(options.controlFile),
  );
  if (runDirectory !== controlDirectory) {
    throw new Error(
      "Synthetic fault control file must be directly inside its run directory.",
    );
  }
}

async function assertRealRunDirectory(runDirectory: string): Promise<void> {
  const resolved = path.resolve(runDirectory);
  const [metadata, canonical] = await Promise.all([
    lstat(resolved),
    realpath(resolved),
  ]);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    normalizedPathForComparison(canonical) !==
      normalizedPathForComparison(resolved)
  ) {
    throw new Error(
      "Synthetic fault control run directory must be a real local directory.",
    );
  }
}

function parseFaultControlDocument(
  raw: string,
  options: Pick<SyntheticFaultControlOptions, "runId" | "seed">,
): SyntheticFaultControlDocument {
  if (Buffer.byteLength(raw, "utf8") > MAX_FAULT_PLAN_BYTES) {
    throw new Error("Synthetic fault control document exceeds its byte limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Synthetic fault control document must be valid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new Error("Synthetic fault control document must be an object.");
  }
  const unexpected = Object.keys(parsed).filter(
    (key) => !CONTROL_DOCUMENT_KEYS.has(key),
  );
  if (
    unexpected.length > 0 ||
    parsed.schemaVersion !== 1 ||
    parsed.runId !== options.runId ||
    parsed.seed !== options.seed ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error(
      "Synthetic fault control document does not match this endurance run.",
    );
  }
  const revision = assertSafeInteger(parsed.revision, "control revision", 1);
  const plan = createSyntheticFaultPlan({
    seed: options.seed,
    entries: parsed.entries as SyntheticFaultPlanEntry[],
  });
  return Object.freeze({
    schemaVersion: 1,
    runId: options.runId,
    revision,
    seed: options.seed,
    entries: plan.entries,
  });
}

async function readFaultControlDocument(
  options: SyntheticFaultControlOptions,
): Promise<SyntheticFaultControlDocument | null> {
  await assertRealRunDirectory(options.runDirectory);
  let raw: string;
  try {
    const metadata = await lstat(options.controlFile);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(
        "Synthetic fault control must be a regular non-symlink file.",
      );
    }
    raw = await readFile(options.controlFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return parseFaultControlDocument(raw, options);
}

export function createFileBackedSyntheticFaultSource(
  options: SyntheticFaultControlOptions & { basePlan: SyntheticFaultPlan },
): SyntheticFaultSource {
  assertRunScopedControlPath(options);
  if (options.basePlan.seed !== options.seed) {
    throw new Error("Synthetic fault control base plan seed does not match.");
  }
  let latestRevision = 0;
  let latestDocumentHash: string | null = null;
  return Object.freeze({
    async resolve(identity: SyntheticStepIdentity) {
      const document = await readFaultControlDocument(options);
      if (!document) {
        if (latestRevision > 0) {
          throw new Error(
            "Synthetic fault control disappeared after activation; refusing rollback.",
          );
        }
        return resolveSyntheticFault(options.basePlan, identity);
      }
      if (document.revision < latestRevision) {
        throw new Error(
          `Synthetic fault control revision rollback (${document.revision} < ${latestRevision}).`,
        );
      }
      const documentHash = createHash("sha256")
        .update(JSON.stringify(document), "utf8")
        .digest("hex");
      if (
        document.revision === latestRevision &&
        latestDocumentHash !== null &&
        documentHash !== latestDocumentHash
      ) {
        throw new Error(
          `Synthetic fault control revision ${document.revision} changed without incrementing.`,
        );
      }
      latestRevision = document.revision;
      latestDocumentHash = documentHash;
      return resolveSyntheticFault(
        createSyntheticFaultPlan({
          seed: options.seed,
          entries: document.entries,
        }),
        identity,
      );
    },
  });
}

async function writeFaultControlDocument(
  options: SyntheticFaultControlOptions,
  revision: number,
  entries: ReadonlyArray<SyntheticFaultPlanEntry>,
): Promise<void> {
  await assertRealRunDirectory(options.runDirectory);
  const plan = createSyntheticFaultPlan({ seed: options.seed, entries });
  const document: SyntheticFaultControlDocument = {
    schemaVersion: 1,
    runId: options.runId,
    revision,
    seed: options.seed,
    entries: plan.entries,
  };
  const temporary = path.join(
    options.runDirectory,
    `.${path.basename(options.controlFile)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporary, "wx", SYNTHETIC_FAULT_CONTROL_FILE_MODE);
    await handle.writeFile(`${JSON.stringify(document)}\n`, "utf8");
    await handle.chmod(SYNTHETIC_FAULT_CONTROL_FILE_MODE);
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

export function createSyntheticFaultControlWriter(
  options: SyntheticFaultControlOptions,
): {
  set(entries: ReadonlyArray<SyntheticFaultPlanEntry>): Promise<number>;
  clear(): Promise<number>;
} {
  assertRunScopedControlPath(options);
  let serialized: Promise<void> = Promise.resolve();
  const update = (
    entries: ReadonlyArray<SyntheticFaultPlanEntry>,
  ): Promise<number> => {
    const operation = serialized.then(async () => {
      const current = await readFaultControlDocument(options);
      const revision = (current?.revision ?? 0) + 1;
      await writeFaultControlDocument(options, revision, entries);
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

function deterministicDigest(input: {
  seed: number;
  runId: string;
  identity: SyntheticStepIdentity;
}): string {
  return createHash("sha256")
    .update(
      [
        "synthetic-endurance-v1",
        String(input.seed),
        input.runId,
        String(input.identity.taskId),
        String(input.identity.attemptNumber),
        String(input.identity.step),
      ].join("\u0000"),
      "utf8",
    )
    .digest("hex");
}

export function buildSyntheticFixtureArguments(input: {
  seed: number;
  runId: string;
  identity: SyntheticStepIdentity;
}): SyntheticFixtureArguments {
  const digest = deterministicDigest(input);
  return Object.freeze({
    runId: input.runId,
    operationKey: `synthetic:v1:${digest}`,
    value: `work-unit:${digest.slice(0, 32)}`,
  });
}

/**
 * Deterministically assigns a requested multiset of faults to known steps.
 * The caller owns fault counts; the seed only selects stable target ordering.
 */
export function createSeededSyntheticFaultPlan(input: {
  seed: number;
  identities: ReadonlyArray<SyntheticStepIdentity>;
  outcomes: ReadonlyArray<Exclude<SyntheticFaultOutcome, "success">>;
}): SyntheticFaultPlan {
  if (input.outcomes.length > input.identities.length) {
    throw new Error("Synthetic fault plan has more faults than target steps.");
  }
  const seed = parseSyntheticSeed(String(input.seed));
  const ranked = input.identities
    .map((identity) => ({
      identity,
      rank: createHash("sha256")
        .update(`${seed}:${identityKey(identity)}`, "utf8")
        .digest("hex"),
    }))
    .sort((left, right) =>
      left.rank === right.rank
        ? identityKey(left.identity).localeCompare(identityKey(right.identity))
        : left.rank.localeCompare(right.rank),
    );
  return createSyntheticFaultPlan({
    seed,
    entries: input.outcomes.map((outcome, index) => ({
      ...ranked[index]!.identity,
      outcome,
    })),
  });
}
