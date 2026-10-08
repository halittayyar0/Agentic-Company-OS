import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("Codex approval migration binds one-time lifecycle metadata without executable payloads or invented action receipts", async () => {
  const client = new PGlite();
  const read = (name: string) =>
    readFile(new URL("./generated-sql/" + name, import.meta.url), "utf8");
  try {
    const journal = JSON.parse(await read("meta/_journal.json"));
    for (const entry of journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 35,
    ))
      await client.exec(await read(entry.tag + ".sql"));
    await client.exec(
      "INSERT INTO agents(id,name,role,system_prompt) VALUES(100,'Keep agent','Fixture','Fixture')",
    );
    await client.exec(
      "INSERT INTO tasks(id,title,brief,owner_agent_id,status) VALUES(100,'Keep job','Fixture',100,'in_progress')",
    );
    await client.exec(
      "INSERT INTO approval_requests(id,task_id,agent_id,category,title,description) VALUES(100,100,100,'other','Keep approval','Fixture'),(101,100,100,'other','Other approval','Fixture')",
    );
    await client.exec(
      "INSERT INTO codex_task_sessions(task_id,agent_id,revision,state,owner_token,attempt_id,lease_owner,policy_revision,registration_id,registration_revision,admission_version,host_id,cwd,storage_directory,home,model,executable_digest) VALUES(100,100,1,'running','00000000-0000-4000-8000-000000000001','attempt_fixture','lease_fixture',1,'registration_fixture',1,0,'fixture-host','/workspace','/private','/private/home','fixture-model',repeat('a',64))",
    );
    await client.exec(await read("0035_codex_action_approvals.sql"));
    const insert = (approvalId: number) =>
      `INSERT INTO codex_action_approvals(approval_id,task_id,agent_id,session_revision,session_owner_token,attempt_id,lease_owner,policy_revision,registration_id,registration_revision,admission_version,thread_id,turn_id,item_id,request_key,action_started_at_ms,action_revision,action_digest,effect_type,state,expires_at) VALUES(${approvalId},100,100,1,'00000000-0000-4000-8000-000000000001','attempt_fixture','lease_fixture',1,'registration_fixture',1,0,'thread_fixture','turn_fixture','item_fixture_${approvalId}','string:approval_fixture_${approvalId}',100,1,repeat('a',64),'commandExecution','awaiting',now()+interval '1 minute')`;
    await client.exec(insert(100));
    await assert.rejects(client.exec(insert(101)), /unique constraint/);
    for (const mutation of [
      "session_revision=0",
      "registration_revision=0",
      "session_revision=9007199254740992",
      "admission_version=-1",
      "action_digest='bad'",
      "action_revision=0",
      "action_started_at_ms=-1",
      "state='approved'",
      "effect_type='stdin'",
      "thread_id='bad id'",
      "request_key='bad id'",
      "state='consumed'",
      "consumed_at=now()",
      "decision='acceptForSession'",
      "native_status='completed'",
      "native_completed_at_ms=105",
      "native_exit_code=0",
      "state='invalidated'",
      "state='uncertain'",
    ])
      await assert.rejects(
        client.exec(
          "UPDATE codex_action_approvals SET " +
            mutation +
            " WHERE approval_id=100",
        ),
        /check constraint/,
      );
    await client.exec(
      "UPDATE codex_action_approvals SET state='consumed',decision='accept',consumed_at=now() WHERE approval_id=100",
    );
    await assert.rejects(client.exec(insert(101)), /unique constraint/);
    for (const mutation of [
      "state='receipted'",
      "state='receipted',native_status='completed',native_completed_at_ms=105",
      "state='receipted',native_status='completed',native_completed_at_ms=105,native_exit_code=1",
      "state='receipted',native_status='completed',native_completed_at_ms=99,native_exit_code=0",
    ])
      await assert.rejects(
        client.exec(
          "UPDATE codex_action_approvals SET " +
            mutation +
            " WHERE approval_id=100",
        ),
        /check constraint/,
      );
    await client.exec(
      "UPDATE codex_action_approvals SET state='receipted',native_status='completed',native_completed_at_ms=105,native_exit_code=0 WHERE approval_id=100",
    );
    await assert.rejects(
      client.exec(
        insert(101).replace(
          "string:approval_fixture_101",
          "string:approval_fixture_100",
        ),
      ),
      /unique constraint/,
    );
    await client.exec(insert(101));
    await client.exec(
      "UPDATE codex_action_approvals SET state='invalidated',invalidated_at=now(),invalidation_reason='native_withdrawal' WHERE approval_id=101",
    );
    assert.equal(
      (
        await client.query<{ title: string }>(
          "SELECT title FROM tasks WHERE id=100",
        )
      ).rows[0].title,
      "Keep job",
    );
    assert.equal(
      (
        await client.query<{ action_payload: unknown | null }>(
          "SELECT action_payload FROM approval_requests WHERE id=100",
        )
      ).rows[0].action_payload,
      null,
    );
    const before = JSON.parse(await read("meta/0034_snapshot.json"));
    const after = JSON.parse(await read("meta/0035_snapshot.json"));
    assert.equal(after.prevId, before.id);
    const { "public.codex_action_approvals": added, ...retained } =
      after.tables;
    assert.deepEqual(retained, before.tables);
    for (const column of [
      "account_id",
      "prompt",
      "command",
      "patch",
      "action_payload",
      "access_token",
      "refresh_token",
    ])
      assert.equal(Object.hasOwn(added.columns, column), false);
    await client.exec("DELETE FROM approval_requests WHERE id IN (100,101)");
    assert.equal(
      (await client.query("SELECT approval_id FROM codex_action_approvals"))
        .rows.length,
      0,
    );
  } finally {
    await client.close();
  }
});
