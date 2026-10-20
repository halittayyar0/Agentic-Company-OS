import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import { readBoundedRegularFile } from "./read-bounded-file";
import {
  verifyNativeUpgradeMigration,
  type UpgradeDatabaseClient,
} from "./native-upgrade-database";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const sha = /^[a-f0-9]{40}$/u;

export function parseNativeUpgradeArguments(args: string[]): {
  stagingDirectory: string;
  upgradeId: string;
  targetCommit: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index],
      value = args[index + 1];
    if (
      !["--staging-directory", "--upgrade-id", "--target-commit"].includes(
        name,
      ) ||
      !value ||
      values.has(name)
    )
      throw new Error("native_upgrade_arguments");
    values.set(name, value);
  }
  const stagingDirectory = values.get("--staging-directory") ?? "";
  const upgradeId = values.get("--upgrade-id") ?? "",
    targetCommit = values.get("--target-commit") ?? "";
  if (
    values.size !== 3 ||
    !path.isAbsolute(stagingDirectory) ||
    upgradeId.length !== 36 ||
    !uuid.test(upgradeId) ||
    targetCommit.length !== 40 ||
    !sha.test(targetCommit)
  )
    throw new Error("native_upgrade_arguments");
  return {
    stagingDirectory: path.resolve(stagingDirectory),
    upgradeId,
    targetCommit,
  };
}

async function exactDirectory(directory: string) {
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (await realpath(directory)) !== directory
  )
    throw new Error("native_upgrade_path");
}

async function exactFile(file: string, limit: number) {
  const before = await lstat(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    (await realpath(file)) !== file
  )
    throw new Error("native_upgrade_file");
  const bytes = await readBoundedRegularFile(file, limit, {
    rejectSymlinks: true,
  });
  const after = await lstat(file);
  if (
    after.ino !== before.ino ||
    after.dev !== before.dev ||
    after.size !== before.size ||
    after.nlink !== 1 ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs
  )
    throw new Error("native_upgrade_file");
  return bytes;
}

async function migrationChain(directory: string) {
  await exactDirectory(directory);
  const journal = JSON.parse(
    await exactFile(path.join(directory, "meta/_journal.json"), 1024 * 1024),
  );
  if (
    journal?.dialect !== "postgresql" ||
    journal?.version !== "7" ||
    !Array.isArray(journal.entries) ||
    journal.entries.length < 1 ||
    journal.entries.length > 4096
  )
    throw new Error("native_upgrade_migration_history");
  let previous = -1;
  const result: { hash: string; createdAt: number }[] = [];
  for (const [index, row] of journal.entries.entries()) {
    if (
      row?.idx !== index ||
      row.version !== "7" ||
      !Number.isSafeInteger(row.when) ||
      row.when <= previous ||
      typeof row.tag !== "string" ||
      row.tag.length > 160 ||
      !new RegExp(`^${String(index).padStart(4, "0")}_[a-z0-9_]+$`, "u").test(
        row.tag,
      )
    )
      throw new Error("native_upgrade_migration_history");
    const sql = await exactFile(
      path.join(directory, row.tag + ".sql"),
      16 * 1024 * 1024,
    );
    result.push({
      hash: createHash("sha256").update(sql).digest("hex"),
      createdAt: row.when,
    });
    previous = row.when;
  }
  return result;
}

async function assertJournal(
  client: UpgradeDatabaseClient,
  expected: { hash: string; createdAt: number }[],
) {
  const actual = (
    await client.query(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id",
    )
  ).rows;
  if (
    actual.length !== expected.length ||
    actual.some(
      (row, index) =>
        row.hash !== expected[index].hash ||
        String(row.created_at) !== String(expected[index].createdAt),
    )
  )
    throw new Error("native_upgrade_migration_history");
}

/** Internal, one-process/one-attempt protocol. A failed attempt is retained and
 * must be replaced by a fresh cold copy, never retried with a new data baseline.
 */
