import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("result-review migration preserves legacy rows and constrains operator-only proposals", async () => {
  const client = new PGlite();
  const read = (name: string) =>
    readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
  try {
    const journal = JSON.parse(await read("meta/_journal.json"));
    const target = journal.entries.filter(
      (entry: { idx: number }) => entry.idx === 48,
    );
    assert.equal(target.length, 1);
    for (const entry of journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 48,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    await client.exec(
      "INSERT INTO agents(id,name,role,system_prompt) VALUES(100,'Owner','Test','No inference')",
    );
    await client.exec(
      "INSERT INTO tasks(id,title,brief,owner_agent_id,status,result_summary) VALUES(100,'Existing','Keep brief',100,'completed','Keep exact result')",
    );
    await client.exec(
      "INSERT INTO approval_requests(id,task_id,agent_id,category,title,description,status) VALUES(100,100,100,'other','Legacy','Keep approval','approved')",
    );
    const before = (
      await client.query(
        "SELECT row_to_json(t) AS value FROM tasks t WHERE id=100",
      )
    ).rows[0] as { value: Record<string, unknown> };
    const approvalBefore = (
      await client.query(
        "SELECT row_to_json(a) AS value FROM approval_requests a WHERE id=100",
      )
    ).rows[0] as { value: Record<string, unknown> };
    await client.exec(await read(target[0].tag + ".sql"));
    const after = (
      await client.query(
        "SELECT row_to_json(t) AS value FROM tasks t WHERE id=100",
      )
    ).rows[0] as { value: Record<string, unknown> };
    const { completion_authority, ...unchanged } = after.value;
    assert.equal(completion_authority, null);
    assert.deepEqual(unchanged, before.value);
    const approvalAfter = (
      await client.query(
        "SELECT row_to_json(a) AS value FROM approval_requests a WHERE id=100",
      )
    ).rows[0] as { value: Record<string, unknown> };
    const { completion_proposal, ...approvalUnchanged } = approvalAfter.value;
    assert.equal(completion_proposal, null);
    assert.deepEqual(approvalUnchanged, approvalBefore.value);
    const proposal = {
      schemaVersion: 1,
      taskId: 100,
      ownerAgentId: 100,
      ownerConfigVersion: "a".repeat(64),
      cycleNumber: 0,
      cycleStartedAt: "2026-10-23T00:00:00.000Z",
      originAttemptId: "11111111-1111-4111-8111-111111111111",
      judgeReviewId: 1,
      judgeReasonCode: "missing_required_action",
      contextHash: "b".repeat(64),
      resultSummary: "Exact proposed result",
      resultSummaryHash: createHash("sha256")
        .update("Exact proposed result")
        .digest("hex"),
      sourceReceipts: [
        {
          receiptId: "source-receipt",
          argumentHash: "c".repeat(64),
          fileSha256: "d".repeat(64),
          byteCount: 73,
        },
      ],
    };
    const scope = {
      toolName: "operator_confirm_task_result",
      argsHash: "e".repeat(64),
    };
    await client.query(
      "INSERT INTO approval_requests(id,task_id,agent_id,category,title,description,scope,completion_proposal,created_at,expires_at) VALUES(101,100,100,'other','Review','Proposed result',$1::jsonb,$2::jsonb,'2026-10-23T00:00:00Z','2026-10-24T00:00:00Z')",
      [JSON.stringify(scope), JSON.stringify(proposal)],
    );
    for (const invalid of [
      { ...proposal, taskId: 101 },
      { ...proposal, ownerAgentId: 101 },
      { ...proposal, schemaVersion: 2 },
      { ...proposal, resultSummary: " " },
      { ...proposal, resultSummary: "Hidden\u0007control" },
      { ...proposal, resultSummary: "x".repeat(65537) },
      { ...proposal, resultSummary: "🧑".repeat(32769) },
      { ...proposal, cycleNumber: -1 },
      { ...proposal, cycleStartedAt: "not-a-date" },
      { ...proposal, judgeReasonCode: "scope_satisfied" },
      { ...proposal, contextHash: "invalid" },
      { ...proposal, rawSource: "must never be retained" },
      { ...proposal, sourceReceipts: [] },
      {
        ...proposal,
        sourceReceipts: [
          proposal.sourceReceipts[0],
          proposal.sourceReceipts[0],
        ],
      },
      {
        ...proposal,
        sourceReceipts: [{ ...proposal.sourceReceipts[0], byteCount: 4097 }],
      },
      {
        ...proposal,
        sourceReceipts: [
          { ...proposal.sourceReceipts[0], content: "private source" },
        ],
      },
    ])
      await assert.rejects(
        client.query(
          "UPDATE approval_requests SET completion_proposal=$1::jsonb WHERE id=101",
          [JSON.stringify(invalid)],
        ),
        /approval_requests_result_review_check/,
      );
    for (const change of [
      'action_payload=\'{"toolName":"vm_run_command","args":{}}\'::jsonb',
      "automatic_policy_revision=1",
      "amount_usd=1",
      "category='spend'",
      "scope=NULL",
      "expires_at=NULL",
      "expires_at=created_at + interval '25 hours'",
      "completion_proposal=NULL",
      "status='approved'",
      "consumed_at=now()",
    ])
      await assert.rejects(
        client.exec("UPDATE approval_requests SET " + change + " WHERE id=101"),
        /approval_requests_result_review_check/,
      );
    await assert.rejects(
      client.query(
        "INSERT INTO approval_requests(task_id,agent_id,category,title,description,scope,completion_proposal,created_at,expires_at) VALUES(100,100,'other','Duplicate','Duplicate',$1::jsonb,$2::jsonb,'2026-10-23T00:00:00Z','2026-10-24T00:00:00Z')",
        [JSON.stringify(scope), JSON.stringify(proposal)],
      ),
      /approval_requests_pending_result_review_idx/,
    );
    await client.exec(
      "UPDATE approval_requests SET status='approved',completion_proposal=NULL,consumed_at=now(),resolved_at=now() WHERE id=101",
    );
    await client.exec(
      "UPDATE tasks SET completion_authority='operator' WHERE id=100",
    );
    await assert.rejects(
      client.exec(
        "UPDATE tasks SET completion_authority='model_passed' WHERE id=100",
      ),
      /tasks_completion_authority_check/,
    );
    await assert.rejects(
      client.exec("UPDATE tasks SET result_summary=NULL WHERE id=100"),
      /tasks_completion_authority_check/,
    );
    const previous = JSON.parse(await read("meta/0047_snapshot.json"));
    const current = JSON.parse(await read("meta/0048_snapshot.json"));
    const { completion_authority: taskColumn, ...taskColumns } =
      current.tables["public.tasks"].columns;
    const { completion_proposal: approvalColumn, ...approvalColumns } =
      current.tables["public.approval_requests"].columns;
    assert.deepEqual(taskColumns, previous.tables["public.tasks"].columns);
    assert.deepEqual(
      approvalColumns,
      previous.tables["public.approval_requests"].columns,
    );
    assert.equal(taskColumn.notNull, false);
    assert.equal(approvalColumn.notNull, false);
  } finally {
    await client.close();
  }
});
