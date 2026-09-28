import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("manual meeting command migration preserves prior tables and bounds correlated outcomes", async () => {
  const client = new PGlite();
  try {
    const read = (name: string) =>
      readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
    const journal = JSON.parse(await read("meta/_journal.json"));
    for (const entry of journal.entries.filter(
      (e: { idx: number }) => e.idx < 24,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    await client.exec(
      "INSERT INTO agents(id,name,role,system_prompt) VALUES(100,'Test','Test','Test'); INSERT INTO tasks(id,title,brief,owner_agent_id) VALUES(100,'Existing','Keep',100); INSERT INTO project_meetings(id,task_id,title) VALUES(100,100,'Keep this meeting')",
    );
    await client.exec(await read("0024_project_meeting_commands.sql"));
    assert.equal(
      (
        await client.query<{ title: string }>(
          "SELECT title FROM project_meetings WHERE id=100",
        )
      ).rows[0].title,
      "Keep this meeting",
    );
    const requestId = "11111111-1111-4111-8111-111111111111";
    const result = {
      requestId,
      projectId: 100,
      meetingId: 100,
      kind: "create",
      entityId: 100,
      ok: true,
    };
    const insert =
      "INSERT INTO project_meeting_commands(request_id,project_id,meeting_id,kind,request_hash,http_status,response) VALUES($1,100,100,'create',$2,$3,$4)";
    for (const [status, response] of [
      [201, {}],
      [201, []],
      [201, { ...result, requestId: "22222222-2222-4222-8222-222222222222" }],
      [201, { ...result, projectId: 101 }],
      [201, { ...result, meetingId: null }],
      [201, { ...result, kind: "update" }],
      [201, { ...result, entityId: null }],
      [201, { ...result, ok: false }],
      [409, result],
      [201, { ...result, padding: "x".repeat(2048) }],
    ]) {
      await assert.rejects(
        client.query(insert, [
          requestId,
          "a".repeat(64),
          status,
          JSON.stringify(response),
        ]),
        /check constraint/,
      );
    }
    await client.query(insert, [
      requestId,
      "a".repeat(64),
      201,
      JSON.stringify(result),
    ]);
    await client.exec("DELETE FROM tasks WHERE id=100");
    assert.equal(
      (await client.query("SELECT * FROM project_meeting_commands")).rows
        .length,
      1,
    );
    await assert.rejects(
      client.query(insert, [
        requestId,
        "a".repeat(64),
        201,
        JSON.stringify(result),
      ]),
      /duplicate key/,
    );
    const before = JSON.parse(await read("meta/0023_snapshot.json")),
      after = JSON.parse(await read("meta/0024_snapshot.json"));
    assert.equal(after.prevId, before.id);
    const { "public.project_meeting_commands": receipt, ...tables } =
      after.tables;
    assert.deepEqual(tables, before.tables);
    assert.deepEqual(receipt.foreignKeys, {});
  } finally {
    await client.close();
  }
});
