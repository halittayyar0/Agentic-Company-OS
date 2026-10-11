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
  const nativeUrl = process.env.ACOS_REQUIREMENTS_NATIVE_MIGRATION_URL;
  if (!nativeUrl) return new PGlite();
  // This optional adapter is exclusively for a fresh, separately owned test DB.
  // Ordinary canonical tests still run the exact same assertions on PGlite.
  const url = new URL(nativeUrl);
  const directory = process.env.ACOS_REQUIREMENTS_NATIVE_DATA_DIR;
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, "acos_requirements_test");
  assert.equal(url.pathname, "/migration_requirements");
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

test("completion requirement migration preserves existing tasks and creation receipts and rejects malformed contracts", async () => {
  const client = await migrationClient();
  const read = (name: string) =>
    readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
  try {
    const journal = JSON.parse(await read("meta/_journal.json"));
    for (const entry of journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 45,
    )) {
      await client.exec(await read(entry.tag + ".sql"));
    }
    await client.exec(
      "INSERT INTO agents(id,name,role,system_prompt) VALUES(100,'Preserved owner','Test','No inference')",
    );
    await client.exec(
      "INSERT INTO tasks(id,title,brief,owner_agent_id,status,tokens_used,cycle_count,result_summary) VALUES(100,'Existing result','Keep exact brief',100,'completed',73,2,'Keep completed result')",
    );
    await client.query(
      "INSERT INTO task_creation_requests(request_id,request_hash,state,task_id) VALUES($1,$2,'created',100)",
      ["11111111-1111-4111-8111-111111111111", "a".repeat(64)],
    );
    const beforeTask = (
      await client.query<{ value: Record<string, unknown> }>(
        "SELECT row_to_json(t) AS value FROM tasks t WHERE id=100",
      )
    ).rows[0]!.value;
    const beforeReceipts = (
      await client.query(
        "SELECT * FROM task_creation_requests ORDER BY request_id",
      )
    ).rows;
    for (const entry of journal.entries.filter(
      (entry: { idx: number }) => entry.idx >= 45,
    )) {
      await client.exec(await read(entry.tag + ".sql"));
    }
    const afterTask = (
      await client.query<{ value: Record<string, unknown> }>(
        "SELECT row_to_json(t) AS value FROM tasks t WHERE id=100",
      )
    ).rows[0]!.value;
    const { completion_requirements, ...unchanged } = afterTask;
    assert.deepEqual(
      completion_requirements,
      [],
      "old rows need an explicit empty completion contract",
    );
    assert.deepEqual(unchanged, beforeTask);
    assert.deepEqual(
      (
        await client.query(
          "SELECT * FROM task_creation_requests ORDER BY request_id",
        )
      ).rows,
      beforeReceipts,
    );
    const valid = [
      { kind: "tool_succeeded", tool: "calculate" },
      { kind: "tool_succeeded", tool: "vm_read_file" },
    ];
    await client.query(
      "UPDATE tasks SET completion_requirements=$1::jsonb WHERE id=100",
      [JSON.stringify(valid)],
    );
    assert.deepEqual(
      (
        await client.query<{ completion_requirements: unknown }>(
          "SELECT completion_requirements FROM tasks WHERE id=100",
        )
      ).rows[0]!.completion_requirements,
      valid,
    );
    const invalid = [
      null,
      {},
      "calculate",
      [null],
      [{ tool: "calculate" }],
      [{ kind: "other", tool: "calculate" }],
      [{ kind: "tool_succeeded", tool: "../private" }],
      [{ kind: "tool_succeeded", tool: "a".repeat(81) }],
      [{ kind: "tool_succeeded", tool: "calculate", optional: true }],
      [{ kind: "tool_succeeded", tool: "complete_task" }],
      [valid[0], valid[0]],
      Array.from({ length: 9 }, (_, i) => ({
        kind: "tool_succeeded",
        tool: "fixture_" + i,
      })),
    ];
    for (const value of invalid) {
      await assert.rejects(
        client.query(
          "UPDATE tasks SET completion_requirements=$1::jsonb WHERE id=100",
          [JSON.stringify(value)],
        ),
        /tasks_completion_requirements_check/,
      );
      assert.deepEqual(
        (
          await client.query<{ completion_requirements: unknown }>(
            "SELECT completion_requirements FROM tasks WHERE id=100",
          )
        ).rows[0]!.completion_requirements,
        valid,
        "failed contract changes must preserve the prior requirements",
      );
    }
    const beforeSnapshot = JSON.parse(await read("meta/0044_snapshot.json"));
    const afterSnapshot = JSON.parse(await read("meta/0045_snapshot.json"));
    assert.equal(afterSnapshot.prevId, beforeSnapshot.id);
    const { "public.tasks": beforeTable, ...beforeTables } =
      beforeSnapshot.tables;
    const { "public.tasks": afterTable, ...afterTables } = afterSnapshot.tables;
    assert.deepEqual(afterTables, beforeTables);
    assert.equal(afterTable.columns.completion_requirements.type, "jsonb");
    assert.equal(afterTable.columns.completion_requirements.notNull, true);
    const { completion_requirements: addedColumn, ...columns } =
      afterTable.columns;
    assert.ok(addedColumn);
    assert.deepEqual(columns, beforeTable.columns);
  } finally {
    await client.close();
  }
});
