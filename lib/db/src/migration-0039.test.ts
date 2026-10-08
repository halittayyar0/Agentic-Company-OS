import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("source workspace migration preserves legacy session evidence with no invented source fence and requires paired positive revisions", async () => {
  const client = new PGlite();
  const read = (name: string) =>
    readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
  try {
    const journal = JSON.parse(await read("meta/_journal.json"));
    for (const entry of journal.entries.filter(
      (e: { idx: number }) => e.idx < 39,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    await client.exec(`INSERT INTO agents(id,name,role,system_prompt) VALUES(100,'Keep agent','Fixture','Fixture');
      INSERT INTO tasks(id,title,brief,owner_agent_id) VALUES(100,'Keep task','Fixture',100);
      INSERT INTO codex_task_sessions(task_id,agent_id,revision,state,cleanup_state,cleanup_at,attempt_id,lease_owner,policy_revision,
        registration_id,registration_revision,admission_version,host_id,cwd,storage_directory,home,model,executable_digest)
      VALUES(100,100,1,'ready','verified',now(),'fixture-attempt','fixture-lease',1,'fixture-registration',1,0,
        'fixture-host','/workspace','/private','/private/home','fixture-model','${"a".repeat(64)}')`);
    const before = (
      await client.query<Record<string, unknown>>(
        "SELECT * FROM codex_task_sessions WHERE task_id=100",
      )
    ).rows[0];
    await client.exec(await read("0039_codex_source_workspace_scope.sql"));
    const { source_change_id, source_change_revision, ...after } = (
      await client.query<Record<string, unknown>>(
        "SELECT * FROM codex_task_sessions WHERE task_id=100",
      )
    ).rows[0];
    assert.deepEqual(after, before);
    assert.equal(source_change_id, null);
    assert.equal(source_change_revision, null);
    for (const mutation of [
      "source_change_revision=1",
      "source_change_id='11111111-1111-4111-8111-111111111111'",
      "source_change_id='11111111-1111-4111-8111-111111111111',source_change_revision=0",
    ])
      await assert.rejects(
        client.exec(`UPDATE codex_task_sessions SET ${mutation}`),
        /codex_task_sessions_source_workspace/,
      );
    await client.exec(
      "UPDATE codex_task_sessions SET source_change_id='11111111-1111-4111-8111-111111111111',source_change_revision=1",
    );
    const prior = JSON.parse(await read("meta/0038_snapshot.json"));
    const next = JSON.parse(await read("meta/0039_snapshot.json"));
    assert.equal(next.prevId, prior.id);
    const { "public.codex_task_sessions": priorSession, ...priorTables } =
      prior.tables;
    const { "public.codex_task_sessions": nextSession, ...nextTables } =
      next.tables;
    assert.deepEqual(nextTables, priorTables);
    const {
      source_change_id: _id,
      source_change_revision: _revision,
      ...oldColumns
    } = nextSession.columns;
    assert.deepEqual(oldColumns, priorSession.columns);
  } finally {
    await client.close();
  }
});
