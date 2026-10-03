import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createFileChatGPTRegistrationStore,
  ChatGPTRegistrationConflict,
} from "./chatgpt-registration-store";
import type {
  ChatGPTRegistrationAccess,
  ChatGPTRegistrationInput,
} from "@workspace/ai-server/chatgpt-plan-types";

function registration(
  hostId: string,
  accountId = "account-one",
): ChatGPTRegistrationInput {
  return {
    id: randomUUID(),
    hostId,
    clientId: `client-${accountId}`,
    accountId,
    subject: `subject-${accountId}`,
    email: "same@example.test",
    displayName: "Fixture",
    credentials: {
      accessToken: "fixture-access-secret",
      refreshToken: "fixture-refresh-secret",
      idToken: "fixture-id-secret",
      grants: [
        "openid",
        "offline_access",
        "resource.invoke",
        "chatgpt.tokens.use.direct",
      ],
      expiresAt: Date.now() + 3600_000,
      earliestRefreshAt: Date.now() + 300_000,
    },
  };
}

async function fixture(action: (directory: string) => Promise<void>) {
  const parent = await mkdtemp(path.join(tmpdir(), "acos-registration-"));
  try {
    await action(path.join(parent, "vault"));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

test("encrypted registrations survive restart, retain host identity and keep equal-email accounts separate", async () => {
  await fixture(async (directory) => {
    const store = await createFileChatGPTRegistrationStore(directory);
    const hostId = await store.getHostId();
    assert.match(hostId, /^urn:uuid:/);
    const first = registration(hostId),
      second = registration(hostId, "account-two");
    second.subject = first.subject; // Different issued clients may bind different workspaces for the same person.
    await store.replaceRegistration(0, first);
    assert.equal(await store.readActiveRegistration(), null);
    await store.activateRegistration(first.id, 1);
    await store.replaceRegistration(0, second);
    assert.equal((await store.readActiveRegistration())?.id, first.id);
    const saved = await readFile(
      path.join(directory, "registrations.json"),
      "utf8",
    );
    for (const value of [
      "fixture-access-secret",
      "fixture-refresh-secret",
      "fixture-id-secret",
      "same@example.test",
    ])
      assert.ok(!saved.includes(value));
    const reopened = await createFileChatGPTRegistrationStore(directory);
    assert.equal(await reopened.getHostId(), hostId);
    assert.equal((await reopened.readActiveRegistration())?.id, first.id);
    await assert.rejects(
      reopened.activateRegistration(second.id, 0),
      ChatGPTRegistrationConflict,
    );
    assert.equal((await reopened.readActiveRegistration())?.id, first.id);
    assert.equal(
      (await reopened.readRegistration(first.id))?.clientId,
      first.clientId,
    );
    assert.equal(
      (await reopened.readRegistration(second.id))?.accountId,
      "account-two",
    );
    const publicStatus = await reopened.readPublicStatus(first.id);
    assert.equal(publicStatus?.canUsePlan, true);
    assert.ok(!JSON.stringify(publicStatus).includes("secret"));
    await reopened.replaceRegistration(1, { ...first, credentials: null });
    assert.equal(
      (await reopened.readRegistration(first.id))?.clientId,
      first.clientId,
    );
    assert.equal(
      (await reopened.readPublicStatus(first.id))?.canUsePlan,
      false,
    );
  });
});

test("stale replacement and malformed credentials preserve a working registration", async () => {
  await fixture(async (directory) => {
    const store = await createFileChatGPTRegistrationStore(directory);
    const first = registration(await store.getHostId());
    await store.replaceRegistration(0, first);
    await assert.rejects(
      store.replaceRegistration(0, { ...first, credentials: null }),
      ChatGPTRegistrationConflict,
    );
    await assert.rejects(
      store.replaceRegistration(1, {
        ...first,
        hostId: `urn:uuid:${randomUUID()}`,
      }),
    );
    await assert.rejects(
      store.replaceRegistration(1, { ...first, clientId: "changed-client" }),
    );
    await assert.rejects(
      store.replaceRegistration(1, {
        ...first,
        credentials: { ...first.credentials!, expiresAt: Number.NaN },
      }),
    );
    assert.equal((await store.readRegistration(first.id))?.revision, 1);
    assert.equal(
      (await store.readRegistration(first.id))?.credentials?.accessToken,
      first.credentials?.accessToken,
    );
  });
});

test("independent file-store owners serialize refresh rotation and fence stale writes", async () => {
  await fixture(async (directory) => {
    const owner = await createFileChatGPTRegistrationStore(directory);
    const first = registration(await owner.getHostId());
    await owner.replaceRegistration(0, first);
    const other = await createFileChatGPTRegistrationStore(directory);
    let active = 0,
      maximumActive = 0;
    let expiredOwner: ChatGPTRegistrationAccess | undefined;
    const refresh = (store: typeof owner) =>
      store.withRegistrationRefreshLock(first.id, async (locked) => {
        expiredOwner = locked;
        active++;
        maximumActive = Math.max(maximumActive, active);
        try {
          const current = (await locked.readRegistration(first.id))!;
          await new Promise((resolve) => setTimeout(resolve, 25));
          return await locked.replaceRegistration(current.revision, {
            ...current,
            credentials: {
              ...current.credentials!,
              accessToken: `rotated-${current.revision}`,
              refreshToken: `refresh-${current.revision}`,
            },
          });
        } finally {
          active--;
        }
      });
    const results = await Promise.all([refresh(owner), refresh(other)]);
    assert.equal(maximumActive, 1);
    assert.deepEqual(results.map((result) => result.revision).sort(), [2, 3]);
    await assert.rejects(
      owner.replaceRegistration(1, first),
      ChatGPTRegistrationConflict,
    );
    assert.equal((await other.readRegistration(first.id))?.revision, 3);
    await assert.rejects(
      expiredOwner!.replaceRegistration(3, first),
      /registration_lock_closed/,
    );
  });
});

test("corrupt ciphertext and foreign registrations fail closed without replacement", async () => {
  await fixture(async (directory) => {
    const store = await createFileChatGPTRegistrationStore(directory);
    const first = registration(await store.getHostId());
    await store.replaceRegistration(0, first);
    const file = path.join(directory, "registrations.json");
    const envelope = JSON.parse(await readFile(file, "utf8"));
    envelope.authTag = "AAAAAAAAAAAAAAAAAAAAAA";
    await writeFile(file, JSON.stringify(envelope));
    await assert.rejects(
      store.readRegistration(first.id),
      /registration_storage_invalid/,
    );
    await assert.rejects(
      store.replaceRegistration(1, first),
      /registration_storage_invalid/,
    );
    assert.equal(
      JSON.parse(await readFile(file, "utf8")).authTag,
      envelope.authTag,
    );
  });
});
