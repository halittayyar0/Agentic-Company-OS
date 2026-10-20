import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { createManagedPostgres } from "./managed-postgres";
import { readNativeDistribution } from "./native-distribution";
import { readNativeUpgradeJournal } from "./native-upgrade-journal";
import { readBoundedRegularFile } from "./installation-files";

/** Only an existing copy belonging to the current preparing attempt is allowed.
 * No credentials travel over IPC or command arguments. No initdb is permitted.
 */
export async function createNativeUpgradePostgresWorker(options: {
  stagingDirectory: string;
  targetRoot: string;
  signal: AbortSignal;
}) {
  const stage = options.stagingDirectory,
    target = options.targetRoot;
  if (
    !path.isAbsolute(stage) ||
    path.resolve(stage) !== stage ||
    !path.isAbsolute(target) ||
    path.resolve(target) !== target
  )
    throw new Error("native_upgrade_staging_identity");
  const attempt = path.dirname(stage),
    upgrades = path.dirname(attempt),
    directory = path.dirname(upgrades);
  if (
    path.basename(stage) !== "stage" ||
    path.basename(upgrades) !== "native-upgrades"
  )
    throw new Error("native_upgrade_staging_identity");
  for (const name of [
    stage,
    path.join(stage, "database"),
    attempt,
    upgrades,
    directory,
    path.join(directory, "secrets"),
    target,
  ]) {
    options.signal.throwIfAborted();
    const info = await lstat(name);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(name)) !== name
    )
      throw new Error("native_upgrade_staging_identity");
  }
  const journal = await readNativeUpgradeJournal(directory);
  if (
    !journal ||
    journal.phase !== "preparing" ||
    journal.upgradeId !== path.basename(attempt) ||
    journal.targetRoot !== target
  )
    throw new Error("native_upgrade_staging_identity");
  const distribution = await readNativeDistribution(target);
  if (!distribution || distribution.commit !== journal.targetCommit)
    throw new Error("native_upgrade_staging_identity");
  for (const [file, expected] of [
    [path.join(directory, "installation.json"), journal.originalMetadataSha256],
    [
      path.join(path.dirname(directory), "native-launch.json"),
      journal.originalPointerSha256,
    ],
  ]) {
    const bytes = await readBoundedRegularFile(file, 64000, {
      rejectSymlinks: true,
    });
    if (createHash("sha256").update(bytes).digest("hex") !== expected)
      throw new Error("native_upgrade_staging_identity");
  }
  options.signal.throwIfAborted();
  const secrets = path.join(directory, "secrets");
  const managed = createManagedPostgres({
    resources: {
      directory: stage,
      secretFiles: {
        database_url: path.join(secrets, "database_url"),
        operator_auth_token: path.join(secrets, "operator_auth_token"),
        runtime_control_key: path.join(secrets, "runtime_control_key"),
      },
    },
    postgresRoot: path.join(target, "runtime/postgres"),
    postgresVersion: distribution.postgresVersion,
    planId: journal.installationId,
    purpose: "upgrade_staging",
    signal: options.signal,
  });
  return {
    async prepare() {
      // Recheck immediately before prepare; missing copies must never be initialized.
      const info = await lstat(path.join(stage, "database"));
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("native_upgrade_staging_identity");
      await managed.prepare();
    },
    start: () => managed.start(),
    stop: () => managed.stop(),
  };
}
