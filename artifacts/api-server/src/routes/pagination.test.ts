import assert from "node:assert/strict";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  db,
  dbReady,
  messagesTable,
  tasksTable,
} from "@workspace/db";
import app from "../app";

test("cursor pagination is bounded, stable, and rejects invalid filters", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Pagination test agent",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const tasks = await db
    .insert(tasksTable)
    .values(
      [1, 2, 3].map((sequence) => ({
        title: `Pagination task ${sequence}`,
        brief: "Cursor pagination integration test",
        ownerAgentId: agent.id,
        createdByUser: true,
      })),
    )
    .returning();
  const messages = await db
    .insert(messagesTable)
    .values(
      [1, 2, 3].map((sequence) => ({
        agentId: agent.id,
        role: sequence % 2 === 0 ? ("agent" as const) : ("user" as const),
        content: `message-${sequence}`,
      })),
    )
    .returning();

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  const firstTasksResponse = await fetch(
    `${baseUrl}/tasks?ownerAgentId=${agent.id}&limit=2`,
  );
  assert.equal(firstTasksResponse.status, 200);
  const firstTasks = (await firstTasksResponse.json()) as Array<{ id: number }>;
  assert.deepEqual(
    firstTasks.map((row) => row.id),
    tasks
      .map((row) => row.id)
      .sort((left, right) => right - left)
      .slice(0, 2),
  );
  const taskCursor = firstTasksResponse.headers.get("x-next-before-id");
  assert.equal(taskCursor, String(firstTasks[1]?.id));

  const olderTasksResponse = await fetch(
    `${baseUrl}/tasks?ownerAgentId=${agent.id}&limit=2&beforeId=${taskCursor}`,
  );
  assert.equal(olderTasksResponse.status, 200);
  const olderTasks = (await olderTasksResponse.json()) as Array<{ id: number }>;
  assert.deepEqual(
    olderTasks.map((row) => row.id),
    [tasks[0]?.id],
  );
  assert.equal(olderTasksResponse.headers.get("x-next-before-id"), null);

  const messageResponse = await fetch(
    `${baseUrl}/agents/${agent.id}/messages?limit=2`,
  );
  assert.equal(messageResponse.status, 200);
  const latestMessages = (await messageResponse.json()) as Array<{
    id: number;
    content: string;
  }>;
  assert.deepEqual(
    latestMessages.map((row) => row.id),
    [messages[1]?.id, messages[2]?.id],
    "the latest page remains chronological for chat rendering",
  );
  assert.equal(
    messageResponse.headers.get("x-next-before-id"),
    String(messages[1]?.id),
  );

  const invalidStatus = await fetch(`${baseUrl}/tasks?status=made_up`);
  assert.equal(invalidStatus.status, 400);
  assert.match(await invalidStatus.text(), /status must be one of/i);

  const invalidLimit = await fetch(`${baseUrl}/tasks?limit=999999`);
  assert.equal(invalidLimit.status, 400);
  assert.match(await invalidLimit.text(), /limit must be at most/i);

  const invalidPath = await fetch(`${baseUrl}/tasks/0`);
  assert.equal(invalidPath.status, 400);
  assert.match(await invalidPath.text(), /positive integer/i);
});

