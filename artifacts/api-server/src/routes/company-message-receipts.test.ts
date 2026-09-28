import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  dbReady,
  agentsTable,
  companyChannelsTable,
  companyChannelMembersTable,
  companyMessagesTable,
  companyMessageRequestsTable,
  runtimeControlsTable,
} from "@workspace/db";
import { createCompanyChatRouter } from "./company-chat";
import { buildChatSystemPrompt } from "../lib/orchestrator/system-prompt";
import { WORKSPACE_LOCALES } from "../lib/workspace-locale";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a persisted send identity recovers during a pending round, after stop and member removal, without a second dispatch", async (t) => {
  await dbReady;
  const entered = deferred();
  const release = deferred();
  let dispatches = 0;
  const requestId = randomUUID();
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: "Receipt member", role: "Test", systemPrompt: "Test only" })
    .returning();
  await db
    .insert(companyChannelsTable)
    .values({ key: "company", name: "Test room" })
    .onConflictDoNothing();
  const [channel] = await db
    .select()
    .from(companyChannelsTable)
    .where(eq(companyChannelsTable.key, "company"));
  await db
    .insert(companyChannelMembersTable)
    .values({ channelId: channel.id, agentId: agent.id });
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createCompanyChatRouter({
      runTurn: async (params) => {
        dispatches++;
        assert.equal(params.locale, "zh-TW");
        entered.resolve();
        await release.promise;
        return { message: null, skipReason: "busy" };
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const body = {
    requestId,
    locale: "zh-TW",
    content: "Original 原文",
    mentionedAgentIds: [agent.id],
  };
  const post = async (data: unknown) => {
    const response = await fetch(`${base}/api/company-chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  };
  t.after(async () => {
    release.resolve();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: false })
      .where(eq(runtimeControlsTable.id, 1));
    const receipts = await db
      .select()
      .from(companyMessageRequestsTable)
      .where(eq(companyMessageRequestsTable.requestId, requestId));
    await db
      .delete(companyMessageRequestsTable)
      .where(eq(companyMessageRequestsTable.requestId, requestId));
    const ids = receipts.map((row) =>
      Number((row.response.founderMessage as { id: number }).id),
    );
    if (ids.length)
      await db
        .delete(companyMessagesTable)
        .where(inArray(companyMessagesTable.id, ids));
    await db
      .delete(companyChannelMembersTable)
      .where(eq(companyChannelMembersTable.agentId, agent.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  const first = post(body);
  await entered.promise;
  try {
    const replay = await post(body);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.deliveryState, "unconfirmed");
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.founderMessage.content, body.content);
    assert.equal(dispatches, 1);
    const conflict = await post({ ...body, content: "Different intent" });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, "COMPANY_REQUEST_CONFLICT");
    await db
      .delete(companyChannelMembersTable)
      .where(eq(companyChannelMembersTable.agentId, agent.id));
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: true })
      .where(eq(runtimeControlsTable.id, 1));
    const recovery = await post(body);
    assert.equal(recovery.status, 200);
    assert.equal(
      recovery.body.founderMessage.id,
      replay.body.founderMessage.id,
    );
    const stopped = await post({
      ...body,
      requestId: randomUUID(),
      mentionedAgentIds: [],
    });
    assert.equal(stopped.status, 423);
    assert.equal(stopped.body.code, "EMERGENCY_STOP_ACTIVE");
  } finally {
    release.resolve();
  }
  const completed = await first;
  assert.equal(completed.status, 201);
  assert.equal(completed.body.deliveryState, "complete");
  assert.equal(completed.body.replayed, false);
  const final = await post(body);
  assert.deepEqual(final.body, { ...completed.body, replayed: true });
  assert.equal(dispatches, 1);
  assert.equal(
    (
      await db
        .select()
        .from(companyMessagesTable)
        .where(eq(companyMessagesTable.content, body.content))
    ).length,
    1,
  );
  for (const locale of WORKSPACE_LOCALES) {
    const prompt = await buildChatSystemPrompt(agent, undefined, locale);
    assert.match(prompt, new RegExp(`<workspace_language locale="${locale}">`));
    assert.equal((prompt.match(/<workspace_language /g) ?? []).length, 1);
  }
});
