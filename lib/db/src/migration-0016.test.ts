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

async function migrateThrough(
  client: PGlite,
  files: string[],
  terminalMigration: string,
): Promise<void> {
  for (const fileName of files.filter(
    (name) => name.localeCompare(terminalMigration, "en") <= 0,
  )) {
    await applyMigration(client, fileName);
  }
}

async function seedLegacyRuntime(client: PGlite): Promise<{
  agentId: number;
  taskId: number;
}> {
  const agent = await client.query<{ id: number }>(`
    INSERT INTO agents (name, role, system_prompt, created_by_user)
    VALUES ('Receipt worker', 'Specialist', 'Migration fixture', true)
    RETURNING id
  `);
  const agentId = agent.rows[0]?.id;
  assert.ok(agentId);

  const task = await client.query<{ id: number }>(
    `
      INSERT INTO tasks
        (title, brief, owner_agent_id, created_by_user, status, lease_owner, lease_expires_at, step_attempts)
      VALUES
        ('Receipt migration', 'Preserve legacy execution evidence.', $1, true, 'in_progress', 'lease-grandchild', now() + interval '90 seconds', 3)
      RETURNING id
    `,
    [agentId],
  );
  const taskId = task.rows[0]?.id;
  assert.ok(taskId);

  await client.query(`
    INSERT INTO runtime_instances
      (id, role, state, hostname, process_id, build_version, scheduler_enabled)
    VALUES ('runtime-receipts', 'worker', 'healthy', 'migration-host', 1601, 'test', true)
  `);
  await client.query(
    `
      INSERT INTO task_attempts
        (id, task_id, agent_id, worker_instance_id, lease_owner, attempt_number, cycle_number, state, finished_at)
      VALUES
        ('attempt-root', $1, $2, 'runtime-receipts', 'lease-root', 1, 0, 'lost', now() - interval '4 minutes')
    `,
    [taskId, agentId],
  );
  await client.query(
    `
      INSERT INTO task_attempts
        (id, task_id, agent_id, worker_instance_id, lease_owner, attempt_number, cycle_number, state, recovery_of_attempt_id, finished_at)
      VALUES
        ('attempt-child', $1, $2, 'runtime-receipts', 'lease-child', 2, 0, 'lost', 'attempt-root', now() - interval '2 minutes')
    `,
    [taskId, agentId],
  );
  await client.query(
    `
      INSERT INTO task_attempts
        (id, task_id, agent_id, worker_instance_id, lease_owner, attempt_number, cycle_number, state, recovery_of_attempt_id)
      VALUES
        ('attempt-grandchild', $1, $2, 'runtime-receipts', 'lease-grandchild', 3, 0, 'running', 'attempt-child')
    `,
    [taskId, agentId],
  );

  return { agentId, taskId };
}

