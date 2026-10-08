import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("native inference-key migration preserves historical receipts, rejects duplicate or misclassified inference and retains accounting after task deletion", async () => {
  const client = new PGlite();
  const read = (name: string) =>
    readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
  try {
    const journal = JSON.parse(await read("meta/_journal.json"));
    for (const entry of journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 36,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    await client.exec(
      "INSERT INTO agents(id,name,role,system_prompt) VALUES(100,'Keep agent','Fixture','Fixture');INSERT INTO tasks(id,title,brief,owner_agent_id) VALUES(100,'Keep task','Fixture',100);INSERT INTO usage_events(agent_id,task_id,kind,model_id,provider,total_tokens) VALUES(100,100,'task_step','legacy-model','openrouter',7)",
    );
    await client.exec(await read("0036_codex_task_inference_keys.sql"));
    assert.equal(
      (
        await client.query<{ inference_key: string | null }>(
          "SELECT inference_key FROM usage_events",
        )
      ).rows[0].inference_key,
      null,
    );
    const insert =
      "INSERT INTO usage_events(agent_id,task_id,kind,model_id,provider,total_tokens,inference_key) VALUES(100,100,'task_step','chatgpt:fixture-model','chatgpt',8,'codex:'||repeat('a',64))";
    await client.exec(insert);
    await assert.rejects(client.exec(insert), /unique constraint/);
    for (const bad of [
      insert
        .replace("'chatgpt',8", "'ollama',8")
        .replace("repeat('a'", "repeat('b'"),
      insert
        .replace("'task_step'", "'chat'")
        .replace("repeat('a'", "repeat('b'"),
      insert.replace("'codex:'||repeat('a',64)", "'private-fixture'"),
    ])
      await assert.rejects(
        client.exec(bad),
        /usage_events_inference_key_check/,
      );
    await client.exec("DELETE FROM tasks WHERE id=100");
    const rows = (
      await client.query<{ task_id: number | null; total_tokens: number }>(
        "SELECT task_id,total_tokens FROM usage_events ORDER BY id",
      )
    ).rows;
    assert.deepEqual(rows, [
      { task_id: null, total_tokens: 7 },
      { task_id: null, total_tokens: 8 },
    ]);
    const before = JSON.parse(await read("meta/0035_snapshot.json")),
      after = JSON.parse(await read("meta/0036_snapshot.json"));
    const { "public.usage_events": prior, ...priorTables } = before.tables,
      { "public.usage_events": next, ...nextTables } = after.tables;
    assert.deepEqual(priorTables, nextTables);
    assert.ok(next.columns.inference_key);
    assert.equal(next.columns.inference_key.notNull, false);
    for (const [key, column] of Object.entries(prior.columns))
      assert.deepEqual(next.columns[key], column);
  } finally {
    await client.close();
  }
});
