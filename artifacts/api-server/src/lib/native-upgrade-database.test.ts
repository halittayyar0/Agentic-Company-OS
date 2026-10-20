import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  captureNativeUpgradeData,
  verifyNativeUpgradeMigration,
} from "./native-upgrade-database";

async function fixture(t: TestContext) {
  const client = new PGlite();
  t.after(() => client.close());
  await client.exec(`
    CREATE TABLE tasks(id serial PRIMARY KEY, title text NOT NULL, result text);
    INSERT INTO tasks(title,result) VALUES ('First Ω العربية 中文', '73 EUR'), ('Second', NULL);
    CREATE TABLE settings(key text PRIMARY KEY, value jsonb NOT NULL);
    INSERT INTO settings VALUES ('permissions', '{"mode":"approval","files":false}');
    CREATE TABLE runtime_controls(id integer PRIMARY KEY, emergency_stop_enabled boolean NOT NULL DEFAULT false,
      emergency_stop_reason text, version integer NOT NULL DEFAULT 1, updated_by text NOT NULL DEFAULT 'system',
      updated_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO runtime_controls(id) VALUES (1);
  `);
  return {
    client: {
      query: async (sql: string, values?: unknown[]) =>
        client.query<Record<string, unknown>>(sql, values),
    },
    pg: {
      exec: (sql: string) => client.exec(sql),
      query: (sql: string, values?: unknown[]) =>
        client.query<Record<string, unknown>>(sql, values),
    },
  };
}

test("upgrade database verification preserves all prior columns, rows and sequence state across additive migrations", async (t) => {
  const { client, pg } = await fixture(t);
  const before = await captureNativeUpgradeData(client);
  const result = await verifyNativeUpgradeMigration({
    client,
    migrate: async () => {
      await pg.exec(
        "ALTER TABLE tasks ADD COLUMN added_later text DEFAULT 'new'; CREATE TABLE new_feature(id serial PRIMARY KEY);",
      );
    },
  });
  assert.equal(result.paused, true);
  assert.equal(result.previouslyPaused, false);
  assert.equal(result.tables.find((table) => table.name === "tasks")?.rows, 2);
  assert.equal(
    result.tables.find((table) => table.name === "tasks")?.sha256,
    before.tables.find((table) => table.name === "tasks")?.sha256,
  );
  assert.deepEqual(result.sequences, before.sequences);
  assert.equal(result.writeAndSequenceProbe, true);
  const stop = (await pg.query("SELECT * FROM runtime_controls"))
    .rows[0] as Record<string, unknown>;
  assert.equal(stop.emergency_stop_enabled, true);
  assert.equal(stop.version, 2);
  assert.equal(stop.updated_by, "native-upgrade");
  assert.equal(
    (await pg.query("SELECT count(*) FROM tasks")).rows[0]?.count,
    2,
  );
  assert.equal(
    (await pg.query("SELECT last_value FROM tasks_id_seq")).rows[0]?.last_value,
    2,
  );
  assert.deepEqual(
    (
      await pg.query(
        "SELECT tablename FROM pg_tables WHERE tablename='acos_native_upgrade_probe'",
      )
    ).rows,
    [],
  );
});

test("upgrade database verification rejects changed, removed or added existing-table rows before enabling the upgraded runtime", async (t) => {
  for (const sql of [
    "UPDATE tasks SET result='wrong' WHERE id=1",
    "DELETE FROM tasks WHERE id=1",
    "INSERT INTO tasks(title) VALUES ('unexpected')",
    "ALTER TABLE tasks DROP COLUMN result",
    "DROP TABLE tasks",
  ]) {
    const { client, pg } = await fixture(t);
    await assert.rejects(
      verifyNativeUpgradeMigration({ client, migrate: () => pg.exec(sql) }),
      /native_upgrade_data_changed/u,
    );
    assert.equal(
      (await pg.query("SELECT emergency_stop_enabled FROM runtime_controls"))
        .rows[0]?.emergency_stop_enabled,
      false,
    );
  }
});

test("upgrade data fingerprints use stable row ordering and preserve already-paused operator state", async (t) => {
  const { client, pg } = await fixture(t);
  await pg.exec(
    "UPDATE runtime_controls SET emergency_stop_enabled=true,emergency_stop_reason='Operator pause',version=7;",
  );
  const before = await captureNativeUpgradeData(client);
  const result = await verifyNativeUpgradeMigration({
    client,
    migrate: async () => {},
  });
  assert.equal(result.previouslyPaused, true);
  assert.equal(result.runtimeVersion, 7);
  assert.deepEqual(await captureNativeUpgradeData(client), before);
  assert.equal(
    (await pg.query("SELECT emergency_stop_reason FROM runtime_controls"))
      .rows[0]?.emergency_stop_reason,
    "Operator pause",
  );
});

test("upgrade data verification rejects changed application sequences and does not pause after a failed migration", async (t) => {
  const { client, pg } = await fixture(t);
  await assert.rejects(
    verifyNativeUpgradeMigration({
      client,
      migrate: async () => {
        throw new Error("migration rejected");
      },
    }),
    /migration rejected/u,
  );
  assert.equal(
    (await pg.query("SELECT emergency_stop_enabled FROM runtime_controls"))
      .rows[0]?.emergency_stop_enabled,
    false,
  );
  await assert.rejects(
    verifyNativeUpgradeMigration({
      client,
      migrate: async () => {
        await pg.query("SELECT nextval('tasks_id_seq')");
      },
    }),
    /native_upgrade_data_changed/u,
  );
});

test("upgrade verification fails closed if the durable runtime control singleton is absent", async (t) => {
  const { client, pg } = await fixture(t);
  await pg.exec("DELETE FROM runtime_controls;");
  await assert.rejects(
    verifyNativeUpgradeMigration({ client, migrate: async () => {} }),
    /native_upgrade_control_missing/u,
  );
});
