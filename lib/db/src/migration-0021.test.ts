import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("expert request migration preserves prior tables and rejects ambiguous receipt identities and states", async () => {
  const client = new PGlite();
  try {
    await client.exec(
      await readFile(
        new URL(
          "./generated-sql/0021_agent_interaction_requests.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const insert =
      "INSERT INTO agent_interaction_requests (request_id,agent_id,request_hash,response) VALUES ($1,$2,$3,$4)";
    const identity = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    await client.query(insert, [
      identity,
      1,
      "a".repeat(64),
      '{"deliveryState":"unconfirmed"}',
    ]);
    await assert.rejects(
      client.query(insert, [
        identity,
        2,
        "b".repeat(64),
        '{"deliveryState":"complete"}',
      ]),
      /duplicate key/,
    );
    for (const value of [
      "[]",
      "{}",
      '{"deliveryState":"running"}',
      '{"deliveryState":null}',
    ]) {
      await assert.rejects(
        client.query(insert, [other, 1, "a".repeat(64), value]),
        /check constraint/,
      );
    }
    await assert.rejects(
      client.query(insert, [
        other,
        0,
        "a".repeat(64),
        '{"deliveryState":"complete"}',
      ]),
      /check constraint/,
    );
    await assert.rejects(
      client.query(insert, [other, 1, "short", '{"deliveryState":"complete"}']),
      /check constraint/,
    );
    await client.query(insert, [
      other,
      1,
      "b".repeat(64),
      '{"deliveryState":"rejected"}',
    ]);
    const before = JSON.parse(
      await readFile(
        new URL("./generated-sql/meta/0020_snapshot.json", import.meta.url),
        "utf8",
      ),
    );
    const after = JSON.parse(
      await readFile(
        new URL("./generated-sql/meta/0021_snapshot.json", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(after.prevId, before.id);
    const { "public.agent_interaction_requests": receipt, ...unchanged } =
      after.tables;
    assert.deepEqual(unchanged, before.tables);
    assert.deepEqual(receipt.foreignKeys, {});
  } finally {
    await client.close();
  }
});
