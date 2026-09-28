import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("meeting turn migration preserves existing data and enforces durable outcome states", async () => {
  const client = new PGlite();
  try {
    const read = (file: string) =>
      readFile(new URL("./generated-sql/" + file, import.meta.url), "utf8");
    const journal = JSON.parse(await read("meta/_journal.json"));
    for (const entry of journal.entries.filter(
      (e: { idx: number }) => e.idx < 23,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    await client.exec(
      "INSERT INTO agents(id,name,role,system_prompt) VALUES(100,'Owner','Test','Test'); INSERT INTO tasks(id,title,brief,owner_agent_id) VALUES(100,'Existing project','Keep this',100); INSERT INTO project_meetings(id,task_id,title) VALUES(100,100,'Existing meeting')",
    );
    await client.exec(await read("0023_project_meeting_turn_requests.sql"));
    assert.equal(
      (
        await client.query<{ title: string }>(
          "SELECT title FROM project_meetings WHERE id=100",
        )
      ).rows[0].title,
      "Existing meeting",
    );
    const request = "11111111-1111-4111-8111-111111111111";
    const insert =
      "INSERT INTO project_meeting_turn_requests(request_id,project_id,meeting_id,request_hash,state,lease_owner,lease_expires_at,http_status,response) VALUES($1,100,100,$2,$3,$1,now(),$4,$5)";
    for (const [state, status, response] of [
      ["complete", null, null],
      ["complete", 200, null],
      ["complete", null, "{}"],
      ["complete", 200, "[]"],
      ["running", 200, "{}"],
      ["unconfirmed", 503, null],
      ["unknown", null, null],
    ]) {
      await assert.rejects(
        client.query(insert, [
          request,
          "a".repeat(64),
          state,
          status,
          response,
        ]),
        /check constraint/,
      );
    }
    await client.query(insert, [
      request,
      "a".repeat(64),
      "running",
      null,
      null,
    ]);
    await client.exec(
      "UPDATE project_meeting_turn_requests SET state='complete',http_status=503,response='{}'; DELETE FROM tasks WHERE id=100",
    );
    assert.equal(
      (await client.query("SELECT * FROM project_meeting_turn_requests")).rows
        .length,
      1,
    );
    await assert.rejects(
      client.query(insert, [
        request,
        "a".repeat(64),
        "unconfirmed",
        null,
        null,
      ]),
      /duplicate key/,
    );
    const before = JSON.parse(await read("meta/0022_snapshot.json")),
      after = JSON.parse(await read("meta/0023_snapshot.json"));
    assert.equal(after.prevId, before.id);
    const { "public.project_meeting_turn_requests": receipt, ...tables } =
      after.tables;
    assert.deepEqual(tables, before.tables);
    assert.deepEqual(receipt.foreignKeys, {});
  } finally {
    await client.close();
  }
});
