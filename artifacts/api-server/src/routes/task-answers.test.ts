import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  dbReady,
  agentsTable,
  tasksTable,
  activityEventsTable,
  taskAnswerRequestsTable,
  runtimeControlsTable,
} from "@workspace/db";
import app from "../app";
function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          Host: `127.0.0.1:${port}`,
          Origin: `http://127.0.0.1:${port}`,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (responseBody += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: responseBody }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function listen(): Promise<{
  port: number;
  close(): Promise<void>;
}> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    port: address.port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function fixture() {
  await dbReady;
  const [owner] = await db
    .insert(agentsTable)
    .values({
      name: "Question owner",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Question safety",
      brief: "Test only",
      ownerAgentId: owner.id,
      status: "blocked",
      blockedReason: "user_input",
      userInputQuestionId: randomUUID(),
      userInputQuestion: "Which release channel?",
      userInputOwnerAgentId: owner.id,
      lastError: "Kullanici girdisi bekleniyor.",
    })
    .returning();
  return {
    owner,
    task,
    input: {
      requestId: randomUUID(),
      questionId: task.userInputQuestionId!,
      answer: "Prepare the GitHub release.",
    },
  };
}

test("exact question, duplicate sends and delayed replay cannot answer a later question", async (t) => {
  const f = await fixture();
  const server = await listen();
  t.after(() => server.close());
  const path = `/api/tasks/${f.task.id}`;
  const q = await request(server.port, "GET", `${path}/question`);
  assert.equal(JSON.parse(q.body).question, "Which release channel?");
  assert.equal(JSON.parse(q.body).answerable, true);
  const bad = await request(server.port, "POST", `${path}/resume`, {
    answer: "legacy unbound answer",
  });
  assert.equal(bad.status, 400);
  const replies = await Promise.all([
    request(server.port, "POST", `${path}/resume`, f.input),
    request(server.port, "POST", `${path}/resume`, f.input),
  ]);
  for (const r of replies) {
    assert.equal(r.status, 200, r.body);
    assert.equal(JSON.parse(r.body).outcome, "accepted");
  }
  assert.deepEqual(JSON.parse(replies[0].body), JSON.parse(replies[1].body));
  const events = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.taskId, f.task.id));
  assert.equal(events.length, 1);
  assert.equal(events[0].detail?.questionId, f.input.questionId);
  const changed = await request(server.port, "POST", `${path}/resume`, {
    ...f.input,
    answer: "Different answer",
  });
  assert.equal(changed.status, 409);
  const later = randomUUID();
  await db
    .update(tasksTable)
    .set({
      status: "blocked",
      blockedReason: "user_input",
      userInputQuestionId: later,
      userInputQuestion: "What date?",
      userInputOwnerAgentId: f.owner.id,
    })
    .where(eq(tasksTable.id, f.task.id));
  const replay = await request(server.port, "POST", `${path}/resume`, f.input);
  assert.equal(JSON.parse(replay.body).outcome, "accepted");
  const delayed = await request(server.port, "POST", `${path}/resume`, {
    ...f.input,
    requestId: randomUUID(),
  });
  assert.equal(JSON.parse(delayed.body).reason, "question_changed");
  const [still] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, f.task.id));
  assert.equal(still.status, "blocked");
  assert.equal(still.userInputQuestionId, later);
  const receipt = await request(
    server.port,
    "GET",
    `${path}/resume/${f.input.requestId}`,
  );
  assert.deepEqual(JSON.parse(receipt.body), JSON.parse(replay.body));
  assert.equal(
    (
      await request(
        server.port,
        "GET",
        `/api/tasks/${f.task.id + 1}/resume/${f.input.requestId}`,
      )
    ).status,
    404,
  );
});

test("changed owner, inactive owner, held lease and unknown question fail closed", async (t) => {
  const server = await listen();
  t.after(() => server.close());
  for (const kind of ["owner", "inactive", "lease", "missing"] as const) {
    const f = await fixture();
    if (kind === "owner") {
      const other = await fixture();
      await db
        .update(tasksTable)
        .set({ ownerAgentId: other.owner.id })
        .where(eq(tasksTable.id, f.task.id));
    }
    if (kind === "inactive")
      await db
        .update(agentsTable)
        .set({ isActive: false })
        .where(eq(agentsTable.id, f.owner.id));
    if (kind === "lease")
      await db
        .update(tasksTable)
        .set({ leaseOwner: "in-flight" })
        .where(eq(tasksTable.id, f.task.id));
    if (kind === "missing")
      await db
        .update(tasksTable)
        .set({ userInputQuestionId: null, userInputQuestion: null })
        .where(eq(tasksTable.id, f.task.id));
    const q = await request(
      server.port,
      "GET",
      `/api/tasks/${f.task.id}/question`,
    );
    assert.equal(JSON.parse(q.body).answerable, false);
    const r = await request(
      server.port,
      "POST",
      `/api/tasks/${f.task.id}/resume`,
      f.input,
    );
    assert.equal(r.status, 200, r.body);
    assert.equal(JSON.parse(r.body).outcome, "rejected");
    assert.equal(
      JSON.parse(r.body).reason,
      kind === "inactive"
        ? "owner_inactive"
        : kind === "lease"
          ? "task_changed"
          : "question_changed",
    );
    const [stored] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, f.task.id));
    assert.equal(stored.status, "blocked");
  }
});

