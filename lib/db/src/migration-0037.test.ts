import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("cleanup migration preserves legacy checkpoints as unknown and constrains durable shutdown evidence", async () => {
  const client = new PGlite();
  const read = (name: string) =>
    readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
  try {
    const journal = JSON.parse(await read("meta/_journal.json"));
    for (const entry of journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 37,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    await client.exec(
      "INSERT INTO agents(id,name,role,system_prompt) VALUES(100,'Keep agent','Fixture','Fixture');INSERT INTO tasks(id,title,brief,owner_agent_id) VALUES(100,'Keep task','Fixture',100)",
    );
    await client.exec(
      "INSERT INTO codex_task_sessions(task_id,agent_id,revision,state,attempt_id,lease_owner,policy_revision,registration_id,registration_revision,admission_version,host_id,cwd,storage_directory,home,model,executable_digest,thread_id,last_turn_id,prompt_tokens,completion_tokens,total_tokens) VALUES(100,100,9007199254740989,'ready','attempt_fixture','lease_fixture',1,'registration_fixture',1,0,'fixture-host','/workspace','/private','/private/home','fixture-model',repeat('a',64),'fixture-thread','fixture-turn',5,3,8)",
    );
    const before = (
      await client.query<Record<string, unknown>>(
        "SELECT * FROM codex_task_sessions",
      )
    ).rows[0];
    await client.exec(await read("0037_codex_session_cleanup_evidence.sql"));
    const { cleanup_state, cleanup_at, ...retained } = (
      await client.query<Record<string, unknown>>(
        "SELECT * FROM codex_task_sessions",
      )
    ).rows[0];
    assert.equal(cleanup_state, "unknown");
    assert.equal(cleanup_at, null);
    assert.deepEqual(retained, before);
    for (const mutation of [
      "cleanup_state='verified'",
      "cleanup_state='not_launched'",
      "cleanup_state='unknown',cleanup_at=now()",
      "cleanup_state='stopped',cleanup_at=now()",
      "state='running',owner_token='00000000-0000-4000-8000-000000000001',cleanup_state='verified',cleanup_at=now()",
    ])
      await assert.rejects(
        client.exec(
          "UPDATE codex_task_sessions SET " + mutation + " WHERE task_id=100",
        ),
        /codex_task_sessions_cleanup/,
      );
    for (const state of ["verified", "not_launched"])
      await client.exec(
        "UPDATE codex_task_sessions SET state='uncertain',cleanup_state='" +
          state +
          "',cleanup_at=now() WHERE task_id=100",
      );
    assert.equal(
      (
        await client.query<{ thread_id: string; total_tokens: number }>(
          "SELECT thread_id,total_tokens FROM codex_task_sessions",
        )
      ).rows[0].total_tokens,
      8,
    );
    const prior = JSON.parse(await read("meta/0036_snapshot.json")),
      next = JSON.parse(await read("meta/0037_snapshot.json"));
    assert.equal(next.prevId, prior.id);
    const { "public.codex_task_sessions": priorSession, ...priorTables } =
      prior.tables;
    const { "public.codex_task_sessions": nextSession, ...nextTables } =
      next.tables;
    assert.deepEqual(nextTables, priorTables);
    for (const [key, column] of Object.entries(priorSession.columns))
      assert.deepEqual(nextSession.columns[key], column);
    assert.equal(nextSession.columns.cleanup_state.default, "'unknown'");
    assert.equal(nextSession.columns.cleanup_at.notNull, false);
  } finally {
    await client.close();
  }
});
