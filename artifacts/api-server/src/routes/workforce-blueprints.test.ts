import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  activityEventsTable,
  agentsTable,
  db,
  dbReady,
  tasksTable,
  workforceInstallationsTable,
  runtimeControlsTable,
} from "@workspace/db";
import { managerPermissionsPreset } from "../lib/orchestrator/permission-presets";
import { WORKFORCE_BLUEPRINTS } from "../lib/workforce-blueprints";
import { localizeWorkforceBlueprint } from "../lib/workforce-localization";
import { WORKSPACE_LOCALES } from "../lib/workspace-locale";
import workforceBlueprintRouter from "./workforce-blueprints";

function request(
  port: number,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers:
          payload === undefined
            ? undefined
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              },
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (responseBody += chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: responseBody ? (JSON.parse(responseBody) as unknown) : null,
          });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function listen() {
  const app = express();
  app.use(express.json());
  app.use("/api", workforceBlueprintRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, port: address.port };
}

test("workforce catalogue is authored, hierarchical, and excludes CEO/sudo templates", async (t) => {
  await dbReady;
  const { server, port } = await listen();
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const response = await request(port, "GET", "/api/workforce-blueprints");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, WORKFORCE_BLUEPRINTS);
  for (const locale of WORKSPACE_LOCALES) {
    const translated = await request(
      port,
      "GET",
      "/api/workforce-blueprints?locale=" + locale,
    );
    assert.equal(translated.status, 200);
    assert.deepEqual(
      translated.body,
      WORKFORCE_BLUEPRINTS.map((blueprint) =>
        localizeWorkforceBlueprint(blueprint, locale),
      ),
    );
  }
  assert.equal(
    (await request(port, "GET", "/api/workforce-blueprints?locale=xx")).status,
    400,
  );
  assert.equal(
    (
      await request(
        port,
        "GET",
        "/api/workforce-blueprints?locale=en&locale=ar",
      )
    ).status,
    400,
  );

  for (const blueprint of WORKFORCE_BLUEPRINTS) {
    assert.equal(
      blueprint.members.filter((member) => member.reportsToKey === null).length,
      1,
    );
    assert.ok(blueprint.handoffs.length > 0);
    assert.ok(
      blueprint.members.every((member) => member.templateKey !== "ceo"),
    );
  }
});

