import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { inArray } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  chatgptRegistrationsTable,
  chatgptRegistrationLocksTable,
} from "@workspace/db";
import { createPostgresChatGPTRegistrationStore } from "./chatgpt-registration-store";
import { createChatGPTConnectionRuntime } from "./chatgpt-connection-runtime";
import { createChatGPTPlanAccountResolver } from "./chatgpt-plan-runtime";
import { ChatGPTSessionError } from "./chatgpt-session";

test("plan account resolution uses durable selection and renewal while refusing identity-only or changed accounts", async () => {
  await dbReady;
  const createdIds: string[] = [];
  try {
    const store = await createPostgresChatGPTRegistrationStore(
      db,
      "fixture-plan-runtime-protected-key",
    );
    const hostId = await store.getHostId();
    let networkCalls = 0;
    const runtime = createChatGPTConnectionRuntime({
      store: async () => store,
      fetch: (async () => {
        networkCalls++;
        throw new Error("Must not use another billing path");
      }) as typeof fetch,
    });
    const resolve = createChatGPTPlanAccountResolver(runtime);
    assert.equal(await resolve(), null);
    const first = await store.replaceRegistration(0, {
      id: randomUUID(),
      hostId,
      clientId: "fixture-client-a",
      accountId: "fixture-profile-a",
      subject: "fixture-subject-a",
      credentials: {
        accessToken: "fixture-access-a",
        idToken: "fixture-id-a",
        grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
        expiresAt: Date.now() + 3600_000,
      },
    });
    createdIds.push(first.id);
    assert.equal(
      await resolve(),
      null,
      "A saved candidate is not a selected account",
    );
    await store.activateRegistration(first.id, first.revision);
    assert.equal((await resolve())?.id, first.id);
    const rotated = await store.replaceRegistration(first.revision, {
      ...first,
      credentials: {
        ...first.credentials!,
        accessToken: "fixture-rotated-access",
      },
    });
    assert.equal(
      (await resolve())?.credentials?.accessToken,
      "fixture-rotated-access",
    );
    assert.equal(networkCalls, 0);
    const identityOnly = await store.replaceRegistration(0, {
      ...first,
      id: randomUUID(),
      clientId: "fixture-client-b",
      accountId: "fixture-profile-b",
      subject: "fixture-subject-b",
      credentials: {
        ...first.credentials!,
        grants: ["openid"],
        expiresAt: Date.now() - 1,
      },
    });
    createdIds.push(identityOnly.id);
    await store.activateRegistration(identityOnly.id, identityOnly.revision);
    await assert.rejects(resolve(), {
      kind: "permission",
      requestStarted: false,
    });
    assert.equal(
      networkCalls,
      0,
      "Plan permission is checked before requesting refresh",
    );
    await store.activateRegistration(rotated.id, rotated.revision);
    const changing = createChatGPTPlanAccountResolver({
      store: async () => store,
      sessions: async () => ({
        renewRegistration: async () => {
          await store.activateRegistration(
            identityOnly.id,
            identityOnly.revision,
          );
          return rotated;
        },
      }),
    });
    await assert.rejects(changing(), {
      kind: "account_changed",
      requestStarted: false,
    });
    assert.equal((await store.readActiveRegistration())?.id, identityOnly.id);
    await store.activateRegistration(rotated.id, rotated.revision);
    for (const [sessionKind, expected] of [
      ["sign_in_required", "sign_in_required"],
      ["temporary", "temporary"],
      ["refresh_deferred", "temporary"],
      ["registration_changed", "account_changed"],
      ["cancelled", "cancelled"],
    ] as const) {
      const failing = createChatGPTPlanAccountResolver({
        store: async () => store,
        sessions: async () => ({
          renewRegistration: async () => {
            throw new ChatGPTSessionError(sessionKind);
          },
        }),
      });
      await assert.rejects(failing(), {
        kind: expected,
        requestStarted: false,
      });
      assert.equal(
        (await store.readRegistration(rotated.id))?.credentials?.accessToken,
        "fixture-rotated-access",
      );
    }
    const controller = new AbortController();
    controller.abort(new Error("Private abort reason"));
    await assert.rejects(resolve(controller.signal), {
      kind: "cancelled",
      requestStarted: false,
    });
    await runtime.close();
  } finally {
    if (createdIds.length) {
      await db
        .update(chatgptRegistrationLocksTable)
        .set({ activeRegistrationId: null })
        .where(
          inArray(
            chatgptRegistrationLocksTable.activeRegistrationId,
            createdIds,
          ),
        );
      await db
        .delete(chatgptRegistrationsTable)
        .where(inArray(chatgptRegistrationsTable.id, createdIds));
    }
    await closeDatabase();
  }
});
