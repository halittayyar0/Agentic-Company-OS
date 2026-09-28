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
  const sql = await readFile(
    new URL(`./generated-sql/${fileName}`, import.meta.url),
    "utf8",
  );
  await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
}

test("migration 0018 stores only browser command metadata and enforces monotonic config primitives", async () => {
  const client = new PGlite();
  try {
    const files = await migrationFiles();
    const migration0017 = files.find((name) => name.startsWith("0017_"));
    const migration0018 = files.find((name) => name.startsWith("0018_"));
    assert.ok(migration0017, "migration 0017 must be checked in");
    assert.ok(migration0018, "migration 0018 must be generated");
    for (const file of files.filter(
      (name) => name.localeCompare(migration0017, "en") <= 0,
    )) {
      await applyMigration(client, file);
    }

    const agent = await client.query<{ id: number }>(`
      INSERT INTO agents (name, role, system_prompt, created_by_user)
      VALUES ('Control worker', 'Specialist', 'Migration fixture', true)
      RETURNING id
    `);
    const agentId = agent.rows[0]?.id;
    assert.ok(agentId);
    await client.query(`
      INSERT INTO runtime_instances
        (id, role, state, hostname, process_id, build_version, scheduler_enabled)
      VALUES
        ('11111111-1111-4111-8111-111111111111', 'worker', 'healthy',
         'migration-host', 1801, 'test', true)
    `);

    await applyMigration(client, migration0018);

    const columns = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'runtime_control_commands'
      ORDER BY ordinal_position
    `);
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      [
        "id",
        "target_runtime_instance_id",
        "target_runtime_started_at",
        "agent_id",
        "kind",
        "state",
        "payload_digest",
        "requested_at",
        "expires_at",
        "dispatched_at",
        "finished_at",
        "result_digest",
        "failure_kind",
        "sanitized_error",
      ],
    );

    await client.query(
      `
        INSERT INTO runtime_browser_sessions
          (agent_id, runtime_instance_id, runtime_started_at,
           browser_session_id, browser_session_epoch)
        SELECT $1, id, started_at, 'session-one', 1
        FROM runtime_instances
        WHERE id = '11111111-1111-4111-8111-111111111111'
      `,
      [agentId],
    );
    await assert.rejects(
      client.query(
        `
          UPDATE runtime_browser_sessions
          SET browser_session_epoch = 0
          WHERE agent_id = $1
        `,
        [agentId],
      ),
      /runtime_browser_sessions_epoch_check|check/iu,
    );

    await client.query(`
      INSERT INTO provider_runtime_config
        (singleton_id, revision, ciphertext, nonce, auth_tag)
      VALUES
        (1, 1, 'encrypted-provider-config', 'abcdefghijklmnop',
         'abcdefghijklmnop')
    `);
    await assert.rejects(
      client.query(`UPDATE provider_runtime_config SET revision = 0`),
      /provider_runtime_config_revision_check|check/iu,
    );
    const revision = await client.query<{ revision: string }>(`
      UPDATE provider_runtime_config
      SET revision = revision + 1
      RETURNING revision
    `);
    assert.equal(Number(revision.rows[0]?.revision), 2);

    await client.query(
      `
        INSERT INTO runtime_control_commands
          (id, target_runtime_instance_id, target_runtime_started_at,
           agent_id, kind, state, payload_digest, expires_at)
        SELECT
          '22222222-2222-4222-8222-222222222222', id, started_at, $1,
          'browser_input', 'queued', repeat('a', 64), now() + interval '30 seconds'
        FROM runtime_instances
        WHERE id = '11111111-1111-4111-8111-111111111111'
      `,
      [agentId],
    );
    const persisted = await client.query<Record<string, unknown>>(`
      SELECT * FROM runtime_control_commands
      WHERE id = '22222222-2222-4222-8222-222222222222'
    `);
    const serialized = JSON.stringify(persisted.rows);
    assert.equal(serialized.includes("OTP-SENTINEL"), false);
    assert.equal(serialized.includes("PNG-SENTINEL"), false);
    assert.equal(serialized.includes("operator input"), false);
    await assert.rejects(
      client.query(`
        UPDATE runtime_control_commands
        SET state = 'succeeded'
        WHERE id = '22222222-2222-4222-8222-222222222222'
      `),
      /runtime_control_commands_timestamps_check|check/iu,
    );
  } finally {
    await client.close();
  }
});
