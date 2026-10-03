import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  db,
  dbReady,
  closeDatabase,
  chatgptRegistrationsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { createPostgresChatGPTRegistrationStore } from "./chatgpt-registration-store";
import { exportChatGPTSession, importChatGPTSession } from "./chatgpt-handoff";

test("a rejected source retirement leaves the transfer unimportable and the transactional source session intact", async () => {
  await dbReady;
  const root = await mkdtemp(path.join(tmpdir(), "acos-pg-handoff-"));
  const id = randomUUID(),
    expiredId = randomUUID(),
    targetHostId = `urn:uuid:${randomUUID()}`;
  const constraint = `fixture_handoff_${id.replaceAll("-", "")}`;
  try {
    const store = await createPostgresChatGPTRegistrationStore(
      db,
      "fixture-pg-handoff-key-not-a-human-secret",
    );
    const hostId = await store.getHostId();
    await store.replaceRegistration(0, {
      id: expiredId,
      hostId,
      clientId: "oaiapp_expired_handoff_fixture",
      accountId: "fixture-expired-handoff-account",
      subject: "fixture-expired-handoff-subject",
      credentials: {
        accessToken: "fixture-expired-handoff-access",
        refreshToken: "fixture-expired-handoff-refresh",
        idToken: "fixture-expired-handoff-id",
        grants: [
          "openid",
          "offline_access",
          "resource.invoke",
          "chatgpt.tokens.use.direct",
        ],
        expiresAt: Date.now() - 1000,
      },
    });
    await assert.rejects(
      exportChatGPTSession({
        store,
        registrationId: expiredId,
        expectedRevision: 1,
        targetHostId,
        directory: path.join(root, "expired-transfer"),
      }),
      /transfer_requires_refresh/,
    );
    assert.equal(
      (await store.readRegistration(expiredId))!.credentials!.refreshToken,
      "fixture-expired-handoff-refresh",
    );
    await store.replaceRegistration(0, {
      id,
      hostId,
      clientId: "oaiapp_pg_handoff_fixture",
      accountId: "fixture-pg-handoff-account",
      subject: "fixture-pg-handoff-subject",
      credentials: {
        accessToken: "fixture-pg-handoff-access",
        refreshToken: "fixture-pg-handoff-refresh",
        idToken: "fixture-pg-handoff-id",
        grants: [
          "openid",
          "offline_access",
          "resource.invoke",
          "chatgpt.tokens.use.direct",
        ],
        expiresAt: Date.now() + 3600_000,
      },
    });
    // Exact synthetic row only. Force the actual DB write to reject revision 2.
    await db.execute(
      sql.raw(
        `ALTER TABLE chatgpt_registrations ADD CONSTRAINT ${constraint} CHECK (id <> '${id}'::uuid OR revision < 2)`,
      ),
    );
    const directory = path.join(root, "transfer");
    await assert.rejects(
      exportChatGPTSession({
        store,
        registrationId: id,
        expectedRevision: 1,
        targetHostId,
        directory,
      }),
    );
    const saved = (await store.readRegistration(id))!;
    assert.equal(saved.revision, 1);
    assert.equal(saved.credentials!.refreshToken, "fixture-pg-handoff-refresh");
    assert.equal(
      JSON.parse(
        await readFile(path.join(directory, "session-transfer.json"), "utf8"),
      ).state,
      "prepared",
    );
    await assert.rejects(
      importChatGPTSession({ store, directory, expectedRevision: 1 }),
      /transfer_not_ready/,
    );
  } finally {
    await db.execute(
      sql.raw(
        `ALTER TABLE chatgpt_registrations DROP CONSTRAINT IF EXISTS ${constraint}`,
      ),
    );
    await db
      .delete(chatgptRegistrationsTable)
      .where(eq(chatgptRegistrationsTable.id, id));
    await db
      .delete(chatgptRegistrationsTable)
      .where(eq(chatgptRegistrationsTable.id, expiredId));
    await closeDatabase();
    await rm(root, { recursive: true, force: true });
  }
});