export async function runNativeUpgradeMigrationCLI(
  args: string[],
  options: {
    migrationsDirectory: string;
    output?: (value: string) => void;
  },
): Promise<number> {
  const output =
    options.output ?? ((value: string) => process.stdout.write(value + "\n"));
  let client: import("pg").Client | undefined;
  let database: typeof import("@workspace/db") | undefined;
  const prior = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_MIGRATIONS_DIR: process.env.DATABASE_MIGRATIONS_DIR,
  };
  try {
    const input = parseNativeUpgradeArguments(args);
    const attempt = path.dirname(input.stagingDirectory),
      upgrades = path.dirname(attempt),
      directory = path.dirname(upgrades);
    const installationId = path.basename(directory).slice(9);
    if (
      path.basename(input.stagingDirectory) !== "stage" ||
      path.basename(attempt) !== input.upgradeId ||
      path.basename(upgrades) !== "native-upgrades" ||
      path.basename(directory) !== `instance-${installationId}` ||
      !uuid.test(installationId)
    )
      throw new Error("native_upgrade_identity");
    for (const folder of [
      directory,
      upgrades,
      attempt,
      input.stagingDirectory,
      path.join(directory, "secrets"),
    ])
      await exactDirectory(folder);
    await new OwnerPrivateStorage(directory).initialize();
    await new OwnerPrivateStorage(input.stagingDirectory).initialize();
    const source = JSON.parse(
      await exactFile(path.join(directory, "installation.json"), 64000),
    );
    const sourceCommit = source?.runtimeOptions?.nativeBundleCommit;
    if (
      source?.schemaVersion !== 1 ||
      source?.phase !== "complete" ||
      source?.plan?.id !== installationId ||
      typeof sourceCommit !== "string" ||
      sourceCommit.length !== 40 ||
      !sha.test(sourceCommit) ||
      sourceCommit === input.targetCommit ||
      typeof source.workspaceRoot !== "string" ||
      !path.isAbsolute(source.workspaceRoot)
    )
      throw new Error("native_upgrade_identity");
    const dataDirectory = path.join(input.stagingDirectory, "database");
    await exactDirectory(dataDirectory);
    const marker = JSON.parse(
      await exactFile(path.join(dataDirectory, "agentic-cluster.json"), 4096),
    );
    if (
      marker?.schemaVersion !== 1 ||
      marker.installationId !== installationId ||
      marker.postgresMajor !== 17 ||
      (await exactFile(path.join(dataDirectory, "PG_VERSION"), 128)).trim() !==
        "17"
    )
      throw new Error("native_upgrade_identity");
    const connectionString = await exactFile(
      path.join(directory, "secrets/database_url"),
      4096,
    );
    const url = new URL(connectionString);
    if (
      /[\r\n\0]/u.test(connectionString) ||
      url.protocol !== "postgresql:" ||
      url.hostname !== "127.0.0.1" ||
      url.username !== "agentic" ||
      !url.password ||
      url.pathname !== "/postgres" ||
      url.search ||
      url.hash ||
      Number(url.port) < 1024 ||
      Number(url.port) !== marker.port
    )
      throw new Error("native_upgrade_connection");
    const oldChain = await migrationChain(
      path.join(
        path.resolve(source.workspaceRoot),
        "artifacts/api-server/dist/db-migrations",
      ),
    );
    const newChain = await migrationChain(
      path.resolve(options.migrationsDirectory),
    );
    if (
      newChain.length < oldChain.length ||
      oldChain.some(
        (row, index) => JSON.stringify(row) !== JSON.stringify(newChain[index]),
      )
    )
      throw new Error("native_upgrade_migration_history");

    const reservation = new OwnerPrivateStorage(
      path.join(input.stagingDirectory, "migration-attempt"),
    );
    await reservation.initialize(true);
    const identity = {
      schemaVersion: 1,
      installationId,
      upgradeId: input.upgradeId,
      sourceCommit,
      targetCommit: input.targetCommit,
    };
    await reservation.write("attempt.json", JSON.stringify(identity));
    const { default: pg } = await import("pg");
    client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 60_000,
      application_name: "acos-native-upgrade",
    });
    await client.connect();
    const actual = (await client.query("SHOW data_directory")).rows[0]
      ?.data_directory;
    if (
      typeof actual !== "string" ||
      (await realpath(path.resolve(actual))) !== dataDirectory
    )
      throw new Error("native_upgrade_connection_identity");
    await assertJournal(client, oldChain);
    process.env.DATABASE_URL = connectionString;
    process.env.NODE_ENV = "production";
    process.env.DATABASE_MIGRATIONS_DIR = path.resolve(
      options.migrationsDirectory,
    );
    const activeClient = client;
    const proof = await verifyNativeUpgradeMigration({
      client,
      migrate: async () => {
        database = await import("@workspace/db");
        await database.dbReady;
        await assertJournal(activeClient, newChain);
      },
    });
    await reservation.write(
      "receipt.json",
      JSON.stringify({ ...identity, dataDirectory, ...proof }),
    );
    output(
      JSON.stringify({
        status: "verified",
        paused: true,
        retainedTables: proof.tables.length,
        receipt: path.join(reservation.directory, "receipt.json"),
      }),
    );
    return 0;
  } catch {
    output(
      "native_upgrade_migration_failed: keep the original installation; retry staging from a fresh copy.",
    );
    return 1;
  } finally {
    await database?.closeDatabase().catch(() => undefined);
    await client?.end().catch(() => undefined);
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
