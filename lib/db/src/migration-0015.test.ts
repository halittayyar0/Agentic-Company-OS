import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

async function applyMigration(client: PGlite, fileName: string): Promise<void> {
  const migration = await readFile(
    new URL(`./generated-sql/${fileName}`, import.meta.url),
    "utf8",
  );
  await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
}

async function migrationFiles(): Promise<string[]> {
  return (await readdir(new URL("./generated-sql/", import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function tableNames(client: PGlite, names: string[]): Promise<string[]> {
  const tables = await client.query<{ tablename: string }>(
    `
      SELECT tablename
      FROM pg_catalog.pg_tables
      WHERE schemaname = 'public' AND tablename = ANY($1::text[])
      ORDER BY tablename
    `,
    [names],
  );
  return tables.rows.map((table) => table.tablename);
}

test("migration 0015 adds durable runtime evidence", async () => {
  const client = new PGlite();
  try {
    const files = await migrationFiles();
    const migration0014 = files.find((name) => name.startsWith("0014_"));
    const migration0015 = files.find((name) => name.startsWith("0015_"));
    assert.ok(migration0014, "migration 0014 must be checked in");
    assert.ok(migration0015, "migration 0015 must be generated");

    for (const fileName of files.filter(
      (name) => name.localeCompare(migration0014, "en") <= 0,
    )) {
      await applyMigration(client, fileName);
    }
    await applyMigration(client, migration0015);

    assert.deepEqual(
      await tableNames(client, [
        "runtime_instances",
        "task_attempts",
        "operation_receipts",
        "runtime_health_samples",
      ]),
      [
        "operation_receipts",
        "runtime_health_samples",
        "runtime_instances",
        "task_attempts",
      ],
    );

    const owner = await client.query<{ id: number }>(`
      INSERT INTO agents (name, role, system_prompt, created_by_user)
      VALUES ('Runtime owner', 'Coordinator', 'Test only', true)
      RETURNING id
    `);
    const attemptAgent = await client.query<{ id: number }>(`
      INSERT INTO agents (name, role, system_prompt, created_by_user)
      VALUES ('Runtime worker agent', 'Specialist', 'Test only', true)
      RETURNING id
    `);
    const ownerId = owner.rows[0]?.id;
    const attemptAgentId = attemptAgent.rows[0]?.id;
    assert.ok(ownerId);
    assert.ok(attemptAgentId);

    const task = await client.query<{ id: number }>(
      `
        INSERT INTO tasks (title, brief, owner_agent_id, created_by_user)
        VALUES ('Runtime test task', 'Exercise 0015 constraints.', $1, true)
        RETURNING id
      `,
      [ownerId],
    );
    const taskId = task.rows[0]?.id;
    assert.ok(taskId);

    await client.query(`
      INSERT INTO runtime_instances
        (id, role, state, hostname, process_id, build_version, scheduler_enabled)
      VALUES ('runtime-worker', 'worker', 'healthy', 'test-host', 1001, 'test', true)
    `);
    await client.query(
      `
        INSERT INTO task_attempts
          (id, task_id, agent_id, worker_instance_id, lease_owner, attempt_number, cycle_number, state)
        VALUES ('attempt-parent', $1, $2, 'runtime-worker', 'lease-parent', 1, 0, 'succeeded')
      `,
      [taskId, attemptAgentId],
    );
    await client.query(
      `
        INSERT INTO task_attempts
          (id, task_id, agent_id, worker_instance_id, lease_owner, attempt_number, cycle_number, state, recovery_of_attempt_id)
        VALUES ('attempt-child', $1, $2, 'runtime-worker', 'lease-child', 2, 1, 'running', 'attempt-parent')
      `,
      [taskId, attemptAgentId],
    );
    await client.query(
      `
        INSERT INTO operation_receipts
          (id, operation_key, task_id, agent_id, attempt_id, worker_instance_id, side_effect_class, model_tool_call_id, tool_name, argument_hash)
        VALUES ('receipt-one', 'operation-key-one', $1, $2, 'attempt-child', 'runtime-worker', 'idempotent', 'call-1', 'read_file', 'hash-1')
      `,
      [taskId, attemptAgentId],
    );

    await assert.rejects(
      client.query(
        `
          INSERT INTO operation_receipts
            (id, operation_key, task_id, agent_id, attempt_id, worker_instance_id, side_effect_class, model_tool_call_id, tool_name, argument_hash)
          VALUES ('receipt-duplicate', 'operation-key-one', $1, $2, 'attempt-child', 'runtime-worker', 'idempotent', 'call-2', 'read_file', 'hash-2')
        `,
        [taskId, attemptAgentId],
      ),
      /unique/i,
    );
    await assert.rejects(
      client.query(`
        INSERT INTO runtime_instances
          (id, role, state, hostname, process_id, build_version, scheduler_enabled)
        VALUES ('runtime-invalid-role', 'scheduler', 'healthy', 'test-host', 1002, 'test', false)
      `),
      /runtime_instances_role_check|check/i,
    );
    await assert.rejects(
      client.query(`
        INSERT INTO runtime_instances
          (id, role, state, hostname, process_id, build_version, scheduler_enabled)
        VALUES ('runtime-invalid-state', 'worker', 'unknown', 'test-host', 1003, 'test', false)
      `),
      /runtime_instances_state_check|check/i,
    );
    await assert.rejects(
      client.query(
        `
          INSERT INTO task_attempts
            (id, task_id, agent_id, worker_instance_id, lease_owner, attempt_number, cycle_number, state)
          VALUES ('attempt-invalid-state', $1, $2, 'runtime-worker', 'lease-invalid', 3, 1, 'queued')
        `,
        [taskId, attemptAgentId],
      ),
      /task_attempts_state_check|check/i,
    );
    await assert.rejects(
      client.query(
        `
          INSERT INTO operation_receipts
            (id, operation_key, task_id, agent_id, attempt_id, worker_instance_id, side_effect_class, model_tool_call_id, tool_name, argument_hash)
          VALUES ('receipt-invalid-class', 'operation-key-invalid-class', $1, $2, 'attempt-child', 'runtime-worker', 'automatic_replay', 'call-3', 'read_file', 'hash-3')
        `,
        [taskId, attemptAgentId],
      ),
      /operation_receipts_side_effect_class_check|check/i,
    );
    await assert.rejects(
      client.query(
        `
          INSERT INTO task_attempts
            (id, task_id, agent_id, worker_instance_id, lease_owner, attempt_number, cycle_number)
          VALUES ('attempt-invalid-task', 999999, $1, 'runtime-worker', 'lease-invalid-task', 4, 1)
        `,
        [attemptAgentId],
      ),
      /foreign key/i,
    );
    await assert.rejects(
      client.query(
        `
          INSERT INTO task_attempts
            (id, task_id, agent_id, worker_instance_id, lease_owner, attempt_number, cycle_number)
          VALUES ('attempt-invalid-agent', $1, 999999, 'runtime-worker', 'lease-invalid-agent', 5, 1)
        `,
        [taskId],
      ),
      /foreign key/i,
    );
    await assert.rejects(
      client.query(
        `
          INSERT INTO task_attempts
            (id, task_id, agent_id, worker_instance_id, lease_owner, attempt_number, cycle_number)
          VALUES ('attempt-invalid-worker', $1, $2, 'runtime-missing', 'lease-invalid-worker', 6, 1)
        `,
        [taskId, attemptAgentId],
      ),
      /foreign key/i,
    );
    await assert.rejects(
      client.query("DELETE FROM tasks WHERE id = $1", [taskId]),
      /foreign key/i,
    );
    await assert.rejects(
      client.query("DELETE FROM agents WHERE id = $1", [attemptAgentId]),
      /foreign key/i,
    );
    await assert.rejects(
      client.query("DELETE FROM runtime_instances WHERE id = 'runtime-worker'"),
      /foreign key/i,
    );
    await assert.rejects(
      client.query("DELETE FROM task_attempts WHERE id = 'attempt-child'"),
      /foreign key/i,
    );

    await client.query("DELETE FROM task_attempts WHERE id = 'attempt-parent'");
    const recoveredAttempt = await client.query<{
      recovery_of_attempt_id: string | null;
    }>(
      "SELECT recovery_of_attempt_id FROM task_attempts WHERE id = 'attempt-child'",
    );
    assert.deepEqual(recoveredAttempt.rows, [{ recovery_of_attempt_id: null }]);
  } finally {
    await client.close();
  }
});
