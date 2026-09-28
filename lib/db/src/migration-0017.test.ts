import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

async function migrationFiles(): Promise<string[]> {
  return (await readdir(new URL("./generated-sql/", import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function applyMigration(client: PGlite, fileName: string): Promise<void> {
  const migration = await readFile(
    new URL(`./generated-sql/${fileName}`, import.meta.url),
    "utf8",
  );
  await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
}

test("migration 0017 adds truthful sampler evidence and bounded operations cursor indexes", async () => {
  const client = new PGlite();
  try {
    const files = await migrationFiles();
    const migration0016 = files.find((name) => name.startsWith("0016_"));
    const migration0017 = files.find((name) => name.startsWith("0017_"));
    assert.ok(migration0016, "migration 0016 must be checked in");
    assert.ok(migration0017, "migration 0017 must be generated");

    for (const fileName of files.filter(
      (name) => name.localeCompare(migration0016, "en") <= 0,
    )) {
      await applyMigration(client, fileName);
    }

    const legacyBucket = new Date("2026-09-01T12:00:00.000Z");
    await client.query(
      "INSERT INTO runtime_health_samples (bucket_at) VALUES ($1)",
      [legacyBucket],
    );

    await applyMigration(client, migration0017);

    const legacy = await client.query<{
      sampled_at: Date | null;
      sampled_by_instance_id: string | null;
      runtime_truth_state: string | null;
      provider_metrics_coverage: string;
    }>(
      `SELECT sampled_at, sampled_by_instance_id, runtime_truth_state,
              provider_metrics_coverage
         FROM runtime_health_samples
        WHERE bucket_at = $1`,
      [legacyBucket],
    );
    assert.deepEqual(legacy.rows, [
      {
        sampled_at: null,
        sampled_by_instance_id: null,
        runtime_truth_state: null,
        provider_metrics_coverage: "partial",
      },
    ]);

    await client.query(
      `INSERT INTO activity_events (type, summary, detail)
       VALUES ('operations_changed', 'Operational state changed.',
               '{"schemaVersion":1,"kind":"health_sample_recorded"}'::jsonb)`,
    );
    await assert.rejects(
      client.query(
        "INSERT INTO activity_events (type, summary) VALUES ('unbounded_runtime_event', 'bad')",
      ),
      /activity_events_type_check/,
    );

    const indexes = await client.query<{ indexname: string }>(`
      SELECT indexname
        FROM pg_indexes
       WHERE indexname IN (
         'activity_events_operations_id_idx',
         'activity_events_operations_task_id_idx',
         'operation_invocations_receipt_claimed_idx',
         'operation_receipts_task_reserved_idx',
         'runtime_instances_role_heartbeat_idx',
         'task_attempts_state_heartbeat_idx',
         'task_attempts_task_started_idx'
       )
       ORDER BY indexname
    `);
    assert.deepEqual(
      indexes.rows.map((row) => row.indexname),
      [
        "activity_events_operations_id_idx",
        "activity_events_operations_task_id_idx",
        "operation_invocations_receipt_claimed_idx",
        "operation_receipts_task_reserved_idx",
        "runtime_instances_role_heartbeat_idx",
        "task_attempts_state_heartbeat_idx",
        "task_attempts_task_started_idx",
      ],
    );
  } finally {
    await client.close();
  }
});