for (const kind of ["global", "task"] as const) {
  test(`${kind} activity pagination preserves skewed timestamps, scope and a concurrent insert`, async (t) => {
    await dbReady;
    const agents = await db
      .insert(agentsTable)
      .values(
        ["selected", "unrelated"].map((name) => ({
          name: `Activity pagination ${kind} ${name}`,
          role: "Test",
          systemPrompt: "Test only",
          createdByUser: true,
        })),
      )
      .returning();
    const [agent, otherAgent] = agents;
    const tasks = await db
      .insert(tasksTable)
      .values(
        ["selected", "unrelated"].map((title) => ({
          title: `Activity pagination ${kind} ${title}`,
          brief: "Cursor regression",
          ownerAgentId: agent.id,
          createdByUser: true,
        })),
      )
      .returning();
    const [task, otherTask] = tasks;
    t.after(async () => {
      await db.delete(activityEventsTable).where(
        inArray(
          activityEventsTable.agentId,
          agents.map((a) => a.id),
        ),
      );
      await db.delete(tasksTable).where(
        inArray(
          tasksTable.id,
          tasks.map((t) => t.id),
        ),
      );
      await db.delete(agentsTable).where(
        inArray(
          agentsTable.id,
          agents.map((a) => a.id),
        ),
      );
    });

    const values = {
      agentId: agent.id,
      taskId: task.id,
      type: "note",
      severity: "warning",
    };
    const events = await db
      .insert(activityEventsTable)
      .values(
        [3, 1, 2].map((day) => ({
          ...values,
          summary: `Original record ${day}`,
          createdAt: new Date(`2026-09-0${day}T10:00:00Z`),
        })),
      )
      .returning();
    await db.insert(activityEventsTable).values({
      ...values,
      taskId: otherTask.id,
      summary: "Different task",
    });
    if (kind === "global") {
      await db.insert(activityEventsTable).values([
        { ...values, agentId: otherAgent.id, summary: "Different agent" },
        { ...values, severity: "info", summary: "Different severity" },
      ]);
    }

    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    t.after(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const route =
      kind === "global"
        ? `/activity?agentId=${agent.id}&taskId=${task.id}&severity=warning&limit=2`
        : `/tasks/${task.id}/activity?limit=2`;
    const baseUrl = `http://127.0.0.1:${address.port}/api${route}`;
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let insertedId: number | undefined;
    do {
      const response = await fetch(
        `${baseUrl}${cursor ? `&beforeId=${cursor}` : ""}`,
      );
      assert.equal(response.status, 200);
      const rows = (await response.json()) as Array<{
        id: number;
        taskId: number;
        summary: string;
        createdAt: string;
      }>;
      assert.ok(rows.length <= 2);
      for (const row of rows) {
        const original = events.find((event) => event.id === row.id);
        assert.ok(
          original,
          "other scopes and later inserts stay outside this traversal",
        );
        assert.equal(row.taskId, task.id);
        assert.equal(row.summary, original.summary);
        assert.equal(Date.parse(row.createdAt), original.createdAt.getTime());
      }
      const pageIds = rows.map((row) => row.id);
      if (kind === "task") {
        assert.deepEqual(
          pageIds,
          [...pageIds].sort((a, b) => a - b),
          "task activity retains its existing chronological page body",
        );
        seen.push(...pageIds.reverse());
      } else {
        seen.push(...pageIds);
      }
      cursor = response.headers.get("X-Next-Before-Id");
      if (cursor !== null)
        assert.equal(cursor, String(Math.min(...rows.map((row) => row.id))));
      if (pages === 0) {
        const [inserted] = await db
          .insert(activityEventsTable)
          .values({
            ...values,
            summary: "Arrived later with an older timestamp",
            createdAt: new Date("2026-08-01T10:00:00Z"),
          })
          .returning();
        insertedId = inserted.id;
      }
      assert.ok(++pages <= 3, "cursor must terminate");
    } while (cursor !== null);
    assert.deepEqual(
      [...seen].sort((a, b) => a - b),
      events.map((event) => event.id),
      "every original row remains reachable exactly once",
    );
    assert.deepEqual(
      seen,
      events.map((event) => event.id).reverse(),
      "integer cursor follows record sequence, independently of event time",
    );

    const latestResponse = await fetch(baseUrl);
    assert.equal(latestResponse.status, 200);
    const latest = (await latestResponse.json()) as Array<{ id: number }>;
    assert.equal(
      (kind === "task" ? latest.at(-1) : latest[0])?.id,
      insertedId,
      "returning to latest exposes the new arrival",
    );
    const [stored] = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.id, events[0].id));
    assert.equal(
      stored?.createdAt.getTime(),
      events[0].createdAt.getTime(),
      "pagination must not rewrite event timestamps",
    );
  });
}
