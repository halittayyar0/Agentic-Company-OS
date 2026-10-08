import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("Codex session migration is additive, preserves existing jobs, and rejects malformed ownership and unknown partial counters", async () => {
  const client = new PGlite();
  const read = (name: string) =>
    readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
  try {
    const journal = JSON.parse(await read("meta/_journal.json"));
    for (const entry of journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 34,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    await client.exec(
      "INSERT INTO agents(id,name,role,system_prompt) VALUES(100,'Keep agent','Fixture','Fixture')",
    );
    await client.exec(
      "INSERT INTO tasks(id,title,brief,owner_agent_id) VALUES(100,'Keep job','Fixture',100)",
    );
    await client.exec(await read("0034_codex_task_sessions.sql"));
    await client.exec(
      "INSERT INTO codex_task_sessions(task_id,agent_id,revision,state,owner_token,attempt_id,lease_owner,policy_revision,registration_id,registration_revision,admission_version,host_id,cwd,storage_directory,home,model,executable_digest) VALUES(100,100,1,'running','00000000-0000-4000-8000-000000000001','attempt_fixture','lease_fixture',1,'registration_fixture',1,0,'fixture-host','/workspace','/private','/private/home','fixture-model',repeat('a',64))",
    );
    for (const mutation of [
      "state='unknown'",
      "state='ready'",
      "owner_token=null",
      "revision=0",
      "registration_revision=0",
      "admission_version=-1",
      "thread_id='fixture-thread'",
      "prompt_tokens=0",
      "thread_id='fixture-thread',last_turn_id='fixture-turn',prompt_tokens=0,total_tokens=0",
      "thread_id='fixture-thread',last_turn_id='fixture-turn',prompt_tokens=5,completion_tokens=3,total_tokens=1",
    ])
      await assert.rejects(
        client.exec(
          "UPDATE codex_task_sessions SET " + mutation + " WHERE task_id=100",
        ),
        /check constraint/,
      );
    await client.exec(
      "UPDATE codex_task_sessions SET state='ready',owner_token=null,thread_id='fixture-thread',last_turn_id='fixture-turn' WHERE task_id=100",
    );
    assert.equal(
      (
        await client.query<{ total_tokens: number | null }>(
          "SELECT total_tokens FROM codex_task_sessions",
        )
      ).rows[0]?.total_tokens,
      null,
    );
    await client.exec(
      "UPDATE codex_task_sessions SET prompt_tokens=0,completion_tokens=0,total_tokens=0 WHERE task_id=100",
    );
    assert.equal(
      (
        await client.query<{ total_tokens: number | null }>(
          "SELECT total_tokens FROM codex_task_sessions",
        )
      ).rows[0]?.total_tokens,
      0,
    );
    assert.equal(
      (
        await client.query<{ title: string }>(
          "SELECT title FROM tasks WHERE id=100",
        )
      ).rows[0]?.title,
      "Keep job",
    );
    const before = JSON.parse(await read("meta/0033_snapshot.json")),
      after = JSON.parse(await read("meta/0034_snapshot.json"));
    assert.equal(after.prevId, before.id);
    const { "public.codex_task_sessions": added, ...retained } = after.tables;
    assert.deepEqual(retained, before.tables);
    assert.ok(added);
    assert.equal(Object.hasOwn(added.columns, "account_id"), false);
    await client.exec("DELETE FROM tasks WHERE id=100");
    assert.equal(
      (await client.query("SELECT task_id FROM codex_task_sessions")).rows
        .length,
      0,
    );
  } finally {
    await client.close();
  }
});
