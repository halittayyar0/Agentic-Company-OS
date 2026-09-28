import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("migration 0019 keeps install receipts independent and rejects duplicate identities or invalid records", async () => {
  const client = new PGlite();
  try {
    await client.exec(
      await readFile(
        new URL(
          "./generated-sql/0019_workforce_installations.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const values = [
      "11111111-1111-4111-8111-111111111111",
      "a".repeat(64),
      "product-shipping-crew",
      1,
      JSON.stringify({ agents: [], task: null }),
    ];
    const insert =
      "INSERT INTO workforce_installations (request_id,request_hash,blueprint_key,blueprint_version,response) VALUES ($1,$2,$3,$4,$5)";
    await client.query(insert, values);
    await assert.rejects(client.query(insert, values), /duplicate key/);
    for (const [index, invalid] of [
      [1, "short"],
      [3, 0],
      [4, "[]"],
    ] as const) {
      const bad = [...values];
      bad[0] = "22222222-2222-4222-8222-222222222222";
      bad[index] = invalid;
      await assert.rejects(client.query(insert, bad), /check constraint/);
    }
    assert.equal(
      (await client.query("SELECT * FROM workforce_installations")).rows.length,
      1,
    );
    const before = JSON.parse(
      await readFile(
        new URL("./generated-sql/meta/0018_snapshot.json", import.meta.url),
        "utf8",
      ),
    );
    const after = JSON.parse(
      await readFile(
        new URL("./generated-sql/meta/0019_snapshot.json", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(after.prevId, before.id);
    const { "public.workforce_installations": receipt, ...unchanged } =
      after.tables;
    assert.ok(receipt);
    assert.deepEqual(unchanged, before.tables);
    assert.deepEqual(receipt.foreignKeys, {});
  } finally {
    await client.close();
  }
});
