import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import {
  assertInstallationLease,
  type InstallationLease,
} from "./installation-lease";
import { readBoundedRegularFile } from "./installation-files";
export type NativeUpgradePhase =
  | "preparing"
  | "staged"
  | "guarded"
  | "original_retained"
  | "promoted"
  | "pointer_bound"
  | "complete"
  | "abandoned";
export interface NativeUpgradeJournal {
  schemaVersion: 1;
  upgradeId: string;
  installationId: string;
  phase: NativeUpgradePhase;
  sourceRoot: string;
  targetRoot: string;
  sourceCommit: string;
  targetCommit: string;
  appPort: number;
  createdAt: string;
  originalMetadataSha256: string;
  originalPointerSha256: string;
  sourceDatabaseSha256: string | null;
  stagedDatabaseSha256: string | null;
  migrationReceiptSha256: string | null;
}
const phases: NativeUpgradePhase[] = [
  "preparing",
  "staged",
  "guarded",
  "original_retained",
  "promoted",
  "pointer_bound",
  "complete",
  "abandoned",
];
const transitions: Partial<Record<NativeUpgradePhase, NativeUpgradePhase[]>> = {
  preparing: ["staged", "abandoned"],
  staged: ["guarded", "abandoned"],
  guarded: ["original_retained"],
  original_retained: ["promoted"],
  promoted: ["pointer_bound"],
  pointer_bound: ["complete"],
};
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length === 36 &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
const hex = (value: unknown, length: number): value is string =>
  typeof value === "string" &&
  value.length === length &&
  /^[a-f0-9]+$/u.test(value);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const contains = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return (
    !relative ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};
const overlap = (a: string, b: string) => contains(a, b) || contains(b, a);

export function validateNativeUpgradeJournal(
  value: unknown,
  directory: string,
): NativeUpgradeJournal {
  const fail = () => {
    throw new Error("native_upgrade_journal_invalid");
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !==
      "appPort,createdAt,installationId,migrationReceiptSha256,originalMetadataSha256,originalPointerSha256,phase,schemaVersion,sourceCommit,sourceDatabaseSha256,sourceRoot,stagedDatabaseSha256,targetCommit,targetRoot,upgradeId" ||
    row.schemaVersion !== 1 ||
    !uuid(row.upgradeId) ||
    !uuid(row.installationId) ||
    path.basename(directory) !== `instance-${row.installationId}` ||
    !path.isAbsolute(directory) ||
    !phases.includes(row.phase as NativeUpgradePhase) ||
    !hex(row.sourceCommit, 40) ||
    !hex(row.targetCommit, 40) ||
    row.sourceCommit === row.targetCommit ||
    !Number.isInteger(row.appPort) ||
    Number(row.appPort) < 1024 ||
    Number(row.appPort) > 65535 ||
    typeof row.createdAt !== "string" ||
    !Number.isFinite(Date.parse(row.createdAt)) ||
    new Date(row.createdAt).toISOString() !== row.createdAt ||
    !hex(row.originalMetadataSha256, 64) ||
    !hex(row.originalPointerSha256, 64)
  )
    return fail();
  for (const name of ["sourceRoot", "targetRoot"] as const) {
    const root = row[name];
    if (
      typeof root !== "string" ||
      root.length > 4096 ||
      /[\r\n\0]/u.test(root) ||
      !path.isAbsolute(root) ||
      path.resolve(root) !== root ||
      overlap(root, directory)
    )
      return fail();
  }
  if (overlap(row.sourceRoot as string, row.targetRoot as string))
    return fail();
  const hashes = [
    row.sourceDatabaseSha256,
    row.stagedDatabaseSha256,
    row.migrationReceiptSha256,
  ];
  const allEmpty = hashes.every((value) => value === null),
    allBound = hashes.every((value) => hex(value, 64));
  if (
    row.phase === "preparing"
      ? !allEmpty
      : row.phase === "abandoned"
        ? !allEmpty && !allBound
        : !allBound
  )
    return fail();
  return { ...row } as unknown as NativeUpgradeJournal;
}

