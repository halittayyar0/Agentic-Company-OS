import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { proveDatabaseBackup } from "./backup-restore-proof";

async function fixture(
  options: {
    corrupt?: boolean;
    mismatch?: boolean;
    createFails?: boolean;
    restoreFails?: boolean;
  } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), "acos-backup-contract-"));
  const archive = path.join(directory, "database.dump");
  const calls: { command: string; args: string[] }[] = [];
  const fingerprint = `2:7:${"a".repeat(32)}:25`;
  const run = async (command: string, args: string[]) => {
    calls.push({ command, args });
    if (command === "pg_dump") {
      await writeFile(
        archive,
        Buffer.concat([
          Buffer.from(options.corrupt ? "BROKE" : "PGDMP"),
          Buffer.from([0, 255, 128, 10]),
        ]),
      );
    }
    if (command === "createdb" && options.createFails)
      throw new Error("create failed");
    if (command === "pg_restore" && options.restoreFails)
      throw new Error("restore failed");
    const sql = args[args.indexOf("-c") + 1] ?? "";
    const restored = args.some((arg) => arg.startsWith("acos_restore_"));
    return {
      stdout: sql.includes("BEGIN")
        ? "BEGIN\n8\nROLLBACK\n"
        : options.mismatch && restored
          ? `1:7:${"b".repeat(32)}:25`
          : fingerprint,
    };
  };
  return { archive, calls, run };
}

test("backup proof restores a binary archive into a fresh database and checks application writes", async () => {
  const f = await fixture();
  const result = await proveDatabaseBackup({
    database: "source_fixture",
    dumpPath: f.archive,
    connectionArgs: ["-U", "test_user"],
    command: f.run,
  });
  assert.equal(result.passed, true);
  assert.equal(result.archiveBytes, 9);
  assert.equal(result.agents, 2);
  assert.equal(result.migrations, 25);
  assert.match(result.sha256, /^[a-f0-9]{64}$/u);
  const created = f.calls
    .find((call) => call.command === "createdb")!
    .args.at(-1)!;
  assert.match(created, /^acos_restore_[a-f0-9]{32}$/u);
  assert.equal(
    f.calls.find((call) => call.command === "dropdb")!.args.at(-1),
    created,
  );
  assert.ok(
    f.calls
      .filter((call) => call.command === "pg_restore")
      .every(
        (call) => call.args[call.args.indexOf("--dbname") + 1] === created,
      ),
  );
});

test("corrupt backup fails before creating a restore database", async () => {
  const f = await fixture({ corrupt: true });
  await assert.rejects(
    proveDatabaseBackup({
      database: "source_fixture",
      dumpPath: f.archive,
      connectionArgs: [],
      command: f.run,
    }),
    /custom-format/u,
  );
  assert.ok(
    !f.calls.some(
      (call) => call.command === "createdb" || call.command === "dropdb",
    ),
  );
});

test("restore mismatch rejects the proof and cleans only the database it created", async () => {
  const f = await fixture({ mismatch: true });
  await assert.rejects(
    proveDatabaseBackup({
      database: "source_fixture",
      dumpPath: f.archive,
      connectionArgs: [],
      command: f.run,
    }),
    /restored application/u,
  );
  const created = f.calls
    .find((call) => call.command === "createdb")!
    .args.at(-1);
  assert.equal(
    f.calls.find((call) => call.command === "dropdb")!.args.at(-1),
    created,
  );
  assert.ok(
    !f.calls.some(
      (call) =>
        call.command === "dropdb" && call.args.includes("source_fixture"),
    ),
  );
});

test("failed database creation never authorizes cleanup of an existing database", async () => {
  const f = await fixture({ createFails: true });
  await assert.rejects(
    proveDatabaseBackup({
      database: "source_fixture",
      dumpPath: f.archive,
      connectionArgs: [],
      command: f.run,
    }),
    /create failed/u,
  );
  assert.ok(!f.calls.some((call) => call.command === "dropdb"));
});

test("a failed restore cleans its disposable database without marking the backup valid", async () => {
  const f = await fixture({ restoreFails: true });
  await assert.rejects(
    proveDatabaseBackup({
      database: "source_fixture",
      dumpPath: f.archive,
      connectionArgs: [],
      command: f.run,
    }),
    /restore failed/u,
  );
  const created = f.calls
    .find((call) => call.command === "createdb")!
    .args.at(-1);
  assert.equal(
    f.calls.find((call) => call.command === "dropdb")!.args.at(-1),
    created,
  );
  assert.equal(f.calls.filter((call) => call.command === "psql").length, 1);
});
