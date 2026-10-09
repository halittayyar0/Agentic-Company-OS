import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("health sample migration preserves evidence and stores ages beyond 25 days without truncation", async () => {
  const client = new PGlite();
  const read = (name: string) =>
    readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
  try {
    const journal = JSON.parse(await read("meta/_journal.json"));
    for (const entry of journal.entries.filter(
      (e: { idx: number }) => e.idx < 40,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    await client.exec(`INSERT INTO runtime_health_samples(bucket_at,scheduler_tick_age_ms,oldest_due_age_ms)
      VALUES('2026-01-01T00:00:00Z',123,456),('2026-01-01T00:01:00Z',NULL,NULL)`);
    const rows = () =>
      client.query(
        "SELECT row_to_json(s) AS sample FROM runtime_health_samples s ORDER BY bucket_at",
      );
    const before = (await rows()).rows;
    for (const entry of journal.entries.filter(
      (e: { idx: number }) => e.idx >= 40,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    assert.deepEqual((await rows()).rows, before);
    const age = 30 * 24 * 60 * 60 * 1000;
    await client.query(
      "INSERT INTO runtime_health_samples(bucket_at,scheduler_tick_age_ms,oldest_due_age_ms) VALUES('2026-01-01T00:02:00Z',$1,$2)",
      [age, age + 1],
    );
    const [sample] = (
      await client.query<{ scheduler: string; due: string }>(
        "SELECT scheduler_tick_age_ms::text AS scheduler,oldest_due_age_ms::text AS due FROM runtime_health_samples WHERE bucket_at='2026-01-01T00:02:00Z'",
      )
    ).rows;
    assert.equal(sample?.scheduler, String(age));
    assert.equal(sample?.due, String(age + 1));
    await assert.rejects(
      client.exec("UPDATE runtime_health_samples SET scheduler_tick_age_ms=-1"),
      /runtime_health_samples_nonnegative_ages_check/,
    );
    await assert.rejects(
      client.exec("UPDATE runtime_health_samples SET oldest_due_age_ms=-1"),
      /runtime_health_samples_nonnegative_oldest_due_age_check/,
    );
  } finally {
    await client.close();
  }
});
