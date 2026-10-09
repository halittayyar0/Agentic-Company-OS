import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("session recovery migration preserves prior metadata and retains request identities across task deletion without private owner tokens", async () => {
  const client = new PGlite();
  const read = (name: string) =>
    readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
  try {
    const journal = JSON.parse(await read("meta/_journal.json"));
    for (const entry of journal.entries.filter(
      (e: { idx: number }) => e.idx < 38,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    await client.exec(
      "INSERT INTO agents(id,name,role,system_prompt) VALUES(100,'Keep agent','Fixture','Fixture');INSERT INTO tasks(id,title,brief,owner_agent_id) VALUES(100,'Keep task','Fixture',100)",
    );
    const before = (await client.query("SELECT * FROM tasks WHERE id=100"))
      .rows;
    await client.exec(await read("0038_codex_session_recovery.sql"));
    assert.deepEqual(
      (await client.query("SELECT * FROM tasks WHERE id=100")).rows,
      before,
    );
    const insert =
      'INSERT INTO codex_session_recoveries(request_id,task_id,expected_revision,response,snapshot) VALUES(\'11111111-1111-4111-8111-111111111111\',100,9007199254740989,\'{"outcome":"accepted"}\',\'{"home":"/private/home"}\')';
    await client.exec(insert);
    await assert.rejects(client.exec(insert), /unique constraint/);
    await assert.rejects(
      client.exec(
        'UPDATE codex_session_recoveries SET snapshot=\'{"ownerToken":"private_fixture"}\'',
      ),
      /codex_session_recoveries_snapshot/,
    );
    await assert.rejects(
      client.exec("UPDATE codex_session_recoveries SET snapshot=null"),
      /codex_session_recoveries_snapshot/,
    );
    await assert.rejects(
      client.exec(
        'UPDATE codex_session_recoveries SET response=\'{"outcome":"rejected"}\'',
      ),
      /codex_session_recoveries_snapshot/,
    );
    await assert.rejects(
      client.exec(
        "UPDATE codex_session_recoveries SET expected_revision=9007199254740992",
      ),
      /codex_session_recoveries_scope/,
    );
    await client.exec("DELETE FROM tasks WHERE id=100");
    assert.equal(
      (await client.query("SELECT request_id FROM codex_session_recoveries"))
        .rows.length,
      1,
    );
    const prior = JSON.parse(await read("meta/0037_snapshot.json")),
      next = JSON.parse(await read("meta/0038_snapshot.json"));
    assert.equal(next.prevId, prior.id);
    const { "public.codex_task_sessions": priorSession, ...priorTables } =
      prior.tables;
    const {
      "public.codex_task_sessions": nextSession,
      "public.codex_session_recoveries": newTable,
      ...nextTables
    } = next.tables;
    assert.deepEqual(nextTables, priorTables);
    assert.deepEqual(nextSession.columns, priorSession.columns);
    assert.ok(newTable);
    assert.equal(Object.keys(newTable.foreignKeys).length, 0);
  } finally {
    await client.close();
  }
});
