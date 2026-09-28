import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  companyChannelMembersTable,
  companyChannelsTable,
  companyMessagesTable,
  db,
  dbReady,
} from "@workspace/db";
import app from "../app";
import { executeTool } from "../lib/orchestrator/execute-tool";
import { buildChatSystemPrompt } from "../lib/orchestrator/system-prompt";

async function companyChannelId(): Promise<number> {
  await db
    .insert(companyChannelsTable)
    .values({ key: "company", name: "Ortak Şirket Chat" })
    .onConflictDoNothing({ target: companyChannelsTable.key });
  const [channel] = await db
    .select({ id: companyChannelsTable.id })
    .from(companyChannelsTable)
    .where(eq(companyChannelsTable.key, "company"));
  assert.ok(channel);
  return channel.id;
}

test("post_company_message persists the real agent identity and rate-limits duplicate bursts", async (t) => {
  await dbReady;
  const marker = randomUUID();
  const firstContent = `tool-company-message-${marker}`;
  const secondContent = `tool-company-message-duplicate-${marker}`;
  const removedMemberContent = `tool-company-message-removed-${marker}`;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Company tool test ${marker}`,
      role: "Test Agent",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const channelId = await companyChannelId();
  await db
    .insert(companyChannelMembersTable)
    .values({ channelId, agentId: agent.id });

  t.after(async () => {
    await db
      .delete(companyMessagesTable)
      .where(eq(companyMessagesTable.senderAgentId, agent.id));
    await db
      .delete(companyChannelMembersTable)
      .where(eq(companyChannelMembersTable.agentId, agent.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });

  const first = await executeTool(
    { agent, taskId: null },
    "post_company_message",
    JSON.stringify({ content: firstContent }),
  );
  assert.equal(first.toolOutcome, "succeeded");
  assert.match(first.content, /messageId=\d+/);

  const persisted = await db
    .select()
    .from(companyMessagesTable)
    .where(eq(companyMessagesTable.content, firstContent));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]?.senderType, "agent");
  assert.equal(persisted[0]?.senderAgentId, agent.id);
  assert.equal(persisted[0]?.source, "agent_tool");
  assert.equal(persisted[0]?.taskId, null);

  const duplicate = await executeTool(
    { agent, taskId: null },
    "post_company_message",
    JSON.stringify({ content: secondContent }),
  );
  assert.equal(duplicate.toolOutcome, "rejected");
  assert.match(duplicate.content, /ENGELLENDİ/);
  assert.match(duplicate.content, /5 saniye/);

  const rejectedRows = await db
    .select({ id: companyMessagesTable.id })
    .from(companyMessagesTable)
    .where(eq(companyMessagesTable.content, secondContent));
  assert.equal(rejectedRows.length, 0);

  await db
    .delete(companyChannelMembersTable)
    .where(eq(companyChannelMembersTable.agentId, agent.id));
  const removedMemberPost = await executeTool(
    { agent, taskId: null },
    "post_company_message",
    JSON.stringify({ content: removedMemberContent }),
  );
  assert.equal(removedMemberPost.toolOutcome, "rejected");
  assert.match(removedMemberPost.content, /ENGELLENDİ/);
  assert.match(removedMemberPost.content, /üyesi değil/);
  const removedMemberRows = await db
    .select({ id: companyMessagesTable.id })
    .from(companyMessagesTable)
    .where(eq(companyMessagesTable.content, removedMemberContent));
  assert.deepEqual(removedMemberRows, []);
});

test("founder message persists even when ambient routing finds no contributor", async (t) => {
  await dbReady;
  const content = `founder-only-company-message-${randomUUID()}`;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  t.after(async () => {
    await db
      .delete(companyMessagesTable)
      .where(eq(companyMessagesTable.content, content));
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${baseUrl}/api/company-chat/messages`, {
    method: "POST",
    headers: {
      Origin: baseUrl,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content, participantAgentIds: [] }),
  });

  assert.equal(response.status, 201);
  const body = (await response.json()) as {
    founderMessage: {
      id: number;
      senderType: string;
      senderAgentId: number | null;
      senderName: string | null;
      source: string;
      content: string;
    };
    agentMessages: unknown[];
    skippedParticipants: unknown[];
    routing: {
      mode: string;
      evaluatedMemberCount: number;
      attemptedAgentCount: number;
      responseCount: number;
    };
  };
  assert.equal(body.founderMessage.senderType, "founder");
  assert.equal(body.founderMessage.senderAgentId, null);
  assert.equal(body.founderMessage.senderName, null);
  assert.equal(body.founderMessage.source, "operator");
  assert.equal(body.founderMessage.content, content);
  assert.deepEqual(body.agentMessages, []);
  assert.deepEqual(body.skippedParticipants, []);
  assert.equal(body.routing.mode, "relevance");
  assert.equal(body.routing.attemptedAgentCount, 0);
  assert.equal(body.routing.responseCount, 0);

  const persisted = await db
    .select()
    .from(companyMessagesTable)
    .where(eq(companyMessagesTable.content, content));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]?.id, body.founderMessage.id);
  assert.equal(persisted[0]?.senderAgentId, null);
});

