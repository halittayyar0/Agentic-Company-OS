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
import {
  createPostgresChatGPTRegistrationStore,
  ChatGPTRegistrationConflict,
} from "./chatgpt-registration-store";
import type {
  ChatGPTRegistrationInput,
  ChatGPTRegistrationAccess,
} from "@workspace/ai-server/chatgpt-plan-types";

test("transactional registration storage protects identity, serializes rotation and rejects corrupt or stale data", async () => {
  await dbReady;
  try {
    const key = "fixture-registration-key-32-characters-only";
    const owner = await createPostgresChatGPTRegistrationStore(db, key);
    const other = await createPostgresChatGPTRegistrationStore(db, key);
    const hostId = await owner.getHostId();
    assert.equal(await other.getHostId(), hostId);
    const input: ChatGPTRegistrationInput = {
      id: randomUUID(),
      hostId,
      clientId: "fixture-client-one",
      accountId: "fixture-account-one",
      subject: "fixture-subject-one",
      email: "same@example.test",
      credentials: {
        accessToken: "fixture-access-secret",
        refreshToken: "fixture-refresh-secret",
        idToken: "fixture-id-secret",
        grants: ["openid", "resource.invoke", "chatgpt.tokens.use.direct"],
        expiresAt: Date.now() + 3600_000,
      },
    };
    await owner.replaceRegistration(0, input);
    assert.equal(await owner.readActiveRegistration(), null);
    await owner.activateRegistration(input.id, 1);
    const second = {
      ...input,
      id: randomUUID(),
      clientId: "fixture-client-two",
      accountId: "fixture-account-two",
      subject: input.subject,
    };
    await owner.replaceRegistration(0, second);
    assert.equal((await other.readActiveRegistration())?.id, input.id);
    await assert.rejects(
      owner.activateRegistration(second.id, 0),
      ChatGPTRegistrationConflict,
    );
    assert.equal((await other.readActiveRegistration())?.id, input.id);
    assert.equal((await owner.listPublicStatus()).length, 2);
    let active = 0,
      maximum = 0,
      expiredOwner: ChatGPTRegistrationAccess | undefined;
    const refresh = (store: typeof owner) =>
      store.withRegistrationRefreshLock(input.id, async (locked) => {
        expiredOwner = locked;
        active++;
        maximum = Math.max(maximum, active);
        try {
          const current = (await locked.readRegistration(input.id))!;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return await locked.replaceRegistration(current.revision, {
            ...current,
            credentials: {
              ...current.credentials!,
              refreshToken: `rotation-${current.revision}`,
            },
          });
        } finally {
          active--;
        }
      });
    const rotations = await Promise.all([refresh(owner), refresh(other)]);
    assert.equal(maximum, 1);
    assert.deepEqual(rotations.map((result) => result.revision).sort(), [2, 3]);
    await assert.rejects(
      expiredOwner!.replaceRegistration(3, input),
      /registration_lock_closed/,
    );
    await assert.rejects(
      owner.replaceRegistration(1, input),
      ChatGPTRegistrationConflict,
    );
    await assert.rejects(
      owner.replaceRegistration(3, { ...input, clientId: "wrong-client" }),
    );
    const [row] = await db
      .select()
      .from(chatgptRegistrationsTable)
      .where(eq(chatgptRegistrationsTable.id, input.id));
    for (const value of [
      "fixture-access-secret",
      "fixture-refresh-secret",
      "fixture-id-secret",
      "same@example.test",
      "fixture-account-one",
    ])
      assert.ok(!JSON.stringify(row).includes(value));
    await db
      .update(chatgptRegistrationsTable)
      .set({ authTag: "AAAAAAAAAAAAAAAAAAAAAA" })
      .where(eq(chatgptRegistrationsTable.id, input.id));
    await assert.rejects(
      other.readRegistration(input.id),
      /registration_storage_invalid/,
    );
    assert.equal(
      (await owner.readRegistration(second.id))?.clientId,
      second.clientId,
    );
  } finally {
    await closeDatabase();
  }
});
