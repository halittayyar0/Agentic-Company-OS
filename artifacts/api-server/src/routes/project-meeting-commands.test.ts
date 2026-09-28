import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  dbReady,
  agentsTable,
  tasksTable,
  projectMeetingsTable,
  projectMeetingDecisionsTable,
  projectMeetingActionItemsTable,
  projectMeetingTranscriptTable,
  projectMeetingCommandsTable,
  type MeetingCommandResult,
} from "@workspace/db";
import { createProjectMeetingsRouter } from "./project-meetings";

test("manual meeting commands require identity and replay one atomic outcome across routers", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Command fixture",
      role: "Test",
      systemPrompt: "Test",
      createdByUser: true,
    })
    .returning();
  const [project] = await db
    .insert(tasksTable)
    .values({
      title: "Command fixture",
      brief: "Test",
      ownerAgentId: agent.id,
      createdByUser: true,
    })
    .returning();
  const servers = [0, 1].map(() => {
    const app = express();
    app.use(express.json());
    app.use("/api", createProjectMeetingsRouter());
    return app.listen(0, "127.0.0.1");
  });
  await Promise.all(
    servers.map(
      (server) => new Promise<void>((r) => server.once("listening", r)),
    ),
  );
  const bases = servers.map((server) => {
    const a = server.address();
    assert.ok(a && typeof a === "object");
    return `http://127.0.0.1:${a.port}/api`;
  });
  const request = (path: string, method = "GET", body?: unknown, replica = 0) =>
    fetch(bases[replica] + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const prefix = `/projects/${project.id}/meetings`;
  t.after(async () => {
    await Promise.all(
      servers.map(
        (server) => new Promise<void>((r) => server.close(() => r())),
      ),
    );
    await db.delete(tasksTable).where(eq(tasksTable.id, project.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  assert.equal(
    (await request(prefix, "POST", { title: "Missing identity" })).status,
    400,
  );
  assert.equal(
    (
      await db
        .select()
        .from(projectMeetingsTable)
        .where(eq(projectMeetingsTable.taskId, project.id))
    ).length,
    0,
  );
  const input = {
    requestId: randomUUID(),
    title: "Exact source",
    participantAgentIds: [agent.id],
  };
  const responses = await Promise.all([
    request(prefix, "POST", input),
    request(prefix, "POST", input, 1),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [201, 201],
  );
  const bodies = await Promise.all(responses.map((r) => r.json()));
  assert.deepEqual(bodies[0], bodies[1]);
  const result = bodies[0] as MeetingCommandResult;
  assert.equal(result.requestId, input.requestId);
  assert.equal(result.kind, "create");
  assert.equal(result.projectId, project.id);
  assert.ok(result.meetingId !== null && result.meetingId > 0);
  assert.equal(result.entityId, result.meetingId);
  assert.equal(JSON.stringify(result).includes("Exact source"), false);
  assert.equal(
    (
      await db
        .select()
        .from(projectMeetingsTable)
        .where(eq(projectMeetingsTable.taskId, project.id))
    ).length,
    1,
  );
  assert.equal(
    (await request(prefix, "POST", { ...input, title: "Changed" })).status,
    409,
  );
  const decision = {
    requestId: randomUUID(),
    content: "Only one decision",
    ownerAgentId: agent.id,
  };
  const decisionPath = `${prefix}/${result.meetingId}/decisions`;
  const first = await request(decisionPath, "POST", decision);
  assert.equal(first.status, 201);
  const outcome = await first.json();
  const again = await request(decisionPath, "POST", decision, 1);
  assert.deepEqual(await again.json(), outcome);
  assert.equal(
    (
      await db
        .select()
        .from(projectMeetingDecisionsTable)
        .where(eq(projectMeetingDecisionsTable.meetingId, result.meetingId))
    ).length,
    1,
  );
  const lookup = `/projects/${project.id}/meeting-commands/${decision.requestId}`;
  const receipt = await request(lookup);
  assert.equal(receipt.status, 200);
  const observed = (await receipt.json()) as {
    httpStatus: number;
    response: MeetingCommandResult;
  };
  assert.equal(observed.httpStatus, 201);
  assert.deepEqual(observed.response, outcome);
  assert.equal(
    (
      await request(
        `/projects/${project.id + 999}/meeting-commands/${decision.requestId}`,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`${prefix}/${result.meetingId}/action-items`, "POST", {
        requestId: decision.requestId,
        title: "Wrong kind",
      })
    ).status,
    409,
  );
  const path = `${prefix}/${result.meetingId}`;
  const update = { requestId: randomUUID(), title: "First change" };
  const updated = (await (
    await request(path, "PATCH", update)
  ).json()) as MeetingCommandResult;
  assert.equal(updated.ok, true);
  assert.equal(
    (
      await request(path, "PATCH", {
        requestId: randomUUID(),
        title: "Second change",
      })
    ).status,
    200,
  );
  assert.deepEqual(
    await (await request(path, "PATCH", update, 1)).json(),
    updated,
  );
  assert.equal(
    ((await (await request(path)).json()) as { meeting: { title: string } })
      .meeting.title,
    "Second change",
    "replay must not overwrite a later edit",
  );
  assert.equal(
    (await request(path, "PATCH", { requestId: randomUUID() })).status,
    400,
  );
  const note = { requestId: randomUUID(), content: "Manual source" };
  const noteResult = (await (
    await request(path + "/transcript", "POST", note)
  ).json()) as MeetingCommandResult;
  assert.equal(noteResult.kind, "transcript");
  assert.deepEqual(
    await (await request(path + "/transcript", "POST", note, 1)).json(),
    noteResult,
  );
  assert.equal(
    (
      await db
        .select()
        .from(projectMeetingTranscriptTable)
        .where(eq(projectMeetingTranscriptTable.meetingId, result.meetingId))
    ).length,
    1,
  );
  const action = (await (
    await request(path + "/action-items", "POST", {
      requestId: randomUUID(),
      title: "Tracked after the meeting",
    })
  ).json()) as MeetingCommandResult;
  assert.ok(action.entityId);
  const actionPath = path + "/action-items/" + action.entityId;
  const done = { requestId: randomUUID(), status: "done" };
  const doneResult = (await (
    await request(actionPath, "PATCH", done)
  ).json()) as MeetingCommandResult;
  assert.equal(doneResult.kind, "action-update");
  assert.equal(
    (
      await request(actionPath, "PATCH", {
        requestId: randomUUID(),
        status: "open",
      })
    ).status,
    200,
  );
  assert.deepEqual(
    await (await request(actionPath, "PATCH", done, 1)).json(),
    doneResult,
  );
  assert.equal(
    (
      await db
        .select()
        .from(projectMeetingActionItemsTable)
        .where(eq(projectMeetingActionItemsTable.id, action.entityId))
    )[0].status,
    "open",
  );
  const finish = {
    requestId: randomUUID(),
    summary: "Closure",
    decisions: [{ content: "Bulk decision", ownerAgentId: agent.id }],
    actionItems: [{ title: "Bulk action" }],
  };
  const tooEarly = await request(path + "/complete", "POST", finish);
  assert.equal(tooEarly.status, 409);
  const rejection = await tooEarly.json();
  await db
    .update(projectMeetingsTable)
    .set({ status: "in_progress", startedAt: new Date() })
    .where(eq(projectMeetingsTable.id, result.meetingId));
  assert.deepEqual(
    await (await request(path + "/complete", "POST", finish, 1)).json(),
    rejection,
    "an accepted rejection cannot become success later",
  );
  const finalInput = { ...finish, requestId: randomUUID() };
  const finished = await request(path + "/complete", "POST", finalInput);
  assert.equal(finished.status, 200);
  const finalResult = await finished.json();
  assert.deepEqual(
    await (await request(path + "/complete", "POST", finalInput, 1)).json(),
    finalResult,
  );
  assert.equal(
    (
      await db
        .select()
        .from(projectMeetingDecisionsTable)
        .where(eq(projectMeetingDecisionsTable.meetingId, result.meetingId))
    ).length,
    2,
  );
  assert.equal(
    (
      await db
        .select()
        .from(projectMeetingActionItemsTable)
        .where(eq(projectMeetingActionItemsTable.meetingId, result.meetingId))
    ).length,
    2,
  );
  assert.equal(
    (
      await request(actionPath, "PATCH", {
        requestId: randomUUID(),
        status: "done",
      })
    ).status,
    200,
    "closing the meeting must not disable explicit follow-up tracking",
  );

  const failingInput = {
    requestId: randomUUID(),
    title: "Rollback all or nothing",
  };
  const before = (
    await db
      .select()
      .from(projectMeetingsTable)
      .where(eq(projectMeetingsTable.taskId, project.id))
  ).length;
  await db.execute(
    sql`CREATE FUNCTION reject_meeting_command_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt fixture'; END; $$;`,
  );
  await db.execute(
    sql`CREATE TRIGGER reject_meeting_command_fixture BEFORE INSERT ON project_meeting_commands FOR EACH ROW EXECUTE FUNCTION reject_meeting_command_fixture();`,
  );
  try {
    assert.equal((await request(prefix, "POST", failingInput)).status, 500);
    assert.equal(
      (
        await db
          .select()
          .from(projectMeetingsTable)
          .where(eq(projectMeetingsTable.taskId, project.id))
      ).length,
      before,
    );
    assert.equal(
      (
        await db
          .select()
          .from(projectMeetingCommandsTable)
          .where(
            eq(projectMeetingCommandsTable.requestId, failingInput.requestId),
          )
      ).length,
      0,
    );
  } finally {
    await db.execute(
      sql`DROP TRIGGER reject_meeting_command_fixture ON project_meeting_commands;`,
    );
    await db.execute(sql`DROP FUNCTION reject_meeting_command_fixture();`);
  }
  assert.equal((await request(prefix, "POST", failingInput, 1)).status, 201);
  const beforeRead = await db
    .select()
    .from(projectMeetingCommandsTable)
    .where(eq(projectMeetingCommandsTable.projectId, project.id));
  await request(lookup);
  await request(lookup);
  assert.deepEqual(
    await db
      .select()
      .from(projectMeetingCommandsTable)
      .where(eq(projectMeetingCommandsTable.projectId, project.id)),
    beforeRead,
    "receipt reads never mutate rows",
  );
  await db.delete(tasksTable).where(eq(tasksTable.id, project.id));
  const replayAfterDelete = await request(decisionPath, "POST", decision, 1);
  assert.equal(replayAfterDelete.status, 201);
  assert.deepEqual(await replayAfterDelete.json(), outcome);
  assert.equal((await request(lookup)).status, 200);
});
