import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { resolve } from "node:path";
import pg from "pg";

interface MigrationClient {
  exec(sql: string): Promise<unknown>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: unknown[],
  ): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

async function migrationClient(): Promise<MigrationClient> {
  const nativeUrl = process.env.ACOS_PREPARATION_NATIVE_MIGRATION_URL;
  if (!nativeUrl) return new PGlite();
  const url = new URL(nativeUrl);
  const directory = process.env.ACOS_PREPARATION_NATIVE_DATA_DIR;
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "acos_preparation_test");
  assert.equal(url.pathname, "/migration_preparations");
  assert.ok(directory);
  const client = new pg.Client({
    connectionString: nativeUrl,
    connectionTimeoutMillis: 1_000,
  });
  await client.connect();
  try {
    assert.equal(
      resolve(
        (await client.query("SHOW data_directory")).rows[0].data_directory,
      ),
      resolve(directory),
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::integer AS count FROM pg_tables WHERE schemaname='public'",
        )
      ).rows[0].count,
      0,
      "owned migration database must be fresh",
    );
  } catch (error) {
    await client.end();
    throw error;
  }
  return {
    exec: (sql) => client.query(sql),
    query: async <T extends Record<string, unknown>>(
      sql: string,
      parameters?: unknown[],
    ) => ({ rows: (await client.query<T>(sql, parameters)).rows }),
    close: () => client.end(),
  };
}

test("model preparation migration enforces a single active receipt and bounded private metadata", async () => {
  const read = (name: string) =>
    readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
  const journal = JSON.parse(await read("meta/_journal.json"));
  assert.ok(
    journal.entries.some(
      (entry: { tag: string }) => entry.tag === "0046_local_model_preparations",
    ),
    "durable preparation migration must be registered",
  );
  const client = await migrationClient();
  try {
    for (const entry of journal.entries)
      await client.exec(await read(entry.tag + ".sql"));
    const insert = async (id: string) =>
      client.query(
        `INSERT INTO local_model_preparations(request_id,request_hash,model_id,provider_revision,state,owner_runtime_id,owner_epoch,lease_expires_at) VALUES($1,$2,'qwen35-2b',1,'requested','owned-api',$3,now()+interval '30 seconds')`,
        [id, "a".repeat(64), "00000000-0000-4000-8000-000000000001"],
      );
    const first = "00000000-0000-4000-8000-000000000002";
    const second = "00000000-0000-4000-8000-000000000003";
    await insert(first);
    await assert.rejects(insert(second), /local_model_preparations_one_active/);
    await assert.rejects(
      client.query("UPDATE local_model_preparations SET state='invented'"),
      /local_model_preparations_(state|outcome)_check/,
    );
    await assert.rejects(
      client.query(
        "UPDATE local_model_preparations SET observed_completed_bytes=2,observed_total_bytes=1",
      ),
      /local_model_preparations_bytes_check/,
    );
    await assert.rejects(
      client.query(
        "UPDATE local_model_preparations SET observed_total_bytes=3221225473",
      ),
      /local_model_preparations_bytes_check/,
    );
    await assert.rejects(
      client.query(
        "UPDATE local_model_preparations SET failure_code='PRIVATE_SENTINEL'",
      ),
      /local_model_preparations_outcome_check/,
    );
    await assert.rejects(
      client.query("UPDATE local_model_preparations SET state='ready'"),
      /local_model_preparations_outcome_check/,
    );
    await client.query(
      "UPDATE local_model_preparations SET state='interrupted',failure_code='INTERRUPTED',finished_at=now()",
    );
    await insert(second);
    const fields = (
      await client.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name='local_model_preparations'",
      )
    ).rows.map((row) => row.column_name);
    assert.equal(
      fields.some((field) => /prompt|secret|url|raw_error/.test(field)),
      false,
    );
    assert.equal((await client.query("SELECT * FROM tasks")).rows.length, 0);
  } finally {
    await client.close();
  }
});
