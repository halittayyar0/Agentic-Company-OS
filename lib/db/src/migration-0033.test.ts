import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("usage provenance upgrade retains legacy unknowns and rejects false terminal accounting", async () => {
  const client = new PGlite();
  try {
    const read = (name: string) =>
      readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
    const journal = JSON.parse(await read("meta/_journal.json"));
    for (const entry of journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 33,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    await client.exec(
      "INSERT INTO agents(id,name,role,system_prompt) VALUES(100,'Keep agent','Fixture','Fixture')",
    );
    await client.exec(
      "INSERT INTO usage_events(id,agent_id,kind,model_id,provider,total_tokens) VALUES(100,100,'chat','fixture','fixture',12)",
    );
    await client.exec(await read("0033_usage_reporting_outcome.sql"));
    const legacy = (
      await client.query(
        "SELECT total_tokens,usage_reported,outcome,failure_kind FROM usage_events WHERE id=100",
      )
    ).rows[0];
    assert.deepEqual(legacy, {
      total_tokens: 12,
      usage_reported: null,
      outcome: "completed",
      failure_kind: null,
    });
    await client.exec(
      "INSERT INTO usage_events(id,agent_id,kind,model_id,provider,usage_reported,outcome,failure_kind) VALUES(101,100,'chat','fixture','chatgpt',false,'failed','quota')",
    );
    for (const update of [
      "outcome='bogus'",
      "outcome='completed'",
      "failure_kind=null",
      "failure_kind=''",
      "usage_reported=null",
    ])
      await assert.rejects(
        client.exec("UPDATE usage_events SET " + update + " WHERE id=101"),
        /check constraint/,
      );
    assert.equal(
      (await client.query("SELECT id FROM agents WHERE id=100")).rows.length,
      1,
    );
    const before = JSON.parse(await read("meta/0032_snapshot.json")),
      after = JSON.parse(await read("meta/0033_snapshot.json"));
    assert.equal(after.prevId, before.id);
    const { "public.usage_events": previousUsage, ...previousTables } =
      before.tables;
    const { "public.usage_events": nextUsage, ...nextTables } = after.tables;
    assert.deepEqual(nextTables, previousTables);
    assert.deepEqual(nextUsage.foreignKeys, previousUsage.foreignKeys);
  } finally {
    await client.close();
  }
});