test("install atomically creates a safe hierarchy, root task, and audit evidence", async (t) => {
  await dbReady;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const [manager] = await db
    .insert(agentsTable)
    .values({
      name: `Blueprint manager ${suffix}`,
      role: "Blueprint test manager",
      systemPrompt: "Test only",
      permissions: managerPermissionsPreset,
      createdByUser: true,
    })
    .returning();
  const createdAgentIds: number[] = [];
  let createdTaskId: number | null = null;
  t.after(async () => {
    if (createdTaskId !== null) {
      await db
        .delete(activityEventsTable)
        .where(eq(activityEventsTable.taskId, createdTaskId));
      await db.delete(tasksTable).where(eq(tasksTable.id, createdTaskId));
    }
    if (createdAgentIds.length > 0) {
      await db
        .delete(activityEventsTable)
        .where(
          inArray(activityEventsTable.agentId, [
            manager.id,
            ...createdAgentIds,
          ]),
        );
      await db
        .delete(agentsTable)
        .where(inArray(agentsTable.id, createdAgentIds));
    }
    await db.delete(agentsTable).where(eq(agentsTable.id, manager.id));
  });

  const { server, port } = await listen();
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const blueprint = WORKFORCE_BLUEPRINTS[0];
  const response = await request(
    port,
    "POST",
    `/api/workforce-blueprints/${blueprint.key}/install`,
    {
      managerAgentId: manager.id,
      outcome: "Doğrulanmış kabul kriterleriyle örnek ürünü teslim et.",
      autonomyMode: "continuous",
      cadenceSeconds: 600,
    },
  );
  assert.equal(response.status, 201);
  assert.ok(response.body && typeof response.body === "object");
  const installed = response.body as {
    blueprintKey: string;
    version: number;
    agents: Array<Record<string, unknown>>;
    task: Record<string, unknown> | null;
  };
  assert.equal(installed.blueprintKey, blueprint.key);
  assert.equal(installed.version, blueprint.version);
  assert.equal(installed.agents.length, blueprint.members.length);
  assert.ok(installed.task);
  assert.ok(
    installed.agents.every(
      (agent) => !("isRootCeo" in agent) && !("runLeaseOwner" in agent),
    ),
  );
  assert.ok(!("leaseOwner" in installed.task!));

  createdAgentIds.push(...installed.agents.map((agent) => Number(agent.id)));
  createdTaskId = Number(installed.task!.id);

  const persistedAgents = await db
    .select()
    .from(agentsTable)
    .where(inArray(agentsTable.id, createdAgentIds));
  assert.equal(persistedAgents.length, blueprint.members.length);
  assert.ok(persistedAgents.every((agent) => agent.isRootCeo === false));
  assert.ok(
    persistedAgents.every((agent) => agent.permissions.canUseSudo === false),
  );
  assert.ok(
    persistedAgents.every((agent) =>
      agent.systemPrompt.includes("Hazır ekip çalışma sözleşmesi"),
    ),
  );
  assert.ok(
    persistedAgents.some((agent) =>
      agent.systemPrompt.includes("Giden devir sözleşmesi"),
    ),
  );
  assert.ok(
    persistedAgents.some((agent) =>
      agent.systemPrompt.includes("Gelen kabul sözleşmesi"),
    ),
  );

  const rootMember = blueprint.members.find(
    (member) => member.reportsToKey === null,
  )!;
  const rootAgent = installed.agents.find(
    (agent) => agent.role === rootMember.role,
  )!;
  assert.equal(rootAgent.parentAgentId, manager.id);
  for (const member of blueprint.members.filter(
    (candidate) => candidate.reportsToKey !== null,
  )) {
    const child = installed.agents.find((agent) => agent.role === member.role)!;
    const parentMember = blueprint.members.find(
      (candidate) => candidate.key === member.reportsToKey,
    )!;
    const parent = installed.agents.find(
      (agent) => agent.role === parentMember.role,
    )!;
    assert.equal(child.parentAgentId, parent.id);
  }

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, createdTaskId));
  assert.equal(task.ownerAgentId, Number(rootAgent.id));
  assert.equal(task.assignedByAgentId, manager.id);
  assert.equal(task.autonomyMode, "continuous");
  assert.equal(task.cadenceSeconds, 600);

  const events = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.taskId, createdTaskId));
  assert.equal(
    events.filter((event) => event.type === "subagent_created").length,
    blueprint.members.length,
  );
  assert.equal(
    events.filter((event) => event.type === "task_created").length,
    1,
  );

  const noTaskResponse = await request(
    port,
    "POST",
    `/api/workforce-blueprints/${WORKFORCE_BLUEPRINTS[1].key}/install`,
    { managerAgentId: manager.id },
  );
  assert.equal(noTaskResponse.status, 201);
  assert.ok(noTaskResponse.body && typeof noTaskResponse.body === "object");
  const installedWithoutTask = noTaskResponse.body as {
    agents: Array<Record<string, unknown>>;
    task: Record<string, unknown> | null;
  };
  assert.equal(installedWithoutTask.task, null);
  createdAgentIds.push(
    ...installedWithoutTask.agents.map((agent) => Number(agent.id)),
  );
});

test("install rejects invalid authority and cadence without creating agents", async (t) => {
  await dbReady;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const [manager] = await db
    .insert(agentsTable)
    .values({
      name: `Restricted manager ${suffix}`,
      role: "Restricted manager",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  t.after(async () => {
    await db.delete(agentsTable).where(eq(agentsTable.id, manager.id));
  });

  const { server, port } = await listen();
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const blueprint = WORKFORCE_BLUEPRINTS[0];

  const denied = await request(
    port,
    "POST",
    `/api/workforce-blueprints/${blueprint.key}/install`,
    { managerAgentId: manager.id },
  );
  assert.equal(denied.status, 403);

  const invalidCadence = await request(
    port,
    "POST",
    `/api/workforce-blueprints/${blueprint.key}/install`,
    {
      managerAgentId: manager.id,
      outcome: "Invalid cadence must fail before authorization.",
      autonomyMode: "continuous",
      cadenceSeconds: 30,
    },
  );
  assert.equal(invalidCadence.status, 400);

  const children = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.parentAgentId, manager.id));
  assert.equal(children.length, 0);
});