export async function readNativeUpgradeJournal(
  directory: string,
): Promise<NativeUpgradeJournal | null> {
  if (
    !path.isAbsolute(directory) ||
    (await realpath(directory)) !== path.resolve(directory) ||
    !(await lstat(directory)).isDirectory()
  )
    throw new Error("native_upgrade_journal_path");
  let bytes: string;
  try {
    bytes = await readBoundedRegularFile(
      path.join(directory, "native-upgrade.json"),
      64000,
      { rejectSymlinks: true },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return validateNativeUpgradeJournal(JSON.parse(bytes), directory);
  } catch {
    throw new Error("native_upgrade_journal_invalid");
  }
}

export async function writeNativeUpgradeJournal(
  directory: string,
  journal: NativeUpgradeJournal,
  lease: InstallationLease,
): Promise<void> {
  const next = validateNativeUpgradeJournal(journal, directory);
  assertInstallationLease(lease, directory, next.installationId);
  const previous = await readNativeUpgradeJournal(directory);
  if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
  if (
    previous &&
    ["complete", "abandoned"].includes(previous.phase) &&
    next.phase === "preparing"
  ) {
    const completed = previous.phase === "complete";
    if (
      next.upgradeId === previous.upgradeId ||
      next.installationId !== previous.installationId ||
      next.sourceRoot !==
        (completed ? previous.targetRoot : previous.sourceRoot) ||
      next.sourceCommit !==
        (completed ? previous.targetCommit : previous.sourceCommit)
    )
      throw new Error("native_upgrade_journal_transition");
    const upgrades = new OwnerPrivateStorage(
      path.join(directory, "native-upgrades"),
    );
    await upgrades.initialize();
    const archive = new OwnerPrivateStorage(
      path.join(upgrades.directory, previous.upgradeId),
    );
    await archive.initialize();
    await archive.write("journal.json", JSON.stringify(previous));
  } else if (previous) {
    const stable = (value: NativeUpgradeJournal) =>
      JSON.stringify({
        ...value,
        phase: null,
        sourceDatabaseSha256: null,
        stagedDatabaseSha256: null,
        migrationReceiptSha256: null,
      });
    if (
      !transitions[previous.phase]?.includes(next.phase) ||
      stable(previous) !== stable(next) ||
      (previous.phase !== "preparing" &&
        (next.sourceDatabaseSha256 !== previous.sourceDatabaseSha256 ||
          next.stagedDatabaseSha256 !== previous.stagedDatabaseSha256 ||
          next.migrationReceiptSha256 !== previous.migrationReceiptSha256))
    )
      throw new Error("native_upgrade_journal_transition");
  } else if (next.phase !== "preparing")
    throw new Error("native_upgrade_journal_transition");
  if (next.phase === "abandoned") {
    const metadata = await readBoundedRegularFile(
      path.join(directory, "installation.json"),
      64000,
      { rejectSymlinks: true },
    );
    const pointer = await readBoundedRegularFile(
      path.join(path.dirname(directory), "native-launch.json"),
      8192,
      { rejectSymlinks: true },
    );
    if (
      hash(metadata) !== next.originalMetadataSha256 ||
      hash(pointer) !== next.originalPointerSha256
    )
      throw new Error("native_upgrade_cannot_abandon");
  }
  const storage = new OwnerPrivateStorage(directory);
  await storage.initialize();
  await storage.write("native-upgrade.json", JSON.stringify(next));
}

export async function assertNativeUpgradeStartupReady(
  directory: string,
  root: string,
  commit: string,
): Promise<NativeUpgradeJournal | null> {
  const journal = await readNativeUpgradeJournal(directory);
  if (!journal) return null;
  const completed = journal.phase === "complete",
    abandoned = journal.phase === "abandoned";
  if (
    (!completed && !abandoned) ||
    path.resolve(root) !==
      (completed ? journal.targetRoot : journal.sourceRoot) ||
    commit !== (completed ? journal.targetCommit : journal.sourceCommit)
  )
    throw new Error("native_upgrade_recovery_required");
  return journal;
}
