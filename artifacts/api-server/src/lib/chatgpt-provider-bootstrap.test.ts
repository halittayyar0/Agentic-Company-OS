import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  chatgptRegistrationsTable,
  chatgptRegistrationLocksTable,
} from "@workspace/db";
import {
  configureChatGPTPlan,
  createChatCompletion,
} from "@workspace/ai-server";
import { createPostgresChatGPTRegistrationStore } from "./chatgpt-registration-store";
import { createChatGPTConnectionRuntime } from "./chatgpt-connection-runtime";
import { configureChatGPTPlanRuntime } from "./chatgpt-plan-runtime";
import { retryChatGPTPlanQuota } from "./chatgpt-plan-admission";

test("API/worker provider wiring persists real stream quota, survives a restarted provider, and admits only explicit retry", async (t) => {
  await dbReady;
  const key = "fixture-provider-runtime-protected-key";
  const store = await createPostgresChatGPTRegistrationStore(db, key);
  const id = randomUUID();
  t.after(async () => {
    configureChatGPTPlan(null);
    await db
      .update(chatgptRegistrationLocksTable)
      .set({ activeRegistrationId: null })
      .where(eq(chatgptRegistrationLocksTable.activeRegistrationId, id));
    await db
      .delete(chatgptRegistrationsTable)
      .where(eq(chatgptRegistrationsTable.id, id));
    await closeDatabase();
  });
  const saved = await store.replaceRegistration(0, {
    id,
    hostId: await store.getHostId(),
    clientId: "fixture-runtime-client",
    accountId: "fixture-runtime-account",
    subject: "fixture-runtime-subject",
    credentials: {
      accessToken: "fixture-runtime-access",
      idToken: "fixture-runtime-id",
      grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
      expiresAt: Date.now() + 3600_000,
    },
  });
  await store.activateRegistration(id, saved.revision);
  let calls = 0,
    inferenceCalls = 0;
  const request: typeof fetch = async (input) => {
    calls++;
    const url = String(input);
    if (url === "https://api.openai.com/v1/models")
      return Response.json({
        models: [
          {
            slug: "fixture-plan",
            display_name: "Fixture plan",
            visibility: "list",
          },
        ],
      });
    assert.equal(url, "https://api.openai.com/v1/responses");
    inferenceCalls++;
    return new Response(
      `data: ${JSON.stringify({
        type: "response.failed",
        response: {
          id: "resp_runtime_quota",
          error: { code: "subscription_sharing_usage_limit_exceeded" },
          usage: { input_tokens: 20, output_tokens: 7, total_tokens: 27 },
        },
      })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const runtime = createChatGPTConnectionRuntime({
    store: async () => store,
    fetch: request,
  });
  configureChatGPTPlanRuntime(runtime, { fetch: request });
  const params = {
    model: "chatgpt:fixture-plan",
    messages: [{ role: "user" as const, content: "Useful work" }],
  };
  await assert.rejects(createChatCompletion(params), {
    kind: "quota",
    requestStarted: true,
    usage: { prompt_tokens: 20, completion_tokens: 7, total_tokens: 27 },
  });
  const paused = (await store.readPublicStatus(id))!;
  assert.equal(paused.planPause?.retryAt, null);
  assert.equal(inferenceCalls, 1);
  await runtime.close();
  const restartedStore = await createPostgresChatGPTRegistrationStore(db, key);
  const restarted = createChatGPTConnectionRuntime({
    store: async () => restartedStore,
    fetch: request,
  });
  t.after(() => restarted.close());
  configureChatGPTPlanRuntime(restarted, { fetch: request });
  const before = calls;
  await assert.rejects(createChatCompletion(params), {
    kind: "quota",
    requestStarted: false,
    usage: null,
  });
  assert.equal(
    calls,
    before,
    "a paused worker cannot call discovery, refresh or inference",
  );
  await retryChatGPTPlanQuota(
    restartedStore,
    id,
    paused.revision,
    paused.planPause!.id,
  );
  await assert.rejects(createChatCompletion(params), {
    kind: "quota",
    requestStarted: true,
  });
  assert.equal(inferenceCalls, 2);
});
