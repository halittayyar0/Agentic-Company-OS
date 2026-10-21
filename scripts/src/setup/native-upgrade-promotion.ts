import path from "node:path";
import { lstat, rename } from "node:fs/promises";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import {
  assertInstallationLease,
  type InstallationLease,
} from "./installation-lease";
import {
  readNativeUpgradeJournal,
  writeNativeUpgradeJournal,
  type NativeUpgradeJournal,
} from "./native-upgrade-journal";
import { readBoundedRegularFile } from "./installation-files";
import { inventoryNativeCluster } from "./native-cluster-snapshot";
import {
  nativeUpgradeHash,
  replaceNativeUpgradeFile,
  syncNativeUpgradeDirectory,
} from "./native-upgrade-files";
import { readNativeLaunchPointer } from "./native-launch";
export type UpgradeCheckpoint = (event: string) => void | Promise<void>;

function paths(directory: string, journal: NativeUpgradeJournal) {
  const attempt = path.join(directory, "native-upgrades", journal.upgradeId),
    stage = path.join(attempt, "stage");
  return {
    attempt,
    stage,
    data: path.join(directory, "database"),
    stagedData: path.join(stage, "database"),
    previous: path.join(attempt, "previous-database"),
    metadata: path.join(directory, "installation.json"),
    pointer: path.join(path.dirname(directory), "native-launch.json"),
    receipt: path.join(stage, "migration-attempt/receipt.json"),
  };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("native_upgrade_promotion_identity");
  return value as Record<string, unknown>;
}
function metadataVariants(
  originalBytes: string,
  pointerBytes: string,
  directory: string,
  journal: NativeUpgradeJournal,
) {
  const original = record(JSON.parse(originalBytes)),
    plan = record(original.plan),
    options = record(original.runtimeOptions);
  const pointer = record(JSON.parse(pointerBytes));
  if (
    original.schemaVersion !== 1 ||
    original.phase !== "complete" ||
    plan.id !== journal.installationId ||
    typeof original.workspaceRoot !== "string" ||
    path.resolve(original.workspaceRoot) !== journal.sourceRoot ||
    options.nativeBundleCommit !== journal.sourceCommit ||
    pointer.schemaVersion !== 1 ||
    Object.keys(pointer).sort().join(",") !==
      "commit,directory,schemaVersion,workspaceRoot" ||
    pointer.workspaceRoot !== original.workspaceRoot ||
    pointer.commit !== journal.sourceCommit ||
    pointer.directory !== directory
  )
    throw new Error("native_upgrade_promotion_identity");
  const next = {
    ...original,
    workspaceRoot: journal.targetRoot,
    runtimeOptions: { ...options, nativeBundleCommit: journal.targetCommit },
  };
  return {
    guarded: JSON.stringify(
      { ...next, phase: "native_upgrade_incomplete" },
      null,
      2,
    ),
    complete: JSON.stringify({ ...next, phase: "complete" }, null, 2),
    pointer: JSON.stringify({
      schemaVersion: 1,
      workspaceRoot: journal.targetRoot,
      commit: journal.targetCommit,
      directory,
    }),
  };
}

