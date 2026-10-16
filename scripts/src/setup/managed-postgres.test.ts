import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  createManagedDatabaseUrl,
  createManagedPostgres,
  validateManagedPostgresPid,
} from "./managed-postgres";
import type { BoundedCommandExecution } from "../endurance/process-supervisor";

test("managed database readiness and shutdown require the exact owned server identity", () => {
  const directory = path.resolve("owned cluster");
  assert.doesNotThrow(() =>
    validateManagedPostgresPid(
      `4242\n${directory}\n1792154000\n58242\n`,
      4242,
      directory,
      58242,
    ),
  );
  for (const [pid, folder, port] of [
    [4243, directory, 58242],
    [4242, path.resolve("foreign"), 58242],
    [4242, directory, 58243],
  ] as const) {
    assert.throws(
      () =>
        validateManagedPostgresPid(
          `4242\n${directory}\n1792154000\n58242\n`,
          pid,
          folder,
          port,
        ),
      /managed_postgres_process_identity/u,
    );
  }
});

test("managed database URLs use a private random password and an available loopback port", async () => {
  const a = new URL(await createManagedDatabaseUrl());
  const b = new URL(await createManagedDatabaseUrl());
  assert.equal(a.protocol, "postgresql:");
  assert.equal(a.hostname, "127.0.0.1");
  assert.equal(a.username, "agentic");
  assert.equal(a.pathname, "/postgres");
  assert.ok(Number(a.port) >= 1024);
  assert.ok(a.password.length >= 32);
  assert.notEqual(a.password, b.password);
});

async function fixture(t: TestContext) {
  const directory = await mkdtemp(
    path.join(await realpath(tmpdir()), "acos-managed-postgres-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const secrets = path.join(directory, "secrets");
  await mkdir(secrets);
  const file = path.join(secrets, "database_url");
  await writeFile(
    file,
    "postgresql://agentic:private-test-password@127.0.0.1:58242/postgres",
  );
  return {
    directory,
    secretFiles: {
      database_url: file,
      operator_auth_token: "unused",
      runtime_control_key: "unused",
    },
  };
}

test("managed database initialization publishes only a complete owned cluster and keeps credentials out of arguments", async (t) => {
  const resources = await fixture(t);
  const commands: BoundedCommandExecution[] = [];
  const run = async (execution: BoundedCommandExecution) => {
    commands.push(execution);
    assert.equal(
      execution.args.some((arg) => arg.includes("private-test-password")),
      false,
    );
    if (execution.args.includes("--version"))
      return { stdout: "postgres (PostgreSQL) 17.10", stderr: "", exitCode: 0 };
    const index = execution.args.indexOf("--pgdata");
    assert.ok(index >= 0);
    await mkdir(execution.args[index + 1]);
    await writeFile(path.join(execution.args[index + 1], "PG_VERSION"), "17\n");
    return { stdout: "initialized", stderr: "", exitCode: 0 };
  };
  const options = {
    resources,
    postgresRoot: path.join(resources.directory, "runtime"),
    planId: "a".repeat(36),
    postgresVersion: "17.10",
    run,
  };
  const managed = createManagedPostgres(options);
  await managed.prepare();
  const marker = JSON.parse(
    await readFile(
      path.join(resources.directory, "database", "agentic-cluster.json"),
      "utf8",
    ),
  );
  assert.equal(marker.installationId, options.planId);
  assert.equal(
    await readFile(
      path.join(resources.directory, "database", "PG_VERSION"),
      "utf8",
    ),
    "17\n",
  );
  assert.ok(commands[1].args.includes("--auth=scram-sha-256"));
  assert.ok(commands[1].args.includes("--encoding=UTF8"));
  assert.ok(commands[1].args.includes("--locale=C"));
  const before = commands.length;
  await createManagedPostgres(options).prepare();
  assert.equal(
    commands.length,
    before + 1,
    "resume checks version without reinitializing data",
  );
  await assert.rejects(
    createManagedPostgres({ ...options, planId: "b".repeat(36) }).prepare(),
    /managed_postgres_identity/u,
  );
});

test("managed database refuses foreign data and never publishes interrupted initialization", async (t) => {
  const resources = await fixture(t);
  const options = {
    resources,
    postgresRoot: path.join(resources.directory, "runtime"),
    planId: "c".repeat(36),
    postgresVersion: "17.10",
  };
  let initialized = false;
  const run = async (execution: BoundedCommandExecution) => {
    if (execution.args.includes("--version"))
      return { stdout: "postgres (PostgreSQL) 17.10", stderr: "", exitCode: 0 };
    initialized = true;
    throw new Error("interrupted initialization");
  };
  await mkdir(path.join(resources.directory, "database"));
  await writeFile(
    path.join(resources.directory, "database", "keep.txt"),
    "foreign data",
  );
  await assert.rejects(
    createManagedPostgres({ ...options, run }).prepare(),
    /managed_postgres_identity/u,
  );
  assert.equal(initialized, false);
  assert.equal(
    await readFile(
      path.join(resources.directory, "database", "keep.txt"),
      "utf8",
    ),
    "foreign data",
  );
  await rm(path.join(resources.directory, "database"), { recursive: true });
  await assert.rejects(
    createManagedPostgres({ ...options, run }).prepare(),
    /interrupted initialization/u,
  );
  await assert.rejects(
    readFile(path.join(resources.directory, "database", "PG_VERSION")),
    { code: "ENOENT" },
  );
  await assert.rejects(
    readFile(path.join(resources.directory, "managed-postgres.json")),
    { code: "ENOENT" },
  );
});
