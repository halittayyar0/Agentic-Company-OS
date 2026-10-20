import { lstat, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import { readBoundedRegularFile } from "./resume";
import { writeExactOutputBundle } from "../endurance/safe-output";

/** Only the new disposable staging copy can receive this configuration.
 * The original cluster and its configuration are never rewritten.
 */
async function stagingData(directory: string): Promise<string> {
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
  const attempt = path.dirname(directory),
    upgrades = path.dirname(attempt),
    instance = path.dirname(upgrades);
  if (
    !path.isAbsolute(directory) ||
    path.resolve(directory) !== directory ||
    path.basename(directory) !== "stage" ||
    !uuid.test(path.basename(attempt)) ||
    path.basename(upgrades) !== "native-upgrades" ||
    !path.basename(instance).startsWith("instance-") ||
    !uuid.test(path.basename(instance).slice(9))
  )
    throw new Error("native_upgrade_staging_identity");
  if (
    (await realpath(directory)) !== directory ||
    !(await lstat(directory)).isDirectory()
  )
    throw new Error("native_upgrade_staging_identity");
  await new OwnerPrivateStorage(directory).initialize();
  const data = path.join(directory, "database");
  if ((await realpath(data)) !== data || !(await lstat(data)).isDirectory())
    throw new Error("native_upgrade_staging_identity");
  for (const name of ["postmaster.pid", "standby.signal", "recovery.signal"]) {
    try {
      await lstat(path.join(data, name));
      throw new Error("native_upgrade_staging_state");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return data;
}

export async function prepareNativeUpgradePostgresConfiguration(
  directory: string,
): Promise<string[]> {
  const data = await stagingData(directory);
  const originalAuto = await readBoundedRegularFile(
    path.join(data, "postgresql.auto.conf"),
    64000,
    {
      rejectSymlinks: true,
    },
  );
  await writeFile(
    path.join(directory, "upgrade-original-auto.conf"),
    originalAuto,
    { flag: "wx", mode: 0o600, flush: true },
  );
  for (const [name, bytes] of [
    [
      "upgrade-postgresql.conf",
      "# Controlled configuration for native upgrade staging.\n",
    ],
    [
      "upgrade-pg_hba.conf",
      "local all all reject\nhost all all 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n",
    ],
    [
      "upgrade-pg_ident.conf",
      "# No user mappings during native upgrade staging.\n",
    ],
  ])
    await writeFile(path.join(directory, name), bytes, {
      flag: "wx",
      mode: 0o600,
    });
  await writeExactOutputBundle({
    outputDirectory: data,
    overwrite: true,
    files: [
      {
        path: path.join(data, "postgresql.auto.conf"),
        bytes:
          "# Native upgrade staging; copied auto-configuration is inactive.\n",
      },
    ],
  });
  return [
    `config_file=${path.join(directory, "upgrade-postgresql.conf")}`,
    `data_directory=${data}`,
    `hba_file=${path.join(directory, "upgrade-pg_hba.conf")}`,
    `ident_file=${path.join(directory, "upgrade-pg_ident.conf")}`,
    "shared_preload_libraries=",
    "session_preload_libraries=",
    "local_preload_libraries=",
    "archive_mode=off",
    "archive_command=",
    "archive_library=",
    "restore_command=",
    "primary_conninfo=",
    "ssl=off",
    "ssl_passphrase_command=",
    "external_pid_file=",
  ].flatMap((setting) => ["-c", setting]);
}

/** Restore tuning on the stopped copy before it can become the live database. */
export async function restoreNativeUpgradePostgresConfiguration(
  directory: string,
): Promise<void> {
  const data = await stagingData(directory);
  const originalAuto = await readBoundedRegularFile(
    path.join(directory, "upgrade-original-auto.conf"),
    64000,
    { rejectSymlinks: true },
  );
  await writeExactOutputBundle({
    outputDirectory: data,
    overwrite: true,
    files: [
      {
        path: path.join(data, "postgresql.auto.conf"),
        bytes: originalAuto,
      },
    ],
  });
}