async function readReceipt(directory: string, journal: NativeUpgradeJournal) {
  const p = paths(directory, journal);
  const bytes = await readBoundedRegularFile(p.receipt, 128 * 1024, {
    rejectSymlinks: true,
  });
  const row = record(JSON.parse(bytes));
  const digest = (value: unknown): value is string =>
    typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  if (
    Object.keys(row).sort().join(",") !==
      "dataDirectory,installationId,paused,previouslyPaused,runtimeVersion,schemaVersion,sequences,sourceCommit,tables,targetCommit,upgradeId,writeAndSequenceProbe" ||
    row.schemaVersion !== 1 ||
    row.installationId !== journal.installationId ||
    row.upgradeId !== journal.upgradeId ||
    row.sourceCommit !== journal.sourceCommit ||
    row.targetCommit !== journal.targetCommit ||
    row.dataDirectory !== p.stagedData ||
    row.paused !== true ||
    row.writeAndSequenceProbe !== true ||
    typeof row.previouslyPaused !== "boolean" ||
    !Number.isSafeInteger(row.runtimeVersion) ||
    Number(row.runtimeVersion) < 1 ||
    !Array.isArray(row.tables) ||
    row.tables.length < 1 ||
    row.tables.length > 4096 ||
    !Array.isArray(row.sequences) ||
    row.sequences.length > 4096
  )
    throw new Error("native_upgrade_receipt_invalid");
  const names = new Set<string>();
  for (const table of row.tables) {
    const value = record(table);
    if (
      typeof value.name !== "string" ||
      !value.name ||
      names.has(value.name) ||
      !Array.isArray(value.columns) ||
      value.columns.length < 1 ||
      value.columns.length > 1600 ||
      value.columns.some(
        (column: unknown) => typeof column !== "string" || !column,
      ) ||
      !Number.isSafeInteger(value.rows) ||
      Number(value.rows) < 0 ||
      !digest(value.sha256)
    )
      throw new Error("native_upgrade_receipt_invalid");
    names.add(value.name);
  }
  if (!["agents", "tasks", "runtime_controls"].every((name) => names.has(name)))
    throw new Error("native_upgrade_receipt_invalid");
  names.clear();
  for (const sequence of row.sequences) {
    const value = record(sequence);
    if (
      typeof value.name !== "string" ||
      !value.name ||
      names.has(value.name) ||
      typeof value.called !== "boolean" ||
      typeof value.lastValue !== "string" ||
      !/^-?\d{1,20}$/u.test(value.lastValue)
    )
      throw new Error("native_upgrade_receipt_invalid");
    names.add(value.name);
  }
  return { bytes, sha256: nativeUpgradeHash(bytes) };
}
async function present(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function requireTree(directory: string, expected: string | null) {
  if (
    !expected ||
    (await inventoryNativeCluster(directory)).sha256 !== expected
  )
    throw new Error("native_upgrade_database_changed");
}
async function move(from: string, to: string) {
  await rename(from, to);
  await syncNativeUpgradeDirectory(path.dirname(from));
  await syncNativeUpgradeDirectory(path.dirname(to));
}

/** Qualify stopped staging while the caller owns the instance lease. */
export async function qualifyNativePromotion(input: {
  directory: string;
  lease: InstallationLease;
  expectedSourceDatabaseSha256: string;
  checkpoint?: UpgradeCheckpoint;
}): Promise<NativeUpgradeJournal> {
  const { directory, lease } = input;
  const journal = await readNativeUpgradeJournal(directory);
  if (!journal || journal.phase !== "preparing")
    throw new Error("native_upgrade_not_preparing");
  assertInstallationLease(lease, directory, journal.installationId);
  const p = paths(directory, journal);
  const devices = await Promise.all(
    [directory, p.data, p.stagedData, p.attempt].map(
      async (folder) => (await lstat(folder)).dev,
    ),
  );
  if (new Set(devices).size !== 1)
    throw new Error("native_upgrade_filesystem_unsupported");
  const original = await readBoundedRegularFile(p.metadata, 64000, {
    rejectSymlinks: true,
  });
  const pointer = await readBoundedRegularFile(p.pointer, 8192, {
    rejectSymlinks: true,
  });
  if (
    nativeUpgradeHash(original) !== journal.originalMetadataSha256 ||
    nativeUpgradeHash(pointer) !== journal.originalPointerSha256 ||
    (await present(p.previous))
  )
    throw new Error("native_upgrade_file_changed");
  metadataVariants(original, pointer, directory, journal);
  if (
    (await present(path.join(p.data, "postmaster.pid"))) ||
    (await present(path.join(p.stagedData, "postmaster.pid")))
  )
    throw new Error("native_upgrade_database_running");
  await requireTree(p.data, input.expectedSourceDatabaseSha256);
  const staged = await inventoryNativeCluster(p.stagedData),
    receipt = await readReceipt(directory, journal);
  const storage = new OwnerPrivateStorage(p.attempt);
  await storage.initialize();
  await storage.write("original-installation.json", original);
  await storage.write("original-launch.json", pointer);
  const next: NativeUpgradeJournal = {
    ...journal,
    phase: "staged",
    sourceDatabaseSha256: input.expectedSourceDatabaseSha256,
    stagedDatabaseSha256: staged.sha256,
    migrationReceiptSha256: receipt.sha256,
  };
  await writeNativeUpgradeJournal(directory, next, lease);
  await input.checkpoint?.("journal:staged");
  return next;
}

/** Evidence-driven roll-forward. Never starts PostgreSQL/workers or rolls back
 * a complete installation, whose data may already contain new user work.
 */
export async function promoteNativeUpgrade(input: {
  directory: string;
  lease: InstallationLease;
  checkpoint?: UpgradeCheckpoint;
}): Promise<NativeUpgradeJournal> {
  const { directory, lease } = input;
  let journal = await readNativeUpgradeJournal(directory);
  if (!journal || ["preparing", "abandoned"].includes(journal.phase))
    throw new Error("native_upgrade_not_staged");
  assertInstallationLease(lease, directory, journal.installationId);
  const p = paths(directory, journal);
  if (journal.phase === "complete") {
    const current = record(
      JSON.parse(
        await readBoundedRegularFile(p.metadata, 64000, {
          rejectSymlinks: true,
        }),
      ),
    );
    if (
      record(current.plan).id !== journal.installationId ||
      typeof current.workspaceRoot !== "string" ||
      path.resolve(current.workspaceRoot) !== journal.targetRoot ||
      record(current.runtimeOptions).nativeBundleCommit !==
        journal.targetCommit ||
      (await readNativeLaunchPointer(
        path.dirname(directory),
        journal.targetRoot,
        journal.targetCommit,
      )) !== directory
    )
      throw new Error("native_upgrade_promotion_identity");
    return journal;
  }
  const original = await readBoundedRegularFile(
    path.join(p.attempt, "original-installation.json"),
    64000,
    { rejectSymlinks: true },
  );
  const oldPointer = await readBoundedRegularFile(
    path.join(p.attempt, "original-launch.json"),
    8192,
    { rejectSymlinks: true },
  );
  if (
    nativeUpgradeHash(original) !== journal.originalMetadataSha256 ||
    nativeUpgradeHash(oldPointer) !== journal.originalPointerSha256
  )
    throw new Error("native_upgrade_backup_changed");
  const variants = metadataVariants(original, oldPointer, directory, journal);
  if (
    (await readReceipt(directory, journal)).sha256 !==
    journal.migrationReceiptSha256
  )
    throw new Error("native_upgrade_receipt_changed");
  const advance = async (
    phase: NativeUpgradeJournal["phase"],
  ): Promise<NativeUpgradeJournal> => {
    const next: NativeUpgradeJournal = { ...journal!, phase };
    await writeNativeUpgradeJournal(directory, next, lease);
    await input.checkpoint?.(`journal:${phase}`);
    return next;
  };
  while (journal.phase !== "complete") {
    const metadata = await readBoundedRegularFile(p.metadata, 64000, {
      rejectSymlinks: true,
    });
    const pointer = await readBoundedRegularFile(p.pointer, 8192, {
      rejectSymlinks: true,
    });
    const allowedMetadata =
      journal.phase === "staged"
        ? [original, variants.guarded]
        : journal.phase === "pointer_bound"
          ? [variants.guarded, variants.complete]
          : [variants.guarded];
    const allowedPointers =
      journal.phase === "promoted"
        ? [oldPointer, variants.pointer]
        : journal.phase === "pointer_bound"
          ? [variants.pointer]
          : [oldPointer];
    if (
      !allowedMetadata.includes(metadata) ||
      !allowedPointers.includes(pointer)
    )
      throw new Error("native_upgrade_file_changed");
    if (journal.phase === "staged") {
      await requireTree(p.data, journal.sourceDatabaseSha256);
      await requireTree(p.stagedData, journal.stagedDatabaseSha256);
      if (await present(p.previous))
        throw new Error("native_upgrade_ambiguous_database");
      await input.checkpoint?.("guard:before");
      await replaceNativeUpgradeFile(
        p.metadata,
        journal.originalMetadataSha256,
        variants.guarded,
      );
      await input.checkpoint?.("guard:after");
      journal = await advance("guarded");
    } else if (journal.phase === "guarded") {
      await requireTree(p.stagedData, journal.stagedDatabaseSha256);
      const dataExists = await present(p.data),
        backupExists = await present(p.previous);
      if (dataExists === backupExists)
        throw new Error("native_upgrade_ambiguous_database");
      if (dataExists) {
        await requireTree(p.data, journal.sourceDatabaseSha256);
        await input.checkpoint?.("retain:before");
        await move(p.data, p.previous);
        await input.checkpoint?.("retain:after");
      }
      await requireTree(p.previous, journal.sourceDatabaseSha256);
      journal = await advance("original_retained");
    } else if (journal.phase === "original_retained") {
      await requireTree(p.previous, journal.sourceDatabaseSha256);
      const dataExists = await present(p.data),
        stagedExists = await present(p.stagedData);
      if (dataExists === stagedExists)
        throw new Error("native_upgrade_ambiguous_database");
      if (stagedExists) {
        await requireTree(p.stagedData, journal.stagedDatabaseSha256);
        await input.checkpoint?.("promote:before");
        await move(p.stagedData, p.data);
        await input.checkpoint?.("promote:after");
      }
      await requireTree(p.data, journal.stagedDatabaseSha256);
      journal = await advance("promoted");
    } else if (
      journal.phase === "promoted" ||
      journal.phase === "pointer_bound"
    ) {
      await requireTree(p.previous, journal.sourceDatabaseSha256);
      await requireTree(p.data, journal.stagedDatabaseSha256);
      if (await present(p.stagedData))
        throw new Error("native_upgrade_ambiguous_database");
      if (journal.phase === "promoted") {
        await input.checkpoint?.("pointer:before");
        await replaceNativeUpgradeFile(
          p.pointer,
          journal.originalPointerSha256,
          variants.pointer,
        );
        await input.checkpoint?.("pointer:after");
        journal = await advance("pointer_bound");
      } else {
        await input.checkpoint?.("finalize:before");
        await replaceNativeUpgradeFile(
          p.metadata,
          nativeUpgradeHash(variants.guarded),
          variants.complete,
        );
        await input.checkpoint?.("finalize:after");
        journal = await advance("complete");
      }
    } else throw new Error("native_upgrade_journal_transition");
  }
  return journal;
}
