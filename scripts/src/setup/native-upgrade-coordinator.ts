import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { executeBoundedCommand } from "../endurance/process-supervisor";
import { createManagedPostgres } from "./managed-postgres";
import {
  acquireInstallationLease,
  type InstallationLease,
} from "./installation-lease";
import { snapshotNativeCluster } from "./native-cluster-snapshot";
import { readNativeDistribution } from "./native-distribution";
import { readNativeRelease } from "./native-release";
import {
  inspectNativeUpgrade,
  inspectNativeUpgradePackages,
} from "./native-upgrade-preflight";
import {
  readNativeUpgradeJournal,
  writeNativeUpgradeJournal,
  type NativeUpgradeJournal,
} from "./native-upgrade-journal";
import {
  promoteNativeUpgrade,
  qualifyNativePromotion,
  type UpgradeCheckpoint,
} from "./native-upgrade-promotion";
import { startNativeUpgradePostgres } from "./native-upgrade-postgres-client";
import type { InstallationResources } from "./resources";
import { readBoundedRegularFile } from "./installation-files";
import { nativeUpgradeHash } from "./native-upgrade-files";

type Inspection = Awaited<ReturnType<typeof inspectNativeUpgrade>>;
type Cluster = Pick<
  ReturnType<typeof createManagedPostgres>,
  "prepare" | "inspectStopped"
>;
interface Dependencies {
  cluster(input: Parameters<typeof createManagedPostgres>[0]): Cluster;
  stage: typeof startNativeUpgradePostgres;
  run: typeof executeBoundedCommand;
}
export interface NativeUpgradeProgress {
  phase:
    | "checking"
    | "copying"
    | "migrating"
    | "qualifying"
    | "promoting"
    | "recovering"
    | "complete";
  copiedFiles?: number;
}
export interface NativeUpgradeOptions {
  directory: string;
  targetRoot: string;
  signal?: AbortSignal;
  onProgress?: (event: NativeUpgradeProgress) => void | Promise<void>;
  /** Local setup stores the reviewed identity server-side, never trusts a
   * client-supplied path/commit to authorize changed installation state. */
  expectedReview?: {
    sourceCommit: string;
    targetCommit: string;
    metadataSha256: string;
    pointerSha256: string;
  };
  expectedUpgradeId?: string;
  /** Internal failure-evidence hook; not accepted from installer/browser input. */
  checkpoint?: UpgradeCheckpoint;
}
export interface NativeUpgradeResult {
  directory: string;
  upgradeId: string;
  journal: NativeUpgradeJournal;
  /** Caller must transfer this exact lease to the installation executor or release
   * it on failure. No unlock/relock gap or IPC serialization is permitted. */
  lease: InstallationLease;
}

async function existingDatabase(directory: string): Promise<void> {
  const data = path.join(directory, "database"),
    info = await lstat(data);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (await realpath(data)) !== data
  )
    throw new Error("native_upgrade_database_identity");
}
function resources(
  directory: string,
  databaseDirectory = directory,
): InstallationResources {
  const secrets = path.join(directory, "secrets");
  return {
    directory: databaseDirectory,
    secretFiles: {
      database_url: path.join(secrets, "database_url"),
      operator_auth_token: path.join(secrets, "operator_auth_token"),
      runtime_control_key: path.join(secrets, "runtime_control_key"),
    },
  };
}
async function progress(
  options: NativeUpgradeOptions,
  event: NativeUpgradeProgress,
) {
  // An observer/browser disconnect cannot interrupt a guarded filesystem cutover.
  try {
    await options.onProgress?.(event);
  } catch {
    /* authoritative journal remains available */
  }
}
function result(
  directory: string,
  journal: NativeUpgradeJournal,
  lease: InstallationLease,
): NativeUpgradeResult {
  return { directory, upgradeId: journal.upgradeId, journal, lease };
}

/** Connect verified packages, cold staging and journaled promotion. Never starts
 * the original cluster, API, agents or providers. Production dependencies are
 * fixed; constructor injection supports filesystem/ordering failure tests.
 */
