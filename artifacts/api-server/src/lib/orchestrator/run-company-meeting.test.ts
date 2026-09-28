import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { agentsTable, companyChannelsTable, db, dbReady } from "@workspace/db";
import {
  isCompanyMeetingNoReply,
  runCompanyMeetingTurn,
} from "./run-company-meeting";

test("company meeting relevance sentinel is strict and cannot hide a real reply", () => {
  assert.equal(isCompanyMeetingNoReply("[[NO_REPLY]]"), true);
  assert.equal(isCompanyMeetingNoReply(" no_reply "), true);
  assert.equal(
    isCompanyMeetingNoReply("[[NO_REPLY]] ama bir fikrim var"),
    false,
  );
  assert.equal(isCompanyMeetingNoReply("Yanıt vermek istiyorum"), false);
});

test("a removed or never-enrolled agent cannot claim a Company Room reply", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Non-member room turn",
      role: "Test Agent",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  const [channel] = await db
    .select({ id: companyChannelsTable.id })
    .from(companyChannelsTable)
    .where(eq(companyChannelsTable.key, "company"));
  assert.ok(agent && channel);
  t.after(async () => {
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });

  const result = await runCompanyMeetingTurn({
    agent,
    channelId: channel.id,
    founderMessageId: 1,
    founderContent: "You must not receive this room message.",
  });
  assert.equal(result.message, null);
  assert.equal(result.skipReason, "unavailable");
  const [persistedAgent] = await db
    .select({
      status: agentsTable.status,
      runLeaseOwner: agentsTable.runLeaseOwner,
    })
    .from(agentsTable)
    .where(eq(agentsTable.id, agent.id));
  assert.deepEqual(persistedAgent, { status: "idle", runLeaseOwner: null });
});
