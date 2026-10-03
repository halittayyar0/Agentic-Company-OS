import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  db,
  dbReady,
  closeDatabase,
  chatgptRegistrationsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { createPostgresChatGPTRegistrationStore } from "./chatgpt-registration-store";
import { createChatGPTSessionManager } from "./chatgpt-session";

test("confirmed invalid renewal commits credential removal through the actual transactional store", async () => {
  await dbReady;
  const id = randomUUID();
  try {
    const store = await createPostgresChatGPTRegistrationStore(
      db,
      "fixture-session-storage-key-not-a-human-secret",
    );
    const hostId = await store.getHostId(),
      now = Date.now();
    const input = {
      id,
      hostId,
      clientId: "oaiapp_transaction_fixture",
      accountId: "fixture-account",
      subject: "fixture-subject",
      credentials: {
        accessToken: "fixture-expired-access",
        refreshToken: "fixture-invalid-refresh",
        idToken: "fixture-old-id",
        grants: [
          "openid",
          "offline_access",
          "resource.invoke",
          "chatgpt.tokens.use.direct",
        ],
        expiresAt: now - 1000,
      },
    };
    let expectedRevision = 0;
    for (const code of [
      "invalid_grant",
      "invalid_refresh_token",
      "token_expired",
      "refresh_token_expired",
      "refresh_token_invalidated",
      "refresh_token_reused",
    ]) {
      await store.replaceRegistration(expectedRevision, input);
      expectedRevision++;
      let requests = 0;
      const sessions = createChatGPTSessionManager({
        store,
        now: () => now,
        fetch: async (input, init) => {
          assert.equal(
            String(input),
            "https://auth.openai.com/api/accounts/oauth/token",
          );
          assert.equal(init?.method, "POST");
          requests++;
          return new Response(
            JSON.stringify({
              error: code === "invalid_grant" ? code : { code },
            }),
            {
              status: code === "invalid_grant" ? 400 : 401,
              headers: { "Content-Type": "application/json" },
            },
          );
        },
      });
      await assert.rejects(
        sessions.renewRegistration(id),
        /session_sign_in_required/,
      );
      const saved = (await store.readRegistration(id))!;
      assert.equal(saved.credentials, null);
      assert.equal(saved.revision, ++expectedRevision);
      assert.equal(saved.clientId, "oaiapp_transaction_fixture");
      assert.equal(saved.hostId, hostId);
      assert.equal(requests, 1);
    }
    await store.replaceRegistration(expectedRevision, input);
    const configurationFailure = createChatGPTSessionManager({
      store,
      now: () => now,
      fetch: async () =>
        new Response(JSON.stringify({ error: "invalid_client" }), {
          status: 401,
        }),
    });
    await assert.rejects(
      configurationFailure.renewRegistration(id),
      /session_client_configuration/,
    );
    assert.equal(
      (await store.readRegistration(id))!.credentials!.refreshToken,
      "fixture-invalid-refresh",
    );
  } finally {
    await db
      .delete(chatgptRegistrationsTable)
      .where(eq(chatgptRegistrationsTable.id, id));
    await closeDatabase();
  }
});
