import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { inArray } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  db,
  dbReady,
  tasksTable,
} from "@workspace/db";
import app from "../app";

function request(
  port: number,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/api/tasks",
        headers: {
          Host: `127.0.0.1:${port}`,
          Origin: `http://127.0.0.1:${port}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (responseBody += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: responseBody
              ? (JSON.parse(responseBody) as Record<string, unknown>)
              : {},
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

test("user-created top-level tasks preserve the owner's real command manager", async (t) => {
  await dbReady;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const [manager] = await db
    .insert(agentsTable)
    .values({
      name: `Task manager ${suffix}`,
      role: "Test manager",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [employee] = await db
    .insert(agentsTable)
    .values({
      name: `Task employee ${suffix}`,
      role: "Test employee",
      parentAgentId: manager.id,
      depth: 1,
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [rootAgent] = await db
    .insert(agentsTable)
    .values({
      name: `Task root ${suffix}`,
      role: "Test root",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const agentIds = [manager.id, employee.id, rootAgent.id];
  const createdTaskIds: number[] = [];

  t.after(async () => {
    if (createdTaskIds.length > 0) {
      await db
        .delete(activityEventsTable)
        .where(inArray(activityEventsTable.taskId, createdTaskIds));
      await db.delete(tasksTable).where(inArray(tasksTable.id, createdTaskIds));
    }
    await db.delete(agentsTable).where(inArray(agentsTable.id, agentIds));
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const delegated = await request(address.port, {
    title: `Managed task ${suffix}`,
    brief: "Record the employee's manager as the real delegator.",
    ownerAgentId: employee.id,
  });
  assert.equal(delegated.status, 201);
  assert.equal(delegated.body.ownerAgentId, employee.id);
  assert.equal(delegated.body.assignedByAgentId, manager.id);
  assert.equal(delegated.body.createdByUser, true);
  assert.equal(delegated.body.parentTaskId, null);
  createdTaskIds.push(Number(delegated.body.id));

  const root = await request(address.port, {
    title: `Root task ${suffix}`,
    brief: "A root-owned task must not invent a delegating manager.",
    ownerAgentId: rootAgent.id,
  });
  assert.equal(root.status, 201);
  assert.equal(root.body.ownerAgentId, rootAgent.id);
  assert.equal(root.body.assignedByAgentId, null);
  assert.equal(root.body.createdByUser, true);
  assert.equal(root.body.parentTaskId, null);
  createdTaskIds.push(Number(root.body.id));
});