test("Company Room membership endpoints are unbounded, idempotent, and active-only", async (t) => {
  await dbReady;
  const marker = randomUUID();
  const created = await db
    .insert(agentsTable)
    .values([
      {
        name: `Active room member ${marker}`,
        role: "Test Agent",
        systemPrompt: "Test only",
        createdByUser: true,
      },
      {
        name: `Inactive room member ${marker}`,
        role: "Test Agent",
        systemPrompt: "Test only",
        createdByUser: true,
        isActive: false,
      },
    ])
    .returning();
  const activeAgent = created[0]!;
  const inactiveAgent = created[1]!;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  t.after(async () => {
    await db
      .delete(companyChannelMembersTable)
      .where(eq(companyChannelMembersTable.agentId, activeAgent.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, activeAgent.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, inactiveAgent.id));
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = { Origin: baseUrl, "Content-Type": "application/json" };
  const firstAdd = await fetch(`${baseUrl}/api/company-chat/members`, {
    method: "POST",
    headers,
    body: JSON.stringify({ agentId: activeAgent.id }),
  });
  assert.equal(firstAdd.status, 201);
  const membership = (await firstAdd.json()) as {
    agentId: number;
    name: string;
    isActive: boolean;
  };
  assert.equal(membership.agentId, activeAgent.id);
  assert.equal(membership.name, activeAgent.name);
  assert.equal(membership.isActive, true);

  const secondAdd = await fetch(`${baseUrl}/api/company-chat/members`, {
    method: "POST",
    headers,
    body: JSON.stringify({ agentId: activeAgent.id }),
  });
  assert.equal(secondAdd.status, 200);

  const inactiveAdd = await fetch(`${baseUrl}/api/company-chat/members`, {
    method: "POST",
    headers,
    body: JSON.stringify({ agentId: inactiveAgent.id }),
  });
  assert.equal(inactiveAdd.status, 409);

  const list = await fetch(`${baseUrl}/api/company-chat/members`);
  assert.equal(list.status, 200);
  const members = (await list.json()) as Array<{ agentId: number }>;
  assert.equal(
    members.filter((member) => member.agentId === activeAgent.id).length,
    1,
  );

  const remove = await fetch(
    `${baseUrl}/api/company-chat/members/${activeAgent.id}`,
    { method: "DELETE", headers: { Origin: baseUrl } },
  );
  assert.equal(remove.status, 204);
  const repeatRemove = await fetch(
    `${baseUrl}/api/company-chat/members/${activeAgent.id}`,
    { method: "DELETE", headers: { Origin: baseUrl } },
  );
  assert.equal(repeatRemove.status, 204);
});

test("explicit mention ids must resolve to active Company Room members", async (t) => {
  await dbReady;
  const marker = randomUUID();
  const content = `invalid-room-mention-${marker}`;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: `Room outsider ${marker}`,
      role: "Test Agent",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  t.after(async () => {
    await db
      .delete(companyMessagesTable)
      .where(eq(companyMessagesTable.content, content));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${baseUrl}/api/company-chat/messages`, {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ content, mentionedAgentIds: [agent.id] }),
  });
  assert.equal(response.status, 400);
  const persisted = await db
    .select({ id: companyMessagesTable.id })
    .from(companyMessagesTable)
    .where(eq(companyMessagesTable.content, content));
  assert.deepEqual(persisted, []);
});

test("a textual @name mention routes only to that active room member", async (t) => {
  await dbReady;
  const marker = randomUUID();
  const contentMarker = `textual-room-mention-${marker}`;
  const created = await db
    .insert(agentsTable)
    .values([
      {
        name: `Mentioned ${marker}`,
        role: "Test Agent",
        systemPrompt: "Test only",
        status: "working",
        createdByUser: true,
      },
      {
        name: `Silent ${marker}`,
        role: "Test Agent",
        systemPrompt: "Test only",
        createdByUser: true,
      },
    ])
    .returning();
  const mentioned = created[0]!;
  const silent = created[1]!;
  const content = `@${mentioned.name} ${contentMarker}`;
  const channelId = await companyChannelId();
  await db.insert(companyChannelMembersTable).values([
    { channelId, agentId: mentioned.id },
    { channelId, agentId: silent.id },
  ]);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  t.after(async () => {
    await db
      .delete(companyMessagesTable)
      .where(eq(companyMessagesTable.content, content));
    await db
      .delete(companyChannelMembersTable)
      .where(eq(companyChannelMembersTable.agentId, mentioned.id));
    await db
      .delete(companyChannelMembersTable)
      .where(eq(companyChannelMembersTable.agentId, silent.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, mentioned.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, silent.id));
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${baseUrl}/api/company-chat/messages`, {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
    }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as {
    routing: {
      mode: string;
      mentionedAgentIds: number[];
      decisions: Array<{
        agentId: number;
        shouldAttempt: boolean;
        reason: string;
      }>;
    };
    skippedParticipants: Array<{ agentId: number; reason: string }>;
  };
  assert.equal(body.routing.mode, "mentions");
  assert.deepEqual(body.routing.mentionedAgentIds, [mentioned.id]);
  assert.deepEqual(
    body.routing.decisions
      .filter((decision) => decision.shouldAttempt)
      .map((decision) => decision.agentId),
    [mentioned.id],
  );
  assert.deepEqual(body.skippedParticipants, [
    { agentId: mentioned.id, reason: "busy" },
  ]);
});

test("Company Room context is visible only to durable room members", async (t) => {
  await dbReady;
  const marker = randomUUID();
  const secretMarker = `room-context-${marker}`;
  const created = await db
    .insert(agentsTable)
    .values([
      {
        name: `Context member ${marker}`,
        role: "Test Agent",
        systemPrompt: "Test only",
        createdByUser: true,
      },
      {
        name: `Context outsider ${marker}`,
        role: "Test Agent",
        systemPrompt: "Test only",
        createdByUser: true,
      },
      {
        name: `Inactive context member ${marker}`,
        role: "Test Agent",
        systemPrompt: "Test only",
        createdByUser: true,
        isActive: false,
      },
    ])
    .returning();
  const member = created[0]!;
  const outsider = created[1]!;
  const inactiveMember = created[2]!;
  const channelId = await companyChannelId();
  await db.insert(companyChannelMembersTable).values([
    { channelId, agentId: member.id },
    { channelId, agentId: inactiveMember.id },
  ]);
  await db.insert(companyMessagesTable).values({
    channelId,
    senderType: "founder",
    senderAgentId: null,
    source: "operator",
    content: secretMarker,
  });
  t.after(async () => {
    await db
      .delete(companyMessagesTable)
      .where(eq(companyMessagesTable.content, secretMarker));
    await db
      .delete(companyChannelMembersTable)
      .where(eq(companyChannelMembersTable.agentId, member.id));
    await db
      .delete(companyChannelMembersTable)
      .where(eq(companyChannelMembersTable.agentId, inactiveMember.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, member.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, outsider.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, inactiveMember.id));
  });

  const memberPrompt = await buildChatSystemPrompt(member);
  const outsiderPrompt = await buildChatSystemPrompt(outsider);
  const inactiveMemberPrompt = await buildChatSystemPrompt(inactiveMember);
  assert.match(memberPrompt, /company_channel_contract/);
  assert.match(memberPrompt, new RegExp(secretMarker));
  assert.doesNotMatch(outsiderPrompt, /company_channel_contract/);
  assert.doesNotMatch(outsiderPrompt, new RegExp(secretMarker));
  assert.doesNotMatch(inactiveMemberPrompt, /company_channel_contract/);
  assert.doesNotMatch(inactiveMemberPrompt, new RegExp(secretMarker));
});
