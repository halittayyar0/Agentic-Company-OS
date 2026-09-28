import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("answer migration recovers only recorded unanswered questions and retains durable request identities", async () => {
  const client = new PGlite();
  try {
    const journal = JSON.parse(
      await readFile(
        new URL("./generated-sql/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    );
    for (const entry of journal.entries.filter(
      (e: { idx: number }) => e.idx < 22,
    ))
      await client.exec(
        await readFile(
          new URL(`./generated-sql/${entry.tag}.sql`, import.meta.url),
          "utf8",
        ),
      );
    await client.exec(
      "INSERT INTO agents (id,name,role,system_prompt) VALUES (100,'Owner','Test','Test'),(101,'Other','Test','Test'); INSERT INTO tasks (id,title,brief,owner_agent_id,status,blocked_reason,last_error) VALUES (100,'Current','Test',100,'blocked','user_input','Generic wait'),(101,'Missing','Test',100,'blocked','user_input','Generic wait'),(102,'Answered','Test',100,'blocked','user_input','Generic wait'),(103,'Reassigned','Test',101,'blocked','user_input','Generic wait');",
    );
    await client.exec(
      `INSERT INTO activity_events (agent_id,task_id,type,summary,detail) VALUES (100,100,'note','Question','{"question":"Which date?"}'),(100,102,'note','Question','{"question":"Old question"}'),(100,102,'task_status_changed','Answer','{"runtimeEvent":"task_resumed_with_user_input"}'),(100,103,'note','Question','{"question":"Other owner question"}');`,
    );
    for (const [id, question] of [
      [104, "x".repeat(1000)],
      [105, "😀".repeat(500)],
      [106, ""],
    ] as const) {
      await client.query(
        "INSERT INTO tasks(id,title,brief,owner_agent_id,status,blocked_reason) VALUES($1,'Legacy boundary','Test',100,'blocked','user_input')",
        [id],
      );
      for (const value of ["An earlier unanswered question", question]) {
        await client.query(
          "INSERT INTO activity_events(agent_id,task_id,type,summary,detail) VALUES(100,$1,'note','Question',$2)",
          [id, JSON.stringify({ question: value })],
        );
      }
    }
    await client.exec(
      await readFile(
        new URL(
          "./generated-sql/0022_task_answer_requests.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const rows = await client.query<{
      id: number;
      user_input_question_id: string | null;
      user_input_question: string | null;
      last_error: string;
    }>(
      "SELECT id,user_input_question_id,user_input_question,last_error FROM tasks WHERE id BETWEEN 100 AND 103 ORDER BY id",
    );
    assert.match(rows.rows[0].user_input_question_id!, /^[a-f\d-]{36}$/);
    assert.equal(rows.rows[0].user_input_question, "Which date?");
    for (const row of rows.rows.slice(1))
      assert.equal(row.user_input_question_id, null);
    assert.ok(rows.rows.every((r) => r.last_error === "Generic wait"));
    const ambiguous = await client.query<{
      user_input_question_id: string | null;
    }>("SELECT user_input_question_id FROM tasks WHERE id BETWEEN 104 AND 106");
    assert.ok(
      ambiguous.rows.every((row) => row.user_input_question_id === null),
    );
    const insert =
      "INSERT INTO task_answer_requests(request_id,task_id,question_id,request_hash,response) VALUES($1,$2,$3,$4,$5)";
    const id = "11111111-1111-4111-8111-111111111111";
    await client.query(insert, [
      id,
      100,
      id,
      "a".repeat(64),
      '{"outcome":"accepted"}',
    ]);
    await client.exec("DELETE FROM tasks WHERE id=100");
    await assert.rejects(
      client.query(insert, [
        id,
        101,
        id,
        "b".repeat(64),
        '{"outcome":"rejected"}',
      ]),
      /duplicate key/,
    );
    await assert.rejects(
      client.query(insert, [
        "22222222-2222-4222-8222-222222222222",
        101,
        id,
        "b".repeat(64),
        '{"outcome":"unknown"}',
      ]),
      /check constraint/,
    );
    const before = JSON.parse(
      await readFile(
        new URL("./generated-sql/meta/0021_snapshot.json", import.meta.url),
        "utf8",
      ),
    );
    const after = JSON.parse(
      await readFile(
        new URL("./generated-sql/meta/0022_snapshot.json", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(after.prevId, before.id);
    const { "public.task_answer_requests": receipt, ...tables } = after.tables;
    for (const name of [
      "user_input_question_id",
      "user_input_question",
      "user_input_owner_agent_id",
    ])
      delete tables["public.tasks"].columns[name];
    assert.deepEqual(tables, before.tables);
    assert.deepEqual(receipt.foreignKeys, {});
  } finally {
    await client.close();
  }
});
