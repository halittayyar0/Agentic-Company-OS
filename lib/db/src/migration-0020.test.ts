import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("message send receipts reject duplicate identities and malformed state without modifying earlier tables", async () => {
  const client = new PGlite();
  try {
    await client.exec(
      await readFile(
        new URL(
          "./generated-sql/0020_company_message_requests.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const insert =
      "INSERT INTO company_message_requests (request_id,request_hash,response) VALUES ($1,$2,$3)";
    const values = [
      "11111111-1111-4111-8111-111111111111",
      "a".repeat(64),
      JSON.stringify({ deliveryState: "unconfirmed" }),
    ];
    await client.query(insert, values);
    await assert.rejects(client.query(insert, values), /duplicate key/);
    for (const response of ["[]", "{}", '{"deliveryState":"running"}']) {
      await assert.rejects(
        client.query(insert, [
          "22222222-2222-4222-8222-222222222222",
          values[1],
          response,
        ]),
        /check constraint/,
      );
    }
    await assert.rejects(
      client.query(insert, [
        "22222222-2222-4222-8222-222222222222",
        "short",
        values[2],
      ]),
      /check constraint/,
    );
    const before = JSON.parse(
      await readFile(
        new URL("./generated-sql/meta/0019_snapshot.json", import.meta.url),
        "utf8",
      ),
    );
    const after = JSON.parse(
      await readFile(
        new URL("./generated-sql/meta/0020_snapshot.json", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(after.prevId, before.id);
    const { "public.company_message_requests": receipt, ...unchanged } =
      after.tables;
    assert.deepEqual(unchanged, before.tables);
    assert.deepEqual(receipt.foreignKeys, {});
  } finally {
    await client.close();
  }
});
