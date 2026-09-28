import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { agentsTable, db, dbReady, messagesTable } from "@workspace/db";
import app from "../app";

test("agent chat fails closed before persistence when no HTTP runtime is bound", async (t) => {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Unbound HTTP chat runtime",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
    })
    .returning();
  assert.ok(agent);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(messagesTable).where(eq(messagesTable.agentId, agent.id));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/agents/${agent.id}/messages`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "must not reach the provider" }),
    },
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error:
      "Bu API çalışma örneği yeni sohbet işlemi kabul etmiyor; güvenli bir yeniden deneme yapın.",
    code: "runtime_admission_closed",
  });

  const persistedMessages = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(eq(messagesTable.agentId, agent.id));
  assert.deepEqual(persistedMessages, []);
  const [persistedAgent] = await db
    .select({
      status: agentsTable.status,
      runLeaseOwner: agentsTable.runLeaseOwner,
    })
    .from(agentsTable)
    .where(eq(agentsTable.id, agent.id));
  assert.deepEqual(persistedAgent, {
    status: "idle",
    runLeaseOwner: null,
  });
});
