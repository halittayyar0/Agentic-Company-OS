import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  tasksTable,
  db,
  dbReady,
  closeDatabase,
} from "@workspace/db";
import router from "./agents";
import { agentConfigVersion } from "../lib/agent-config-version";

test("expert settings fence stale edits and avatars, preserve runtime progress, and restore within capacity", async (t) => {
  await dbReady;
  const previousLimit = process.env.MAX_ACTIVE_AGENTS;
  const [agent, peer] = await db
    .insert(agentsTable)
    .values([
      {
        name: "Reviewed expert",
        role: "Research",
        systemPrompt: "Original instruction",
        createdByUser: true,
      },
      {
        name: "Peer",
        role: "Research",
        systemPrompt: "Peer instruction",
        createdByUser: true,
      },
    ])
    .returning();
  assert.ok(agent && peer);
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/agents/${agent.id}`;
  t.after(async () => {
    if (previousLimit === undefined) delete process.env.MAX_ACTIVE_AGENTS;
    else process.env.MAX_ACTIVE_AGENTS = previousLimit;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase();
  });
  async function request(method = "GET", body?: unknown, suffix = "") {
    const response = await fetch(url + suffix, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  }
  const first = await request();
  assert.equal(first.body.configVersion, agentConfigVersion(agent));
  assert.equal(first.body.isRootCeo, false);
  await db
    .update(agentsTable)
    .set({
      status: "working",
      currentAction: "Progress only",
      lastActiveAt: new Date(),
    })
    .where(eq(agentsTable.id, agent.id));
  assert.equal((await request()).body.configVersion, first.body.configVersion);
  assert.equal(
    (
      await request("PATCH", {
        modelMode: "manual",
        expectedConfig: first.body.configVersion,
      })
    ).body.code,
    "AGENT_MODEL_INVALID",
  );
  assert.equal(
    (await request("PATCH", { expectedConfig: first.body.configVersion }))
      .status,
    400,
  );
  const race = await Promise.all([
    request("PATCH", {
      systemPrompt: "First reviewed instruction",
      expectedConfig: first.body.configVersion,
    }),
    request("PATCH", {
      systemPrompt: "Second reviewed instruction",
      expectedConfig: first.body.configVersion,
    }),
  ]);
  assert.deepEqual(race.map((result) => result.status).sort(), [200, 409]);
  let current = (await request()).body;
  assert.equal(current.isCustomPrompt, true);
  assert.notEqual(current.configVersion, first.body.configVersion);
  for (const patch of [
    { permissions: { ...current.permissions, canBrowse: false } },
    { isActive: false },
    { parentAgentId: peer.id },
  ]) {
    const stale = await request("PATCH", {
      ...patch,
      expectedConfig: first.body.configVersion,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "AGENT_CONFIG_CHANGED");
  }
  assert.equal((await request()).body.isActive, true);
  assert.equal((await request()).body.parentAgentId, null);
  const manual = await request("PATCH", {
    modelMode: "manual",
    modelId: "openai:test-only-model",
    expectedConfig: current.configVersion,
  });
  assert.equal(manual.status, 200);
  const blankModel = await request("PATCH", {
    modelId: "   ",
    expectedConfig: manual.body.configVersion,
  });
  assert.equal(blankModel.status, 400);
  assert.equal((await request()).body.modelId, "openai:test-only-model");
  const auto = await request("PATCH", {
    modelMode: "auto",
    expectedConfig: manual.body.configVersion,
  });
  assert.equal(auto.body.modelId, null);
  current = auto.body;
  await db
    .update(agentsTable)
    .set({ runLeaseOwner: "running-owner" })
    .where(eq(agentsTable.id, agent.id));
  const busy = await request("PATCH", {
    permissions: { ...current.permissions, canBrowse: false },
    expectedConfig: current.configVersion,
  });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, "AGENT_PERMISSION_IN_FLIGHT");
  assert.equal(
    (await request()).body.permissions.canBrowse,
    current.permissions.canBrowse,
  );
  await db
    .update(agentsTable)
    .set({ runLeaseOwner: null })
    .where(eq(agentsTable.id, agent.id));
  const image =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lL8AAAAASUVORK5CYII=";
  const portraits = await Promise.all([
    request(
      "PUT",
      { dataUrl: image, expectedConfig: current.configVersion },
      "/avatar",
    ),
    request(
      "PUT",
      { dataUrl: image, expectedConfig: current.configVersion },
      "/avatar",
    ),
  ]);
  assert.deepEqual(portraits.map((result) => result.status).sort(), [200, 409]);
  const portrait = (await request()).body;
  assert.ok(portrait.avatarVersion);
  const staleReset = await request(
    "DELETE",
    undefined,
    "/avatar?expectedConfig=" + current.configVersion,
  );
  assert.equal(staleReset.status, 409);
  assert.equal((await request()).body.avatarVersion, portrait.avatarVersion);
  const reset = await request(
    "DELETE",
    undefined,
    "/avatar?expectedConfig=" + portrait.configVersion,
  );
  assert.equal(reset.status, 200);
  assert.equal(reset.body.avatarVersion, null);
  current = reset.body;
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: "Existing task",
      brief: "Preserve blocked work",
      ownerAgentId: agent.id,
      status: "pending",
    })
    .returning();
  const archived = await request("PATCH", {
    isActive: false,
    expectedConfig: current.configVersion,
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.status, "archived");
  process.env.MAX_ACTIVE_AGENTS = "1";
  const overCapacity = await request("PATCH", {
    isActive: true,
    expectedConfig: archived.body.configVersion,
  });
  assert.equal(overCapacity.status, 429);
  assert.equal(overCapacity.body.code, "RUNTIME_CAPACITY_EXCEEDED");
  assert.equal((await request()).body.isActive, false);
  process.env.MAX_ACTIVE_AGENTS = "2";
  const restored = await request("PATCH", {
    isActive: true,
    expectedConfig: archived.body.configVersion,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.isActive, true);
  assert.equal(restored.body.status, "idle");
  assert.equal(restored.body.currentAction, null);
  assert.equal(
    (
      await request("PATCH", {
        isActive: true,
        expectedConfig: restored.body.configVersion,
      })
    ).status,
    200,
  );
  const [preserved] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, task.id));
  assert.equal(preserved.status, "blocked");
  assert.equal(preserved.blockedReason, "owner_inactive");
});
