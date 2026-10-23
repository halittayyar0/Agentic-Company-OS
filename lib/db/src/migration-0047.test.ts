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
  const nativeUrl = process.env.ACOS_RESULT_FORMAT_NATIVE_MIGRATION_URL;
  if (!nativeUrl) return new PGlite();
  // This optional adapter is exclusively for a fresh, separately owned test DB.
  // Ordinary canonical tests still run the exact same assertions on PGlite.
  const url = new URL(nativeUrl);
  const directory = process.env.ACOS_RESULT_FORMAT_NATIVE_DATA_DIR;
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "acos_result_format_test");
  assert.equal(url.pathname, "/migration_result_formats");
  assert.ok(directory);
  const client = new pg.Client({
    connectionString: nativeUrl,
    connectionTimeoutMillis: 1000,
  });
  await client.connect();
  try {
    const data = await client.query("SHOW data_directory");
    assert.equal(resolve(data.rows[0].data_directory), resolve(directory));
    const tables = await client.query(
      "SELECT count(*)::integer AS count FROM pg_tables WHERE schemaname='public'",
    );
    assert.equal(
      tables.rows[0].count,
      0,
      "native migration database must be fresh",
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

test("result format migration preserves old tasks and receipts and rejects malformed layouts", async () => {
  const client = await migrationClient();
  const read = (name: string) =>
    readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
  try {
    const journal = JSON.parse(await read("meta/_journal.json"));
    const target = journal.entries.filter(
      (entry: { idx: number }) => entry.idx === 47,
    );
    assert.equal(
      target.length,
      1,
      "result-format migration must be registered exactly once",
    );
    for (const entry of journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 47,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    await client.exec(
      "INSERT INTO agents(id,name,role,system_prompt) VALUES(100,'Preserved owner','Test','No inference')",
    );
    await client.exec(
      "INSERT INTO tasks(id,title,brief,owner_agent_id,status,tokens_used,cycle_count,result_summary,completion_requirements) VALUES(100,'Existing result','Keep exact brief',100,'completed',73,2,'Keep completed result','[{\"kind\":\"tool_succeeded\",\"tool\":\"vm_read_file\"}]'::jsonb)",
    );
    await client.query(
      "INSERT INTO task_creation_requests(request_id,request_hash,state,task_id) VALUES($1,$2,'created',100)",
      ["11111111-1111-4111-8111-111111111111", "a".repeat(64)],
    );
    const before = (
      await client.query<{ value: Record<string, unknown> }>(
        "SELECT row_to_json(t) AS value FROM tasks t WHERE id=100",
      )
    ).rows[0]!.value;
    const receipts = (
      await client.query(
        "SELECT * FROM task_creation_requests ORDER BY request_id",
      )
    ).rows;
    await client.exec(await read(target[0].tag + ".sql"));
    const after = (
      await client.query<{ value: Record<string, unknown> }>(
        "SELECT row_to_json(t) AS value FROM tasks t WHERE id=100",
      )
    ).rows[0]!.value;
    const { result_format, ...unchanged } = after;
    assert.equal(result_format, null, "existing tasks retain plain results");
    assert.deepEqual(unchanged, before);
    assert.deepEqual(
      (
        await client.query(
          "SELECT * FROM task_creation_requests ORDER BY request_id",
        )
      ).rows,
      receipts,
    );
    const valid = [
      null,
      { kind: "table", columns: ["Owner", "Action", "Due"] },
      { kind: "table", columns: ["المسؤول", "İş | 工作", "🧑".repeat(40)] },
      {
        kind: "table",
        columns: Array.from({ length: 8 }, (_, i) => String(i)),
      },
    ];
    for (const value of valid) {
      await client.query(
        "UPDATE tasks SET result_format=$1::jsonb WHERE id=100",
        [JSON.stringify(value)],
      );
      assert.deepEqual(
        (
          await client.query<{ result_format: unknown }>(
            "SELECT result_format FROM tasks WHERE id=100",
          )
        ).rows[0]!.result_format,
        value,
      );
    }
    const retained = valid.at(-1);
    for (const value of [
      {},
      [],
      "table",
      { kind: "text", columns: ["A", "B"] },
      { kind: "table", columns: ["One"] },
      {
        kind: "table",
        columns: Array.from({ length: 9 }, (_, i) => String(i)),
      },
      { kind: "table", columns: ["Owner", "Owner"] },
      { kind: "table", columns: ["Owner", ""] },
      { kind: "table", columns: [" Owner", "Action"] },
      { kind: "table", columns: ["Owner", "Action\u00a0"] },
      { kind: "table", columns: ["\u2003Owner", "Action"] },
      { kind: "table", columns: ["Owner", "Line\nbreak"] },
      { kind: "table", columns: ["Owner", "x".repeat(81)] },
      { kind: "table", columns: ["Owner", "🧑".repeat(41)] },
      { kind: "table", columns: ["Owner", 3] },
      { kind: "table", columns: ["Owner", "Action"], permissions: true },
    ]) {
      await assert.rejects(
        client.query("UPDATE tasks SET result_format=$1::jsonb WHERE id=100", [
          JSON.stringify(value),
        ]),
        /tasks_result_format_check/,
      );
      assert.deepEqual(
        (
          await client.query<{ result_format: unknown }>(
            "SELECT result_format FROM tasks WHERE id=100",
          )
        ).rows[0]!.result_format,
        retained,
      );
    }
    await client.exec("UPDATE tasks SET result_format=NULL WHERE id=100");
    assert.equal(
      (
        await client.query<{ result_format: unknown }>(
          "SELECT result_format FROM tasks WHERE id=100",
        )
      ).rows[0]!.result_format,
      null,
    );
    const previous = JSON.parse(await read("meta/0046_snapshot.json"));
    const current = JSON.parse(await read("meta/0047_snapshot.json"));
    assert.equal(current.prevId, previous.id);
    const { "public.tasks": oldTable, ...oldOthers } = previous.tables;
    const { "public.tasks": newTable, ...newOthers } = current.tables;
    assert.deepEqual(newOthers, oldOthers);
    const { result_format: column, ...columns } = newTable.columns;
    assert.equal(column.type, "jsonb");
    assert.equal(column.notNull, false);
    assert.deepEqual(columns, oldTable.columns);
  } finally {
    await client.close();
  }
});