test("installation retries replay the durable result without recreating a team, including after stop or manager changes", async (t) => {
  await dbReady;
  const [manager] = await db
    .insert(agentsTable)
    .values({
      name: "Idempotent team manager",
      role: "Test manager",
      systemPrompt: "Test only",
      permissions: managerPermissionsPreset,
      createdByUser: true,
    })
    .returning();
  const requestId = randomUUID();
  const { server, port } = await listen();
  const ids = [manager.id];
  let taskId: number | undefined;
  t.after(async () => {
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: false })
      .where(eq(runtimeControlsTable.id, 1));
    await db
      .delete(workforceInstallationsTable)
      .where(eq(workforceInstallationsTable.requestId, requestId));
    await db
      .delete(activityEventsTable)
      .where(inArray(activityEventsTable.agentId, ids));
    if (taskId) await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
    await db.delete(agentsTable).where(inArray(agentsTable.id, ids));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const blueprint = WORKFORCE_BLUEPRINTS[0];
  const url = `/api/workforce-blueprints/${blueprint.key}/install`;
  const input = {
    requestId,
    blueprintVersion: blueprint.version,
    managerAgentId: manager.id,
    outcome: "Preserve the same installation across retries.",
    locale: "ar",
  };
  const [first, simultaneous] = await Promise.all([
    request(port, "POST", url, input),
    request(port, "POST", url, input),
  ]);
  assert.deepEqual(simultaneous, first);
  assert.equal(first.status, 201);
  const body = first.body as {
    agents: Array<{
      id: number;
      name: string;
      role: string;
      systemPrompt: string;
    }>;
    task: { id: number };
  };
  ids.push(...body.agents.map((agent) => agent.id));
  taskId = body.task.id;
  const translated = localizeWorkforceBlueprint(blueprint, "ar");
  for (const [index, agent] of body.agents.entries()) {
    assert.equal(agent.name, translated.members[index].name);
    assert.equal(agent.role, translated.members[index].role);
    assert.ok(agent.systemPrompt.includes(translated.members[index].mission));
    assert.ok(agent.systemPrompt.includes('<workspace_language locale="ar">'));
    assert.ok(
      !agent.systemPrompt.includes("Misyonun:"),
      "installed role instructions must use the requested locale",
    );
    assert.ok(
      !agent.systemPrompt.includes("Hazır ekip çalışma sözleşmesi"),
      "installed handoff contract must use the requested locale",
    );
  }
  const retries = await Promise.all([
    request(port, "POST", url, input),
    request(port, "POST", url, input),
  ]);
  for (const replay of retries) assert.deepEqual(replay, first);
  const conflict = await request(port, "POST", url, {
    ...input,
    outcome: "A different installation must not reuse the ID.",
  });
  assert.equal(conflict.status, 409);
  assert.equal(
    (await request(port, "POST", url, { ...input, locale: "en" })).status,
    409,
  );
  assert.equal(
    (conflict.body as { code: string }).code,
    "WORKFORCE_INSTALLATION_REQUEST_CONFLICT",
  );
  await db
    .update(agentsTable)
    .set({ isActive: false })
    .where(eq(agentsTable.id, manager.id));
  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: true })
    .where(eq(runtimeControlsTable.id, 1));
  assert.deepEqual(await request(port, "POST", url, input), first);
  const blocked = await request(port, "POST", url, {
    ...input,
    requestId: randomUUID(),
  });
  assert.equal(blocked.status, 423);
  const receipts = await db
    .select()
    .from(workforceInstallationsTable)
    .where(eq(workforceInstallationsTable.requestId, requestId));
  assert.equal(receipts.length, 1);
  assert.deepEqual(receipts[0].response, first.body);
  const roots = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.parentAgentId, manager.id));
  assert.equal(roots.length, 1);
});

test("installation rejects a changed blueprint version and malformed retry IDs before creating a team", async (t) => {
  await dbReady;
  const [manager] = await db
    .insert(agentsTable)
    .values({
      name: "Version-check manager",
      role: "Test manager",
      systemPrompt: "Test only",
      permissions: managerPermissionsPreset,
      createdByUser: true,
    })
    .returning();
  const { server, port } = await listen();
  t.after(async () => {
    await db.delete(agentsTable).where(eq(agentsTable.id, manager.id));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const url = `/api/workforce-blueprints/${WORKFORCE_BLUEPRINTS[0].key}/install`;
  const changed = await request(port, "POST", url, {
    managerAgentId: manager.id,
    requestId: randomUUID(),
    blueprintVersion: 999,
  });
  assert.equal(changed.status, 409);
  assert.equal(
    (changed.body as { code: string }).code,
    "WORKFORCE_BLUEPRINT_VERSION_CHANGED",
  );
  assert.equal(
    (
      await request(port, "POST", url, {
        managerAgentId: manager.id,
        requestId: "not-a-uuid",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.parentAgentId, manager.id))
    ).length,
    0,
  );
});
