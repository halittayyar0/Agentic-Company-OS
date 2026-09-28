import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  projectMembersTable,
  tasksTable,
} from "@workspace/db";
import app from "../app";

test("new root projects enroll the complete active workforce and preserve the legacy coordinator override", async (t) => {
  await dbReady;
  const marker = randomUUID();
  const insertedAgents = await db
    .insert(agentsTable)
    .values([
      {
        name: `Structural root ${marker}`,
        role: "Portfolio lead",
        depth: 0,
        parentAgentId: null,
        systemPrompt: "Test only.",
        createdByUser: true,
      },
      {
        name: `Active specialist ${marker}`,
        role: "Delivery specialist",
        depth: 1,
        systemPrompt: "Test only.",
        createdByUser: true,
      },
      {
        name: `Inactive specialist ${marker}`,
        role: "Archived specialist",
        status: "archived",
        isActive: false,
        depth: 1,
        systemPrompt: "Test only.",
        createdByUser: true,
      },
    ])
    .returning();
  const structuralRoot = insertedAgents[0]!;
  const legacyCoordinator = insertedAgents[1]!;
  const inactiveAgent = insertedAgents[2]!;
  const createdTaskIds: number[] = [];

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const api = `http://127.0.0.1:${address.port}/api`;
  const request = (path: string, method = "GET", body?: unknown) =>
    fetch(`${api}${path}`, {
      method,
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (createdTaskIds.length > 0) {
      await db.delete(tasksTable).where(inArray(tasksTable.id, createdTaskIds));
    }
    await db.delete(agentsTable).where(
      inArray(
        agentsTable.id,
        insertedAgents.map((agent) => agent.id),
      ),
    );
  });

  const activeSnapshot = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.isActive, true))
    .orderBy(agentsTable.id);
  const expectedCoordinator =
    activeSnapshot.find((agent) => agent.isRootCeo) ??
    activeSnapshot.find(
      (agent) => agent.parentAgentId === null && agent.depth === 0,
    ) ??
    activeSnapshot[0]!;
  assert.ok(activeSnapshot.some((agent) => agent.id === structuralRoot.id));
  assert.ok(!activeSnapshot.some((agent) => agent.id === inactiveAgent.id));

  const defaultCreate = await request("/tasks", "POST", {
    title: `Team-first project ${marker}`,
    brief: "No individual owner is selected by the operator.",
  });
  const defaultCreateText = await defaultCreate.text();
  assert.equal(defaultCreate.status, 201, defaultCreateText);
  const defaultProject = JSON.parse(defaultCreateText) as Record<
    string,
    unknown
  >;
  const defaultProjectId = Number(defaultProject.id);
  createdTaskIds.push(defaultProjectId);
  assert.equal(defaultProject.ownerAgentId, expectedCoordinator.id);

  const defaultMembersResponse = await request(
    `/tasks/${defaultProjectId}/members`,
  );
  assert.equal(defaultMembersResponse.status, 200);
  const defaultMembers = (await defaultMembersResponse.json()) as Array<{
    taskId: number;
    agentId: number;
    membershipRole: string;
    addedAt: string;
    agent: {
      id: number;
      name: string;
      role: string;
      status: string;
      isActive: boolean;
    };
  }>;
  assert.deepEqual(
    defaultMembers.map((member) => member.agentId).sort((a, b) => a - b),
    activeSnapshot.map((agent) => agent.id),
  );
  assert.ok(
    defaultMembers.every(
      (member) =>
        member.taskId === defaultProjectId &&
        member.agentId === member.agent.id &&
        member.agent.isActive &&
        member.agent.name.length > 0 &&
        member.agent.role.length > 0 &&
        member.agent.status !== "archived" &&
        Date.parse(member.addedAt) > 0,
    ),
  );
  assert.equal(
    defaultMembers.filter((member) => member.membershipRole === "coordinator")
      .length,
    1,
  );
  assert.equal(defaultMembers[0]!.agentId, expectedCoordinator.id);
  assert.equal(defaultMembers[0]!.membershipRole, "coordinator");
  assert.ok(
    !defaultMembers.some((member) => member.agentId === inactiveAgent.id),
  );

  const legacyCreate = await request("/tasks", "POST", {
    title: `Legacy coordinator project ${marker}`,
    brief: "The compatibility field chooses only the coordinator.",
    ownerAgentId: legacyCoordinator.id,
  });
  const legacyCreateText = await legacyCreate.text();
  assert.equal(legacyCreate.status, 201, legacyCreateText);
  const legacyProject = JSON.parse(legacyCreateText) as Record<string, unknown>;
  const legacyProjectId = Number(legacyProject.id);
  createdTaskIds.push(legacyProjectId);
  assert.equal(legacyProject.ownerAgentId, legacyCoordinator.id);

  const legacyMembersResponse = await request(
    `/tasks/${legacyProjectId}/members`,
  );
  assert.equal(legacyMembersResponse.status, 200);
  const legacyMembers = (await legacyMembersResponse.json()) as Array<{
    taskId: number;
    agentId: number;
    membershipRole: string;
  }>;
  assert.deepEqual(
    legacyMembers.map((member) => member.agentId).sort((a, b) => a - b),
    activeSnapshot.map((agent) => agent.id),
  );
  assert.ok(
    legacyMembers.every((member) => member.taskId === legacyProjectId),
    "a project roster must never contain membership rows from another project",
  );
  assert.deepEqual(
    legacyMembers
      .filter((member) => member.membershipRole === "coordinator")
      .map(({ taskId, agentId, membershipRole }) => ({
        taskId,
        agentId,
        membershipRole,
      })),
    [
      {
        taskId: legacyProjectId,
        agentId: legacyCoordinator.id,
        membershipRole: "coordinator",
      },
    ],
  );

  const inactiveOverride = await request("/tasks", "POST", {
    title: `Rejected inactive owner ${marker}`,
    brief: "An inactive compatibility override must fail closed.",
    ownerAgentId: inactiveAgent.id,
  });
  assert.equal(inactiveOverride.status, 400);
  assert.match(await inactiveOverride.text(), /inactive/i);

  const [childTask] = await db
    .insert(tasksTable)
    .values({
      title: `Child task ${marker}`,
      brief: "This is not a project and must not expose a project roster.",
      ownerAgentId: legacyCoordinator.id,
      parentTaskId: defaultProjectId,
      createdByUser: true,
    })
    .returning();
  createdTaskIds.push(childTask.id);
  const childRoster = await request(`/tasks/${childTask.id}/members`);
  assert.equal(childRoster.status, 409);
  assert.match(await childRoster.text(), /root project/i);

  const missingRoster = await request("/tasks/2147483647/members");
  assert.equal(missingRoster.status, 404);

  const storedCoordinator = await db
    .select()
    .from(projectMembersTable)
    .where(eq(projectMembersTable.taskId, defaultProjectId));
  assert.equal(
    storedCoordinator.filter((member) => member.memberRole === "coordinator")
      .length,
    1,
  );
});
