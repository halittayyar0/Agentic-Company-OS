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
import { runChatGPTConnectionCLI } from "./chatgpt-cli";

test("CLI exposes public account state and target identity without accepting credential or ambiguous command arguments", async () => {
  await dbReady;
  const id = randomUUID();
  try {
    const store = await createPostgresChatGPTRegistrationStore(
      db,
      "fixture-cli-storage-key-not-a-human-secret",
    );
    const hostId = await store.getHostId();
    await store.replaceRegistration(0, {
      id,
      hostId,
      clientId: "oaiapp_cli_fixture",
      accountId: "fixture-cli-account",
      subject: "fixture-cli-subject",
      credentials: {
        accessToken: "fixture-private-cli-access",
        refreshToken: "fixture-private-cli-refresh",
        idToken: "fixture-private-cli-id",
        grants: [
          "openid",
          "offline_access",
          "resource.invoke",
          "chatgpt.tokens.use.direct",
        ],
        expiresAt: Date.now() + 3600_000,
      },
    });
    const output: string[] = [],
      errors: string[] = [];
    const options = {
      store: async () => store,
      write: (value: string) => output.push(value),
      writeError: (value: string) => errors.push(value),
    };
    assert.equal(await runChatGPTConnectionCLI(["status"], options), 0);
    const status = JSON.parse(output.pop()!);
    assert.equal(status.registrations[0].id, id);
    assert.equal(status.registrations[0].canUsePlan, true);
    assert.ok(!JSON.stringify(status).includes("fixture-private-cli"));
    assert.equal(await runChatGPTConnectionCLI(["prepare-target"], options), 0);
    assert.equal(JSON.parse(output.pop()!).targetHostId, hostId);
    for (const args of [
      ["import", "--transfer-directory", "relative-path"],
      ["export", "--registration", id, "--expected-revision", "-1"],
      ["status", "--access-token", "browser-injected-secret"],
      ["status", "--store-directory", "a", "--store-directory", "b"],
      ["unknown-command"],
    ]) {
      assert.equal(await runChatGPTConnectionCLI(args, options), 2);
    }
    assert.ok(!errors.join("\n").includes("browser-injected-secret"));
    assert.equal((await store.readRegistration(id))!.revision, 1);
    assert.equal(
      (await store.readRegistration(id))!.credentials!.refreshToken,
      "fixture-private-cli-refresh",
    );
  } finally {
    await db
      .delete(chatgptRegistrationsTable)
      .where(eq(chatgptRegistrationsTable.id, id));
    await closeDatabase();
  }
});