export function createNativeUpgradeCoordinator(
  overrides: Partial<Dependencies> = {},
) {
  const dependencies: Dependencies = {
    cluster: createManagedPostgres,
    stage: startNativeUpgradePostgres,
    run: executeBoundedCommand,
    ...overrides,
  };
  async function prepareAndPromote(
    options: NativeUpgradeOptions,
    inspection: Inspection,
    lease: InstallationLease,
  ) {
    const directory = inspection.installation.directory;
    const cluster = (stage = directory, signal?: AbortSignal) =>
      dependencies.cluster({
        resources: resources(directory, stage),
        planId: inspection.installation.id,
        postgresRoot: path.join(inspection.target.root, "runtime/postgres"),
        postgresVersion: inspection.target.postgresVersion,
        signal,
      });
    // prepare() can initialize missing data; never call it until this check passes.
    await existingDatabase(directory);
    const original = cluster(directory, options.signal);
    await original.prepare();
    await original.inspectStopped();
    options.signal?.throwIfAborted();
    const journal: NativeUpgradeJournal = {
      schemaVersion: 1,
      upgradeId: randomUUID(),
      installationId: inspection.installation.id,
      phase: "preparing",
      sourceRoot: inspection.source.root,
      targetRoot: inspection.target.root,
      sourceCommit: inspection.source.commit,
      targetCommit: inspection.target.commit,
      appPort: inspection.installation.port,
      createdAt: new Date().toISOString(),
      originalMetadataSha256: inspection.installation.metadataSha256,
      originalPointerSha256: inspection.installation.pointerSha256,
      sourceDatabaseSha256: null,
      stagedDatabaseSha256: null,
      migrationReceiptSha256: null,
    };
    await writeNativeUpgradeJournal(directory, journal, lease);
    await options.checkpoint?.("journal:preparing");
    const snapshot = await snapshotNativeCluster({
      directory,
      upgradeId: journal.upgradeId,
      signal: options.signal,
      inspectStopped: () => original.inspectStopped(),
      onProgress: (event) =>
        progress(options, { phase: "copying", copiedFiles: event.copiedFiles }),
    });
    await progress(options, { phase: "migrating" });
    const stage = await dependencies.stage({
      stagingDirectory: snapshot.stagingDirectory,
      targetRoot: inspection.target.root,
      signal: options.signal,
    });
    try {
      const command = path.join(
        inspection.target.root,
        process.platform === "win32"
          ? "runtime/node/node.exe"
          : "runtime/node/bin/node",
      );
      let passed = false;
      try {
        const execution = await dependencies.run({
          command,
          args: [
            path.join(
              inspection.target.root,
              "artifacts/api-server/dist/native-upgrade.mjs",
            ),
            "--staging-directory",
            snapshot.stagingDirectory,
            "--upgrade-id",
            journal.upgradeId,
            "--target-commit",
            journal.targetCommit,
          ],
          cwd: inspection.target.root,
          environment: {
            ...process.env,
            NODE_OPTIONS: "",
            NODE_PATH: "",
            LC_ALL: "C",
          },
          timeoutMs: 15 * 60_000,
          maxBufferBytes: 64 * 1024,
          ignoreInheritedStdio: false,
          signal: options.signal,
        });
        passed = execution.exitCode === 0;
      } catch {
        /* CLI output/errors can contain private environment details. */
      }
      if (!passed) throw new Error("native_upgrade_migration_failed");
    } finally {
      // Join owned PG shutdown even if migration fails or the user cancels.
      await stage.stop();
    }
    options.signal?.throwIfAborted();
    await existingDatabase(snapshot.stagingDirectory);
    const stoppedCopy = cluster(snapshot.stagingDirectory);
    await stoppedCopy.prepare();
    await stoppedCopy.inspectStopped();
    await progress(options, { phase: "qualifying" });
    options.signal?.throwIfAborted();
    await qualifyNativePromotion({
      directory,
      lease,
      expectedSourceDatabaseSha256: snapshot.inventory.sha256,
      checkpoint: options.checkpoint,
    });
    options.signal?.throwIfAborted();
    await progress(options, { phase: "promoting" });
    options.signal?.throwIfAborted();
    // Once guarding begins ordinary cancellation must not strand the namespace.
    const complete = await promoteNativeUpgrade({
      directory,
      lease,
      checkpoint: options.checkpoint,
    });
    await progress(options, { phase: "complete" });
    return result(directory, complete, lease);
  }
  return {
    async upgrade(options: NativeUpgradeOptions): Promise<NativeUpgradeResult> {
      options.signal?.throwIfAborted();
      await progress(options, { phase: "checking" });
      const initial = await inspectNativeUpgrade(options);
      if (
        options.expectedReview &&
        (options.expectedReview.sourceCommit !== initial.source.commit ||
          options.expectedReview.targetCommit !== initial.target.commit ||
          options.expectedReview.metadataSha256 !==
            initial.installation.metadataSha256 ||
          options.expectedReview.pointerSha256 !==
            initial.installation.pointerSha256)
      )
        throw new Error("native_upgrade_review_changed");
      const lease = await acquireInstallationLease(
        initial.installation.directory,
        initial.installation.port,
        initial.installation.id,
      );
      let returned = false;
      try {
        await options.checkpoint?.("lease:acquired");
        options.signal?.throwIfAborted();
        const inspection = await inspectNativeUpgrade(options);
        if (JSON.stringify(inspection) !== JSON.stringify(initial))
          throw new Error("native_upgrade_identity_changed");
        const previous = await readNativeUpgradeJournal(
          inspection.installation.directory,
        );
        if (previous && !["abandoned", "complete"].includes(previous.phase))
          throw new Error("native_upgrade_recovery_required");
        const completed = await prepareAndPromote(options, inspection, lease);
        returned = true;
        return completed;
      } finally {
        if (!returned) await lease.release();
      }
    },
    async recover(
      options: NativeUpgradeOptions & { retryPreparation?: boolean },
    ): Promise<NativeUpgradeResult> {
      options.signal?.throwIfAborted();
      if (
        !path.isAbsolute(options.directory) ||
        path.resolve(options.directory) !== options.directory ||
        !path.isAbsolute(options.targetRoot) ||
        path.resolve(options.targetRoot) !== options.targetRoot
      )
        throw new Error("native_upgrade_recovery_identity");
      const initial = await readNativeUpgradeJournal(options.directory);
      if (!initial || initial.targetRoot !== options.targetRoot)
        throw new Error("native_upgrade_recovery_identity");
      if (
        options.expectedUpgradeId &&
        initial.upgradeId !== options.expectedUpgradeId
      )
        throw new Error("native_upgrade_review_changed");
      const lease = await acquireInstallationLease(
        options.directory,
        initial.appPort,
        initial.installationId,
      );
      let returned = false;
      try {
        const journal = await readNativeUpgradeJournal(options.directory);
        if (JSON.stringify(journal) !== JSON.stringify(initial))
          throw new Error("native_upgrade_identity_changed");
        if (options.expectedReview) {
          const pointer = await readBoundedRegularFile(
            path.join(path.dirname(options.directory), "native-launch.json"),
            8192,
            { rejectSymlinks: true },
          );
          if (
            options.expectedReview.sourceCommit !== initial.sourceCommit ||
            options.expectedReview.targetCommit !== initial.targetCommit ||
            options.expectedReview.metadataSha256 !==
              initial.originalMetadataSha256 ||
            options.expectedReview.pointerSha256 !== nativeUpgradeHash(pointer)
          )
            throw new Error("native_upgrade_review_changed");
        }
        await progress(options, { phase: "recovering" });
        if (["preparing", "abandoned"].includes(initial.phase)) {
          if (!options.retryPreparation)
            throw new Error("native_upgrade_preparation_retry_required");
          const inspection = await inspectNativeUpgrade(options);
          if (
            inspection.source.commit !== initial.sourceCommit ||
            inspection.target.commit !== initial.targetCommit ||
            inspection.installation.id !== initial.installationId
          )
            throw new Error("native_upgrade_recovery_identity");
          // Keep failed copies and receipts. Never rerun a reserved CLI attempt.
          // The writer requires untouched original metadata/pointer to abandon.
          if (initial.phase === "preparing")
            await writeNativeUpgradeJournal(
              options.directory,
              { ...initial, phase: "abandoned" },
              lease,
            );
          const completed = await prepareAndPromote(options, inspection, lease);
          returned = true;
          return completed;
        }
        if (initial.phase === "complete") {
          // Source package/backups may have been archived after successful use.
          // Only the current target identity matters; never freeze accepted data.
          const distribution = await readNativeDistribution(initial.targetRoot);
          if (
            !distribution ||
            distribution.commit !== initial.targetCommit ||
            !(await readNativeRelease(initial.targetRoot, distribution))
          )
            throw new Error("native_upgrade_recovery_identity");
        } else {
          const packages = await inspectNativeUpgradePackages(initial);
          if (
            packages.source.summary.commit !== initial.sourceCommit ||
            packages.target.summary.commit !== initial.targetCommit
          )
            throw new Error("native_upgrade_recovery_identity");
          options.signal?.throwIfAborted();
        }
        const complete = await promoteNativeUpgrade({
          directory: options.directory,
          lease,
          checkpoint: options.checkpoint,
        });
        await progress(options, { phase: "complete" });
        returned = true;
        return result(options.directory, complete, lease);
      } finally {
        if (!returned) await lease.release();
      }
    },
  };
}