test("two different request identities cannot consume the same question twice", async (t) => {
  const f = await fixture();
  const server = await listen();
  t.after(() => server.close());
  const results = await Promise.all(
    [
      f.input,
      {
        ...f.input,
        requestId: randomUUID(),
        answer: "Another reviewed answer",
      },
    ].map((input) =>
      request(server.port, "POST", `/api/tasks/${f.task.id}/resume`, input),
    ),
  );
  assert.deepEqual(results.map((r) => JSON.parse(r.body).outcome).sort(), [
    "accepted",
    "rejected",
  ]);
  const events = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.taskId, f.task.id));
  assert.equal(events.length, 1);
  const receipts = await db
    .select()
    .from(taskAnswerRequestsTable)
    .where(eq(taskAnswerRequestsTable.taskId, f.task.id));
  assert.equal(receipts.length, 2);
});

test("receipt failure rolls back the answer and scheduling; retry commits once", async (t) => {
  const f = await fixture();
  const server = await listen();
  t.after(() => server.close());
  await db.execute(
    sql.raw(
      `CREATE FUNCTION reject_answer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt storage failure'; END $$`,
    ),
  );
  await db.execute(
    sql.raw(
      "CREATE TRIGGER fail_answer_receipt BEFORE INSERT ON task_answer_requests FOR EACH ROW EXECUTE FUNCTION reject_answer_receipt()",
    ),
  );
  try {
    const r = await request(
      server.port,
      "POST",
      `/api/tasks/${f.task.id}/resume`,
      f.input,
    );
    assert.equal(r.status, 500);
    const [still] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, f.task.id));
    assert.equal(still.status, "blocked");
    assert.equal(still.userInputQuestionId, f.input.questionId);
    assert.equal(
      (
        await db
          .select()
          .from(activityEventsTable)
          .where(eq(activityEventsTable.taskId, f.task.id))
      ).length,
      0,
    );
    assert.equal(
      (
        await request(
          server.port,
          "GET",
          `/api/tasks/${f.task.id}/resume/${f.input.requestId}`,
        )
      ).status,
      404,
    );
  } finally {
    await db.execute(
      sql.raw("DROP TRIGGER fail_answer_receipt ON task_answer_requests"),
    );
    await db.execute(sql.raw("DROP FUNCTION reject_answer_receipt()"));
  }
  const r = await request(
    server.port,
    "POST",
    `/api/tasks/${f.task.id}/resume`,
    f.input,
  );
  assert.equal(JSON.parse(r.body).outcome, "accepted");
});

test("durable receipt survives task deletion and stop; new answers remain rejected", async (t) => {
  const f = await fixture();
  const server = await listen();
  t.after(() => server.close());
  const path = `/api/tasks/${f.task.id}/resume`;
  const accepted = await request(server.port, "POST", path, f.input);
  assert.equal(JSON.parse(accepted.body).outcome, "accepted");
  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: true })
    .where(eq(runtimeControlsTable.id, 1));
  try {
    const again = await request(server.port, "POST", path, f.input);
    assert.deepEqual(JSON.parse(again.body), JSON.parse(accepted.body));
    const other = await fixture();
    const rejected = await request(
      server.port,
      "POST",
      `/api/tasks/${other.task.id}/resume`,
      other.input,
    );
    assert.equal(JSON.parse(rejected.body).reason, "emergency_stop");
  } finally {
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: false })
      .where(eq(runtimeControlsTable.id, 1));
  }
  await db.delete(tasksTable).where(eq(tasksTable.id, f.task.id));
  const read = await request(
    server.port,
    "GET",
    `${path}/${f.input.requestId}`,
  );
  assert.equal(read.status, 200);
  assert.deepEqual(JSON.parse(read.body), JSON.parse(accepted.body));
  const replay = await request(server.port, "POST", path, f.input);
  assert.deepEqual(JSON.parse(replay.body), JSON.parse(accepted.body));
});
