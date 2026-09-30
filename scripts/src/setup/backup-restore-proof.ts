import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

const fingerprintSql = `SELECT count(*)::text || ':' || coalesce(max(id), 0)::text || ':' ||
  md5(coalesce(jsonb_agg(jsonb_build_array(id, name, role) ORDER BY id)::text, '[]')) || ':' ||
  (SELECT count(*)::text FROM drizzle.__drizzle_migrations) FROM agents`;
const probeNameHex = Buffer.from("Backup Ω اختبار 备份", "utf8").toString(
  "hex",
);

/** Test-only drill for a fresh installation fixture, never an operator database.
 * The callback owns its local PostgreSQL cluster or UUID-scoped Compose project.
 * Archive inspection is followed by an actual restore, application read and write.
 */
export async function proveDatabaseBackup(input: {
  database: string;
  dumpPath: string;
  connectionArgs: string[];
  command: (name: string, args: string[]) => Promise<{ stdout: string }>;
  copyArchive?: () => Promise<string>;
}) {
  const restoreDatabase = `acos_restore_${randomUUID().replaceAll("-", "")}`;
  const sql = (database: string, query: string) =>
    input.command("psql", [
      ...input.connectionArgs,
      "--dbname",
      database,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-c",
      query,
    ]);
  const before = (await sql(input.database, fingerprintSql)).stdout.trim();
  assert.match(
    before,
    /^\d+:\d+:[a-f0-9]{32}:\d+$/u,
    "Invalid application backup fingerprint",
  );
  const [agents, maximumId, , migrations] = before.split(":");
  assert.ok(
    Number(agents) > 0 && Number(migrations) > 0,
    "Backup proof requires a migrated nonempty installation fixture",
  );
  await input.command("pg_dump", [
    ...input.connectionArgs,
    "--dbname",
    input.database,
    "--format=custom",
    "--file",
    input.dumpPath,
  ]);
  const archivePath = input.copyArchive
    ? await input.copyArchive()
    : input.dumpPath;
  const info = await lstat(archivePath);
  assert.ok(
    info.isFile() && info.size > 5 && info.size <= 64 * 1024 * 1024,
    "Backup fixture archive must be a bounded regular file",
  );
  const archive = await readFile(archivePath);
  assert.equal(
    archive.subarray(0, 5).toString("ascii"),
    "PGDMP",
    "Backup must remain a binary custom-format archive",
  );
  const sha256 = createHash("sha256").update(archive).digest("hex");
  let created = false;
  try {
    await input.command("createdb", [...input.connectionArgs, restoreDatabase]);
    created = true;
    await input.command("pg_restore", [
      ...input.connectionArgs,
      "--dbname",
      restoreDatabase,
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      input.dumpPath,
    ]);
    const after = (await sql(restoreDatabase, fingerprintSql)).stdout.trim();
    assert.equal(
      after,
      before,
      "The restored application records and migration history must match the fixture",
    );
    const write = await sql(
      restoreDatabase,
      `BEGIN;
      INSERT INTO agents (name, role, system_prompt) VALUES (convert_from(decode('${probeNameHex}', 'hex'), 'UTF8'), 'specialist', 'Backup proof only')
      RETURNING CASE WHEN encode(convert_to(name, 'UTF8'), 'hex') = '${probeNameHex}' THEN id ELSE -1 END;
      ROLLBACK;`,
    );
    const insertedId = write.stdout
      .split(/\r?\n/u)
      .find((line) => /^\d+$/u.test(line.trim()));
    assert.ok(
      insertedId && Number(insertedId) > Number(maximumId),
      "Restored application writes and sequence state must work",
    );
    return {
      passed: true as const,
      archiveBytes: archive.length,
      sha256,
      agents: Number(agents),
      migrations: Number(migrations),
    };
  } finally {
    if (created)
      await input.command("dropdb", [...input.connectionArgs, restoreDatabase]);
  }
}