test("migration 0016 preserves one logical execution across a recursive recovery chain", async () => {
  const client = new PGlite();
  try {
    const files = await migrationFiles();
    const migration0015 = files.find((name) => name.startsWith("0015_"));
    const migration0016 = files.find((name) => name.startsWith("0016_"));
    assert.ok(migration0015, "migration 0015 must be checked in");
    assert.ok(migration0016, "migration 0016 must be generated");

    await migrateThrough(client, files, migration0015);
    const { agentId, taskId } = await seedLegacyRuntime(client);

    const consumedApprovals = await client.query<{
      id: number;
      scope: { toolName: string };
    }>(
      `
        INSERT INTO approval_requests
          (task_id, agent_id, category, title, description, scope,
           action_payload, status, resolved_at, consumed_at)
        VALUES
          ($1, $2, 'external_contact', 'Consumed legacy capability',
           'Sensitive payload must be scrubbed by migration.',
           '{"toolName":"browser_type","argsHash":"legacy-type-hash","target":"LEGACY-TYPE-TARGET-SENTINEL","preview":"LEGACY-TYPE-PREVIEW-SENTINEL"}'::jsonb,
           '{"toolName":"browser_type","args":{"text":"LEGACY-TYPE-TEXT-SENTINEL"}}'::jsonb,
           'approved', now() - interval '2 minutes', now() - interval '1 minute'),
          ($1, $2, 'external_contact', 'Consumed legacy click',
           'Sensitive browser context must be scrubbed by migration.',
           '{"toolName":"browser_click","argsHash":"legacy-click-hash","target":"LEGACY-CLICK-TARGET-SENTINEL","preview":"LEGACY-CLICK-PREVIEW-SENTINEL"}'::jsonb,
           '{"toolName":"browser_click","args":{"ref":"LEGACY-CLICK-REF-SENTINEL"}}'::jsonb,
           'approved', now() - interval '2 minutes', now() - interval '1 minute'),
          ($1, $2, 'other', 'Consumed legacy command',
           'Exact command payload and preview must be scrubbed by migration.',
           '{"toolName":"vm_run_command","argsHash":"legacy-command-hash","target":"workspace-target","preview":"LEGACY-COMMAND-PREVIEW-SENTINEL"}'::jsonb,
           '{"toolName":"vm_run_command","args":{"command":"LEGACY-COMMAND-PAYLOAD-SENTINEL"}}'::jsonb,
           'approved', now() - interval '2 minutes', now() - interval '1 minute')
        RETURNING id, scope
      `,
      [taskId, agentId],
    );
    const consumedTypeApprovalId = consumedApprovals.rows.find(
      (approval) => approval.scope.toolName === "browser_type",
    )?.id;
    const consumedClickApprovalId = consumedApprovals.rows.find(
      (approval) => approval.scope.toolName === "browser_click",
    )?.id;
    const consumedCommandApprovalId = consumedApprovals.rows.find(
      (approval) => approval.scope.toolName === "vm_run_command",
    )?.id;
    assert.ok(consumedTypeApprovalId);
    assert.ok(consumedClickApprovalId);
    assert.ok(consumedCommandApprovalId);

    await client.query(
      `
        INSERT INTO activity_events
          (agent_id, task_id, type, summary, detail, severity)
        VALUES
          ($1, $2, 'approval_resolved', 'Legacy browser type completed.',
           '{"decisionNote":"legacy type","scope":{"toolName":"browser_type","argsHash":"legacy-type-hash","target":"LEGACY-EVENT-TYPE-TARGET-SENTINEL","preview":"LEGACY-EVENT-TYPE-PREVIEW-SENTINEL"},"status":"succeeded"}'::jsonb,
           'info'),
          ($1, $2, 'approval_resolved', 'Legacy browser click completed.',
           '{"decisionNote":"legacy click","scope":{"toolName":"browser_click","argsHash":"legacy-click-hash","target":"LEGACY-EVENT-CLICK-TARGET-SENTINEL","preview":"LEGACY-EVENT-CLICK-PREVIEW-SENTINEL"},"status":"succeeded"}'::jsonb,
           'info'),
          ($1, $2, 'approval_resolved', 'Legacy command completed.',
           '{"decisionNote":"legacy command","scope":{"toolName":"vm_run_command","argsHash":"legacy-command-hash","target":"workspace-target","preview":"LEGACY-EVENT-COMMAND-PREVIEW-SENTINEL"},"status":"succeeded"}'::jsonb,
           'info')
      `,
      [agentId, taskId],
    );

    await client.query(
      `
        INSERT INTO operation_receipts
          (id, operation_key, task_id, agent_id, attempt_id, worker_instance_id, side_effect_class, state, model_tool_call_id, tool_name, argument_hash)
        VALUES
          ('receipt-read', 'legacy-read', $1, $2, 'attempt-root', 'runtime-receipts', 'read_only', 'reserved', 'call-read', 'read_file', 'hash-read')
      `,
      [taskId, agentId],
    );
    await client.query(
      `
        INSERT INTO operation_receipts
          (id, operation_key, task_id, agent_id, attempt_id, worker_instance_id, side_effect_class, state, model_tool_call_id, tool_name, argument_hash, external_idempotency_key, started_at)
        VALUES
          ('receipt-running', 'legacy-running', $1, $2, 'attempt-child', 'runtime-receipts', 'approval_at_most_once', 'running', 'call-running', 'browser_click', 'hash-running', 'approval-key-running', now() - interval '1 minute')
      `,
      [taskId, agentId],
    );
    await client.query(
      `
        INSERT INTO operation_receipts
          (id, operation_key, task_id, agent_id, attempt_id, worker_instance_id, side_effect_class, state, model_tool_call_id, tool_name, argument_hash, external_idempotency_key, started_at, finished_at, result_summary)
        VALUES
          ('receipt-succeeded', 'legacy-succeeded', $1, $2, 'attempt-grandchild', 'runtime-receipts', 'idempotent', 'succeeded', 'call-succeeded', 'write_file', 'hash-succeeded', 'file-key-succeeded', now() - interval '2 minutes', now() - interval '1 minute', 'safe legacy evidence')
      `,
      [taskId, agentId],
    );

    await applyMigration(client, migration0016);

    const scrubbedApprovals = await client.query<{
      id: number;
      scope: unknown;
      action_payload: unknown | null;
    }>(
      `
        SELECT id, scope, action_payload
        FROM approval_requests
        WHERE id IN ($1, $2, $3)
        ORDER BY id
      `,
      [
        consumedTypeApprovalId,
        consumedClickApprovalId,
        consumedCommandApprovalId,
      ],
    );
    assert.equal(scrubbedApprovals.rows.length, 3);
    assert.deepEqual(
      scrubbedApprovals.rows.map((approval) => approval.scope),
      [
        {
          id: consumedTypeApprovalId,
          scope: { toolName: "browser_type", argsHash: "legacy-type-hash" },
        },
        {
          id: consumedClickApprovalId,
          scope: { toolName: "browser_click", argsHash: "legacy-click-hash" },
        },
        {
          id: consumedCommandApprovalId,
          scope: {
            toolName: "vm_run_command",
            argsHash: "legacy-command-hash",
            target: "workspace-target",
          },
        },
      ]
        .sort((left, right) => left.id - right.id)
        .map((entry) => entry.scope),
    );
    assert.ok(
      scrubbedApprovals.rows.every(
        (approval) => approval.action_payload === null,
      ),
    );

    const scrubbedResolutionEvents = await client.query<{ detail: unknown }>(
      `
        SELECT detail
        FROM activity_events
        WHERE task_id = $1 AND type = 'approval_resolved'
        ORDER BY id
      `,
      [taskId],
    );
    assert.deepEqual(scrubbedResolutionEvents.rows, [
      {
        detail: {
          decisionNote: "legacy type",
          scope: { toolName: "browser_type", argsHash: "legacy-type-hash" },
          status: "succeeded",
        },
      },
      {
        detail: {
          decisionNote: "legacy click",
          scope: { toolName: "browser_click", argsHash: "legacy-click-hash" },
          status: "succeeded",
        },
      },
      {
        detail: {
          decisionNote: "legacy command",
          scope: {
            toolName: "vm_run_command",
            argsHash: "legacy-command-hash",
            target: "workspace-target",
          },
          status: "succeeded",
        },
      },
    ]);
    const retainedLegacyData = JSON.stringify({
      approvals: scrubbedApprovals.rows,
      events: scrubbedResolutionEvents.rows,
    });
    for (const sentinel of [
      "LEGACY-TYPE-TARGET-SENTINEL",
      "LEGACY-TYPE-PREVIEW-SENTINEL",
      "LEGACY-TYPE-TEXT-SENTINEL",
      "LEGACY-CLICK-TARGET-SENTINEL",
      "LEGACY-CLICK-PREVIEW-SENTINEL",
      "LEGACY-CLICK-REF-SENTINEL",
      "LEGACY-EVENT-TYPE-TARGET-SENTINEL",
      "LEGACY-EVENT-TYPE-PREVIEW-SENTINEL",
      "LEGACY-EVENT-CLICK-TARGET-SENTINEL",
      "LEGACY-EVENT-CLICK-PREVIEW-SENTINEL",
      "LEGACY-COMMAND-PREVIEW-SENTINEL",
      "LEGACY-COMMAND-PAYLOAD-SENTINEL",
      "LEGACY-EVENT-COMMAND-PREVIEW-SENTINEL",
    ]) {
      assert.equal(retainedLegacyData.includes(sentinel), false);
    }
    await assert.rejects(
      client.query(
        `
          UPDATE approval_requests
          SET action_payload =
            '{"toolName":"browser_type","args":{"text":"RESTORED-SENSITIVE-SENTINEL"}}'::jsonb
          WHERE id = $1
        `,
        [consumedTypeApprovalId],
      ),
      /approval_requests_capability_payload_check|check/i,
    );

    const attempts = await client.query<{
      id: string;
      logical_execution_id: string;
    }>(`
      SELECT id, logical_execution_id
      FROM task_attempts
      WHERE id IN ('attempt-root', 'attempt-child', 'attempt-grandchild')
      ORDER BY attempt_number
    `);
    assert.equal(attempts.rows.length, 3);
    assert.equal(
      new Set(attempts.rows.map((attempt) => attempt.logical_execution_id))
        .size,
      1,
    );
    assert.match(
      attempts.rows[0]?.logical_execution_id ?? "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );

    const receipts = await client.query<{
      id: string;
      execution_kind: string;
      logical_execution_id: string;
      replay_key: string | null;
      state: string;
      origin_attempt_id: string | null;
      finished_at: Date | null;
    }>(`
      SELECT id, execution_kind, logical_execution_id, replay_key, state,
             origin_attempt_id, finished_at
      FROM operation_receipts
      ORDER BY id
    `);
    assert.equal(receipts.rows.length, 3);
    for (const receipt of receipts.rows) {
      assert.equal(receipt.execution_kind, "task_step");
      assert.equal(
        receipt.logical_execution_id,
        attempts.rows[0]?.logical_execution_id,
      );
      assert.ok(receipt.origin_attempt_id);
    }
    assert.equal(
      receipts.rows.find((receipt) => receipt.id === "receipt-read")
        ?.replay_key,
      null,
    );
    assert.equal(
      receipts.rows.find((receipt) => receipt.id === "receipt-running")?.state,
      "unknown",
    );
    assert.ok(
      receipts.rows.find((receipt) => receipt.id === "receipt-running")
        ?.finished_at,
    );
    assert.equal(
      receipts.rows.find((receipt) => receipt.id === "receipt-succeeded")
        ?.state,
      "succeeded",
    );
    assert.equal(
      receipts.rows.find((receipt) => receipt.id === "receipt-succeeded")
        ?.replay_key,
      "file-key-succeeded",
    );
    await assert.rejects(
      client.query(
        `
          INSERT INTO operation_receipts
            (id, canonical_version, operation_key, replay_key, execution_kind,
             logical_execution_id, task_id, agent_id, origin_attempt_id,
             side_effect_class, state, tool_name, argument_hash,
             external_idempotency_key)
          VALUES
            ('receipt-recovered-duplicate', 1, 'op:v1:new-physical-path',
             'replay:v1:new-canonical-hash', 'task_step', $1, $2, $3,
             'attempt-grandchild', 'idempotent', 'reserved', 'write_file',
             'new-argument-hash', 'file-key-succeeded')
        `,
        [attempts.rows[0]?.logical_execution_id, taskId, agentId],
      ),
      /operation_receipts_external_idempotency_key_unique|unique/i,
    );
    const legacyExternalFence = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM operation_receipts
      WHERE external_idempotency_key = 'file-key-succeeded'
    `);
    assert.equal(legacyExternalFence.rows[0]?.count, "1");

    const invocations = await client.query<{
      receipt_id: string;
      execution_kind: string;
      state: string;
      attempt_id: string | null;
      worker_instance_id: string | null;
      task_lease_owner: string | null;
    }>(`
      SELECT receipt_id, execution_kind, state, attempt_id,
             worker_instance_id, task_lease_owner
      FROM operation_invocations
      ORDER BY receipt_id
    `);
    assert.equal(invocations.rows.length, 3);
    assert.ok(
      invocations.rows.every(
        (invocation) =>
          invocation.execution_kind === "task_step" &&
          invocation.attempt_id !== null &&
          invocation.worker_instance_id === "runtime-receipts" &&
          invocation.task_lease_owner !== null,
      ),
    );
    assert.equal(
      invocations.rows.find(
        (invocation) => invocation.receipt_id === "receipt-read",
      )?.state,
      "failed",
    );
    assert.equal(
      invocations.rows.find(
        (invocation) => invocation.receipt_id === "receipt-running",
      )?.state,
      "unknown",
    );

    const blockedTask = await client.query<{
      status: string;
      blocked_reason: string | null;
    }>("SELECT status, blocked_reason FROM tasks WHERE id = $1", [taskId]);
    assert.deepEqual(blockedTask.rows, [
      { status: "blocked", blocked_reason: "operation_outcome_unknown" },
    ]);
  } finally {
    await client.close();
  }
});

test("migration 0016 scrubs rejected legacy approval payloads and resolution scopes", async () => {
  const client = new PGlite();
  try {
    const files = await migrationFiles();
    const migration0015 = files.find((name) => name.startsWith("0015_"));
    const migration0016 = files.find((name) => name.startsWith("0016_"));
    assert.ok(migration0015, "migration 0015 must be checked in");
    assert.ok(migration0016, "migration 0016 must be generated");

    await migrateThrough(client, files, migration0015);
    const { agentId, taskId } = await seedLegacyRuntime(client);

    const rejectedApprovals = await client.query<{
      id: number;
      scope: { toolName: string; argsHash: string };
    }>(
      `
        INSERT INTO approval_requests
          (task_id, agent_id, category, title, description, scope,
           action_payload, status, decision_note, resolved_at)
        VALUES
          ($1, $2, 'external_contact', 'Rejected legacy browser capability',
           'Sensitive browser target and preview must become a tombstone.',
           '{"toolName":"browser_type","argsHash":"rejected-browser-hash","target":"https://private.example.invalid/rejected?token=BROWSER-TARGET-SENTINEL","preview":"BROWSER-PREVIEW-SENTINEL"}'::jsonb,
           '{"toolName":"browser_type","args":{"text":"BROWSER-ACTION-PAYLOAD-SENTINEL"}}'::jsonb,
           'rejected', 'legacy browser rejected', now() - interval '3 minutes'),
          ($1, $2, 'other', 'Rejected legacy command capability',
           'Sensitive preview must become a tombstone without losing the safe target.',
           '{"toolName":"vm_run_command","argsHash":"rejected-command-hash","target":"workspace-target","preview":"COMMAND-PREVIEW-SENTINEL"}'::jsonb,
           '{"toolName":"vm_run_command","args":{"command":"COMMAND-ACTION-PAYLOAD-SENTINEL"}}'::jsonb,
           'rejected', 'legacy command rejected', now() - interval '2 minutes')
        RETURNING id, scope
      `,
      [taskId, agentId],
    );
    const rejectedBrowserApprovalId = rejectedApprovals.rows.find(
      (approval) => approval.scope.toolName === "browser_type",
    )?.id;
    const rejectedCommandApprovalId = rejectedApprovals.rows.find(
      (approval) => approval.scope.toolName === "vm_run_command",
    )?.id;
    assert.ok(rejectedBrowserApprovalId);
    assert.ok(rejectedCommandApprovalId);

    await client.query(
      `
        INSERT INTO activity_events
          (agent_id, task_id, type, summary, detail, severity)
        VALUES
          ($1, $2, 'approval_resolved', 'Rejected browser capability.',
           '{"decisionNote":"legacy browser rejected","scope":{"toolName":"browser_type","argsHash":"rejected-browser-hash","target":"https://private.example.invalid/rejected?token=EVENT-BROWSER-TARGET-SENTINEL","preview":"EVENT-BROWSER-PREVIEW-SENTINEL"},"status":"rejected"}'::jsonb,
           'warning'),
          ($1, $2, 'approval_resolved', 'Rejected command capability.',
           '{"decisionNote":"legacy command rejected","scope":{"toolName":"vm_run_command","argsHash":"rejected-command-hash","target":"workspace-target","preview":"EVENT-COMMAND-PREVIEW-SENTINEL"},"status":"rejected"}'::jsonb,
           'warning')
      `,
      [agentId, taskId],
    );

    await applyMigration(client, migration0016);

    const scrubbedApprovals = await client.query<{
      id: number;
      scope: unknown;
      action_payload: unknown | null;
    }>(
      `
        SELECT id, scope, action_payload
        FROM approval_requests
        WHERE id IN ($1, $2)
        ORDER BY id
      `,
      [rejectedBrowserApprovalId, rejectedCommandApprovalId],
    );
    assert.deepEqual(scrubbedApprovals.rows, [
      {
        id: rejectedBrowserApprovalId,
        scope: {
          toolName: "browser_type",
          argsHash: "rejected-browser-hash",
          target: null,
          preview: "REJECTED: capability sha256:rejected-browser-hash",
        },
        action_payload: null,
      },
      {
        id: rejectedCommandApprovalId,
        scope: {
          toolName: "vm_run_command",
          argsHash: "rejected-command-hash",
          target: "workspace-target",
          preview: "REJECTED: capability sha256:rejected-command-hash",
        },
        action_payload: null,
      },
    ]);

    const scrubbedResolutionEvents = await client.query<{ detail: unknown }>(
      `
        SELECT detail
        FROM activity_events
        WHERE task_id = $1 AND type = 'approval_resolved'
        ORDER BY id
      `,
      [taskId],
    );
    assert.deepEqual(scrubbedResolutionEvents.rows, [
      {
        detail: {
          decisionNote: "legacy browser rejected",
          scope: {
            toolName: "browser_type",
            argsHash: "rejected-browser-hash",
            target: null,
            preview: "REJECTED: capability sha256:rejected-browser-hash",
          },
          status: "rejected",
        },
      },
      {
        detail: {
          decisionNote: "legacy command rejected",
          scope: {
            toolName: "vm_run_command",
            argsHash: "rejected-command-hash",
            target: "workspace-target",
            preview: "REJECTED: capability sha256:rejected-command-hash",
          },
          status: "rejected",
        },
      },
    ]);
    const retainedRejectedData = JSON.stringify({
      approvals: scrubbedApprovals.rows,
      events: scrubbedResolutionEvents.rows,
    });
    for (const sentinel of [
      "BROWSER-TARGET-SENTINEL",
      "BROWSER-PREVIEW-SENTINEL",
      "BROWSER-ACTION-PAYLOAD-SENTINEL",
      "EVENT-BROWSER-TARGET-SENTINEL",
      "EVENT-BROWSER-PREVIEW-SENTINEL",
      "COMMAND-PREVIEW-SENTINEL",
      "COMMAND-ACTION-PAYLOAD-SENTINEL",
      "EVENT-COMMAND-PREVIEW-SENTINEL",
    ]) {
      assert.equal(retainedRejectedData.includes(sentinel), false);
    }

    await assert.rejects(
      client.query(
        `
          INSERT INTO approval_requests
            (task_id, agent_id, category, title, description, status,
             action_payload)
          VALUES
            ($1, $2, 'other', 'Rejected payload forbidden',
             'Rejected approvals cannot retain action payloads.',
             'rejected',
             '{"toolName":"vm_run_command","args":{"command":"RESTORED-REJECTED-PAYLOAD-SENTINEL"}}'::jsonb)
        `,
        [taskId, agentId],
      ),
      /approval_requests_capability_payload_check|check/i,
    );
  } finally {
    await client.close();
  }
});

test("migration 0016 scrubs malformed, partial, and non-object rejected legacy scopes", async () => {
  const client = new PGlite();
  try {
    const files = await migrationFiles();
    const migration0015 = files.find((name) => name.startsWith("0015_"));
    const migration0016 = files.find((name) => name.startsWith("0016_"));
    assert.ok(migration0015, "migration 0015 must be checked in");
    assert.ok(migration0016, "migration 0016 must be generated");

    await migrateThrough(client, files, migration0015);
    const { agentId, taskId } = await seedLegacyRuntime(client);
    const rejectedApprovals = await client.query<{ id: number }>(
      `
        INSERT INTO approval_requests
          (task_id, agent_id, category, title, description, scope,
           action_payload, status, decision_note, resolved_at)
        VALUES
          ($1, $2, 'external_contact', 'Malformed rejected capability',
           'Unexpected legacy scope keys must not survive migration.',
           '{"unexpected":"MALFORMED-APPROVAL-SCOPE-SENTINEL"}'::jsonb,
           '{"toolName":"browser_type","args":{"text":"MALFORMED-ACTION-PAYLOAD-SENTINEL"}}'::jsonb,
           'rejected', 'malformed legacy rejection', now() - interval '3 minutes'),
          ($1, $2, 'external_contact', 'Partial rejected capability',
           'A partial browser identity must become a generic tombstone.',
           '{"toolName":"browser_type","target":"PARTIAL-APPROVAL-TARGET-SENTINEL","preview":"PARTIAL-APPROVAL-PREVIEW-SENTINEL"}'::jsonb,
           '{"toolName":"browser_type","args":{"text":"PARTIAL-ACTION-PAYLOAD-SENTINEL"}}'::jsonb,
           'rejected', 'partial legacy rejection', now() - interval '2 minutes'),
          ($1, $2, 'other', 'Scalar rejected capability',
           'A non-object scope must become a generic tombstone.',
           '"NONOBJECT-APPROVAL-SCOPE-SENTINEL"'::jsonb,
           '{"toolName":"vm_run_command","args":{"command":"NONOBJECT-ACTION-PAYLOAD-SENTINEL"}}'::jsonb,
           'rejected', 'non-object legacy rejection', now() - interval '1 minute')
        RETURNING id
      `,
      [taskId, agentId],
    );
    const rejectedApprovalIds = rejectedApprovals.rows
      .map((approval) => approval.id)
      .sort((left, right) => left - right);
    assert.equal(rejectedApprovalIds.length, 3);

    await client.query(
      `
        INSERT INTO activity_events
          (agent_id, task_id, type, summary, detail, severity)
        VALUES
          ($1, $2, 'approval_resolved', 'Malformed rejected capability.',
           '{"decisionNote":"malformed legacy rejection","scope":{"unexpected":"MALFORMED-EVENT-SCOPE-SENTINEL"},"status":"rejected"}'::jsonb,
           'warning'),
          ($1, $2, 'approval_resolved', 'Partial rejected capability.',
           '{"decisionNote":"partial legacy rejection","scope":{"toolName":"browser_type","target":"PARTIAL-EVENT-TARGET-SENTINEL","preview":"PARTIAL-EVENT-PREVIEW-SENTINEL"},"status":"rejected"}'::jsonb,
           'warning'),
          ($1, $2, 'approval_resolved', 'Scalar rejected capability.',
           '{"decisionNote":"non-object legacy rejection","scope":"NONOBJECT-EVENT-SCOPE-SENTINEL","status":"rejected"}'::jsonb,
           'warning')
      `,
      [agentId, taskId],
    );

    await applyMigration(client, migration0016);

    const redactedScope = {
      toolName: "legacy_redacted",
      argsHash: "legacy-redacted",
      target: null,
      preview: "REJECTED: legacy capability redacted",
    };
    const scrubbedApprovals = await client.query<{
      id: number;
      scope: unknown;
      action_payload: unknown | null;
    }>(
      `
        SELECT id, scope, action_payload
        FROM approval_requests
        WHERE id = ANY($1::integer[])
        ORDER BY id
      `,
      [rejectedApprovalIds],
    );
    assert.deepEqual(
      scrubbedApprovals.rows.map((approval) => ({
        scope: approval.scope,
        actionPayload: approval.action_payload,
      })),
      Array.from({ length: 3 }, () => ({
        scope: redactedScope,
        actionPayload: null,
      })),
    );

    const scrubbedEvents = await client.query<{
      detail: Record<string, unknown>;
    }>(
      `
        SELECT detail
        FROM activity_events
        WHERE task_id = $1 AND type = 'approval_resolved'
        ORDER BY id
      `,
      [taskId],
    );
    assert.equal(scrubbedEvents.rows.length, 3);
    assert.deepEqual(
      scrubbedEvents.rows.map(
        (event) => (event.detail as { scope?: unknown }).scope,
      ),
      Array.from({ length: 3 }, () => redactedScope),
    );

    const retainedData = JSON.stringify({
      approvals: scrubbedApprovals.rows,
      events: scrubbedEvents.rows,
    });
    for (const sentinel of [
      "MALFORMED-APPROVAL-SCOPE-SENTINEL",
      "MALFORMED-ACTION-PAYLOAD-SENTINEL",
      "PARTIAL-APPROVAL-TARGET-SENTINEL",
      "PARTIAL-APPROVAL-PREVIEW-SENTINEL",
      "PARTIAL-ACTION-PAYLOAD-SENTINEL",
      "NONOBJECT-APPROVAL-SCOPE-SENTINEL",
      "NONOBJECT-ACTION-PAYLOAD-SENTINEL",
      "MALFORMED-EVENT-SCOPE-SENTINEL",
      "PARTIAL-EVENT-TARGET-SENTINEL",
      "PARTIAL-EVENT-PREVIEW-SENTINEL",
      "NONOBJECT-EVENT-SCOPE-SENTINEL",
    ]) {
      assert.equal(retainedData.includes(sentinel), false);
    }
  } finally {
    await client.close();
  }
});

test("migration 0016 enforces exact receipt and invocation variants", async () => {
  const client = new PGlite();
  try {
    const files = await migrationFiles();
    const migration0015 = files.find((name) => name.startsWith("0015_"));
    const migration0016 = files.find((name) => name.startsWith("0016_"));
    assert.ok(migration0015, "migration 0015 must be checked in");
    assert.ok(migration0016, "migration 0016 must be generated");
    await migrateThrough(client, files, migration0015);

    const { agentId, taskId } = await seedLegacyRuntime(client);
    await applyMigration(client, migration0016);
    const message = await client.query<{ id: number }>(
      `
        INSERT INTO messages (agent_id, role, content, task_id)
        VALUES ($1, 'user', 'Execute one durable chat turn.', $2)
        RETURNING id
      `,
      [agentId, taskId],
    );
    const messageId = message.rows[0]?.id;
    assert.ok(messageId);
    const approval = await client.query<{ id: number }>(
      `
        INSERT INTO approval_requests
          (task_id, agent_id, category, title, description, status, resolved_at)
        VALUES
          ($1, $2, 'external_contact', 'Bound click', 'Exact browser action', 'approved', now())
        RETURNING id
      `,
      [taskId, agentId],
    );
    const approvalId = approval.rows[0]?.id;
    assert.ok(approvalId);

    const logicalExecutionId = "11111111-1111-4111-8111-111111111111";
    await client.query(
      `
        INSERT INTO operation_receipts
          (id, canonical_version, operation_key, replay_key, execution_kind,
           logical_execution_id, task_id, agent_id, origin_attempt_id,
           side_effect_class, state, tool_name, argument_hash)
        VALUES
          ('receipt-task-step', 1, 'operation-task-step', 'replay-task-step',
           'task_step', $1, $2, $3, 'attempt-root', 'transactional', 'reserved',
           'create_task', 'hash-task-step')
      `,
      [logicalExecutionId, taskId, agentId],
    );
    await client.query(
      `
        INSERT INTO operation_receipts
          (id, canonical_version, operation_key, replay_key, execution_kind,
          logical_execution_id, task_id, agent_id, approval_id,
           side_effect_class, state, tool_name, argument_hash)
        VALUES
          ('receipt-approved', 1, 'operation-approved', 'replay-approved',
           'approved_action', 'approval:' || $1::integer::text, $2, $3, $1,
           'approval_at_most_once', 'reserved', 'browser_click', 'hash-approved')
      `,
      [approvalId, taskId, agentId],
    );
    await client.query(
      `
        INSERT INTO operation_receipts
          (id, canonical_version, operation_key, replay_key, execution_kind,
           logical_execution_id, task_id, agent_id, source_message_id,
           side_effect_class, state, tool_name, argument_hash)
        VALUES
          ('receipt-chat', 1, 'operation-chat', NULL, 'chat_turn',
           'chat:' || $1::integer::text, $2, $3, $1, 'read_only', 'reserved',
           'browser_snapshot', 'hash-chat')
      `,
      [messageId, taskId, agentId],
    );

    await assert.rejects(
      client.query(
        `
          INSERT INTO operation_receipts
            (id, canonical_version, operation_key, replay_key, execution_kind,
             logical_execution_id, task_id, agent_id, approval_id,
             source_message_id, side_effect_class, state, tool_name, argument_hash)
          VALUES
            ('receipt-invalid-mixed', 1, 'operation-invalid-mixed', NULL,
             'chat_turn', 'chat:invalid', $1, $2, $3, $4, 'read_only',
             'reserved', 'browser_snapshot', 'hash-invalid')
        `,
        [taskId, agentId, approvalId, messageId],
      ),
      /operation_receipts_execution_kind_check|check/i,
    );
    await assert.rejects(
      client.query(
        `
          INSERT INTO operation_receipts
            (id, canonical_version, operation_key, replay_key, execution_kind,
             logical_execution_id, task_id, agent_id, origin_attempt_id,
             side_effect_class, state, tool_name, argument_hash)
          VALUES
            ('receipt-invalid-effect', 1, 'operation-invalid-effect', NULL,
             'task_step', $1, $2, $3, 'attempt-root', 'at_most_once',
             'reserved', 'run_command', 'hash-invalid-effect')
        `,
        [logicalExecutionId, taskId, agentId],
      ),
      /operation_receipts_replay_key_check|check/i,
    );
    await assert.rejects(
      client.query(
        `
          INSERT INTO operation_receipts
            (id, canonical_version, operation_key, replay_key, execution_kind,
             logical_execution_id, task_id, agent_id, origin_attempt_id,
             side_effect_class, state, tool_name, argument_hash)
          VALUES
            ('receipt-invalid-read', 1, 'operation-invalid-read',
             'replay-invalid-read', 'task_step', $1, $2, $3, 'attempt-root',
             'read_only', 'reserved', 'read_file', 'hash-invalid-read')
        `,
        [logicalExecutionId, taskId, agentId],
      ),
      /operation_receipts_replay_key_check|check/i,
    );

    await client.query(`
      INSERT INTO operation_invocations
        (id, receipt_id, execution_kind, state, attempt_id,
         worker_instance_id, lease_owner, lease_expires_at,
         task_lease_owner, agent_lease_owner)
      VALUES
        ('invocation-active', 'receipt-task-step', 'task_step', 'claimed',
         'attempt-root', 'runtime-receipts', 'invocation-owner',
         now() + interval '90 seconds', 'lease-root', 'lease-root')
    `);
    await assert.rejects(
      client.query(`
        INSERT INTO operation_invocations
          (id, receipt_id, execution_kind, state, attempt_id,
           worker_instance_id, lease_owner, lease_expires_at,
           task_lease_owner, agent_lease_owner, effect_started_at)
        VALUES
          ('invocation-active-duplicate', 'receipt-task-step', 'task_step',
           'running', 'attempt-root', 'runtime-receipts', 'other-owner',
           now() + interval '90 seconds', 'lease-root', 'lease-root', now())
      `),
      /operation_invocations_one_active_per_receipt|unique/i,
    );
    await assert.rejects(
      client.query(`
        INSERT INTO operation_invocations
          (id, receipt_id, execution_kind, state, worker_instance_id,
           lease_owner, lease_expires_at)
        VALUES
          ('invocation-invalid-task-step', 'receipt-task-step', 'task_step',
           'failed', 'runtime-receipts', 'bad-owner',
           now() + interval '90 seconds')
      `),
      /operation_invocations_execution_kind_check|check/i,
    );
    await assert.rejects(
      client.query(`
        INSERT INTO operation_invocations
          (id, receipt_id, execution_kind, state, worker_instance_id,
           lease_owner, lease_expires_at, agent_lease_owner)
        VALUES
          ('invocation-running-without-effect', 'receipt-approved',
           'approved_action', 'running', 'runtime-receipts',
           'running-without-effect-owner', now() + interval '90 seconds',
           'lease-grandchild')
      `),
      /operation_invocations_state_timestamps_check|check/i,
    );
    await assert.rejects(
      client.query(`
        INSERT INTO operation_invocations
          (id, receipt_id, execution_kind, state, lease_owner,
           lease_expires_at, agent_lease_owner, effect_started_at)
        VALUES
          ('invocation-claimed-with-effect', 'receipt-chat', 'chat_turn',
           'claimed', 'claimed-with-effect-owner',
           now() + interval '90 seconds', 'lease-grandchild', now())
      `),
      /operation_invocations_state_timestamps_check|check/i,
    );

    await client.query(
      `
        UPDATE approval_requests
        SET browser_runtime_instance_id = 'runtime-receipts',
            browser_session_id = 'browser-session-one',
            browser_session_epoch = 4,
            browser_snapshot_marker = 'snapshot-marker-one',
            browser_binding_hash = 'binding-hash-one'
        WHERE id = $1
      `,
      [approvalId],
    );
    const binding = await client.query<{
      browser_runtime_instance_id: string | null;
      browser_session_id: string | null;
      browser_session_epoch: number | null;
      browser_snapshot_marker: string | null;
      browser_binding_hash: string | null;
      binding_invalidated_at: Date | null;
      binding_invalidation_reason: string | null;
    }>(
      `
        SELECT browser_runtime_instance_id, browser_session_id,
               browser_session_epoch, browser_snapshot_marker,
               browser_binding_hash, binding_invalidated_at,
               binding_invalidation_reason
        FROM approval_requests
        WHERE id = $1
      `,
      [approvalId],
    );
    assert.deepEqual(binding.rows, [
      {
        browser_runtime_instance_id: "runtime-receipts",
        browser_session_id: "browser-session-one",
        browser_session_epoch: 4,
        browser_snapshot_marker: "snapshot-marker-one",
        browser_binding_hash: "binding-hash-one",
        binding_invalidated_at: null,
        binding_invalidation_reason: null,
      },
    ]);
  } finally {
    await client.close();
  }
});

test("migration 0016 fails closed for effectful legacy receipts without replay evidence", async () => {
  const client = new PGlite();
  try {
    const files = await migrationFiles();
    const migration0015 = files.find((name) => name.startsWith("0015_"));
    const migration0016 = files.find((name) => name.startsWith("0016_"));
    assert.ok(migration0015);
    assert.ok(migration0016);
    await migrateThrough(client, files, migration0015);
    const { agentId, taskId } = await seedLegacyRuntime(client);
    await client.query(
      `
        INSERT INTO operation_receipts
          (id, operation_key, task_id, agent_id, attempt_id, worker_instance_id,
           side_effect_class, state, model_tool_call_id, tool_name, argument_hash)
        VALUES
          ('receipt-unrepresentable', 'legacy-no-replay-evidence', $1, $2,
           'attempt-root', 'runtime-receipts', 'idempotent', 'reserved',
           'call-unrepresentable', 'write_file', 'hash-unrepresentable')
      `,
      [taskId, agentId],
    );
    await assert.rejects(
      applyMigration(client, migration0016),
      /legacy operation receipt lacks replay evidence/i,
    );
  } finally {
    await client.close();
  }
});
