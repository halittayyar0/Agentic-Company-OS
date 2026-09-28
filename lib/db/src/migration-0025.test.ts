import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("operator request migration retains accepted identities and rejects malformed state and encrypted tuples", async () => {
  const client = new PGlite();
  try {
    const read = (name: string) =>
      readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
    const journal = JSON.parse(await read("meta/_journal.json"));
    for (const entry of journal.entries.filter(
      (e: { idx: number }) => e.idx < 25,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    await client.exec(
      "INSERT INTO agents(id,name,role,system_prompt) VALUES(100,'Keep agent','Test','Test')",
    );
    await client.exec(await read("0025_operator_requests.sql"));
    assert.equal(
      (await client.query("SELECT id FROM agents WHERE id=100")).rows.length,
      1,
    );
    const id = "11111111-1111-4111-8111-111111111111";
    await client.query(
      "INSERT INTO operator_requests(request_id,agent_id,kind,request_hash,owner_id,runtime_version,state,expires_at) VALUES($1,100,'terminal_sandbox',$2,$1,0,'reserved',now()+interval '3 minutes')",
      [id, "a".repeat(64)],
    );
    for (const update of [
      "state='bogus'",
      "agent_id=0",
      "request_hash='bad'",
      "result_nonce='only-one-field'",
      "state='complete'",
      "exit_code=0",
      "kind='browser_input',result_ciphertext='secret'",
    ]) {
      await assert.rejects(
        client.exec("UPDATE operator_requests SET " + update),
        /check constraint/,
      );
    }
    await client.exec("DELETE FROM agents WHERE id=100");
    assert.equal(
      (await client.query("SELECT request_id FROM operator_requests")).rows
        .length,
      1,
    );
    const before = JSON.parse(await read("meta/0024_snapshot.json")),
      after = JSON.parse(await read("meta/0025_snapshot.json"));
    assert.equal(after.prevId, before.id);
    const { "public.operator_requests": receipt, ...tables } = after.tables;
    assert.deepEqual(tables, before.tables);
    assert.deepEqual(receipt.foreignKeys, {});
  } finally {
    await client.close();
  }
});
