import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { inArray } from "drizzle-orm";
import {
  db,
  dbReady,
  closeDatabase,
  chatgptRegistrationsTable,
  chatgptRegistrationLocksTable,
} from "@workspace/db";
import { PlanInferenceError } from "@workspace/ai-server";
import type { ChatGPTRegistrationStore } from "@workspace/ai-server/chatgpt-plan-types";
import {
  createFileChatGPTRegistrationStore,
  createPostgresChatGPTRegistrationStore,
  ChatGPTRegistrationConflict,
} from "./chatgpt-registration-store";
import { createChatGPTConnectionRuntime } from "./chatgpt-connection-runtime";
import { createChatGPTPlanAccountResolver } from "./chatgpt-plan-runtime";
import {
  recordChatGPTPlanQuota,
  retryChatGPTPlanQuota,
} from "./chatgpt-plan-admission";

for (const backend of ["file", "transactional"] as const) {
  test(`${backend} shared plan quota survives restart/rotation and an old attempt cannot undo explicit retry`, async (t) => {
    let owner: ChatGPTRegistrationStore;
    let reopen: () => Promise<ChatGPTRegistrationStore>;
    if (backend === "file") {
      const root = await mkdtemp(path.join(tmpdir(), "acos-plan-admission-"));
      const directory = path.join(root, "protected-store");
      reopen = () => createFileChatGPTRegistrationStore(directory);
      owner = await reopen();
    } else {
      await dbReady;
      reopen = () =>
        createPostgresChatGPTRegistrationStore(
          db,
          "fixture-plan-admission-authority-key",
        );
      owner = await reopen();
    }
    const createdIds: string[] = [];
    t.after(async () => {
      if (backend === "transactional" && createdIds.length) {
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
    });
    let clock = Date.now();
    const now = () => clock;
    const hostId = await owner.getHostId();
    const first = await owner.replaceRegistration(0, {
      id: randomUUID(),
      hostId,
      clientId: "fixture-plan-client",
      accountId: "fixture-plan-profile",
      subject: "fixture-plan-subject",
      credentials: {
        accessToken: "fixture-plan-access",
        idToken: "fixture-plan-id",
        grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
        expiresAt: clock + 3600_000,
      },
    });
    createdIds.push(first.id);
    await owner.activateRegistration(first.id, first.revision);
    // Another owner rotates the token after this inference already began.
    await owner.replaceRegistration(first.revision, {
      ...first,
      credentials: {
        ...first.credentials!,
        accessToken: "fixture-rotated-access",
      },
    });
    const quota = new PlanInferenceError(
      "quota",
      { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      "subscription_sharing_usage_limit_exceeded",
      200,
    );
    assert.equal(
      await recordChatGPTPlanQuota(owner, first, quota, { now }),
      true,
    );
    const restarted = await reopen();
    const paused = (await restarted.readRegistration(first.id))!;
    assert.equal(paused.credentials?.accessToken, "fixture-rotated-access");
    assert.equal(paused.planPause?.retryAt, null);
    assert.equal(paused.planAdmissionVersion, 0);
    assert.ok(paused.planPause?.id);
    const status = await restarted.readPublicStatus(first.id);
    assert.equal(status?.signedIn, true);
    assert.equal(
      status?.canUsePlan,
      true,
      "Consent and admission pause are separate states",
    );
    assert.equal(status?.planPause?.id, paused.planPause?.id);
    assert.ok(!JSON.stringify(status).includes("fixture-rotated-access"));
    let networkCalls = 0;
    const runtime = createChatGPTConnectionRuntime({
      store: async () => restarted,
      fetch: (async () => {
        networkCalls++;
        throw new Error("Paused plan must not request tokens or inference");
      }) as typeof fetch,
    });
    t.after(() => runtime.close());
    const resolve = createChatGPTPlanAccountResolver(runtime, { now });
    await assert.rejects(resolve(), {
      kind: "quota",
      requestStarted: false,
      retryAt: null,
    });
    assert.equal(networkCalls, 0);
    // Refresh credentials, profile display updates and ordinary sign-in cannot
    // erase a pause when they do not explicitly request a new admission version.
    const preserved = await restarted.replaceRegistration(paused.revision, {
      ...first,
      credentials: {
        ...first.credentials!,
        accessToken: "fixture-latest-access",
      },
    });
    assert.equal(preserved.planPause?.id, paused.planPause?.id);
    await assert.rejects(
      retryChatGPTPlanQuota(
        restarted,
        first.id,
        paused.revision,
        paused.planPause!.id,
      ),
      ChatGPTRegistrationConflict,
    );
    await assert.rejects(
      retryChatGPTPlanQuota(
        restarted,
        first.id,
        preserved.revision,
        randomUUID(),
      ),
      ChatGPTRegistrationConflict,
    );
    const resumed = await retryChatGPTPlanQuota(
      restarted,
      first.id,
      preserved.revision,
      paused.planPause!.id,
    );
    assert.equal(resumed.planPause ?? null, null);
    const current = (await restarted.readRegistration(first.id))!;
    assert.equal(current.planAdmissionVersion, 1);
    assert.equal(
      (await resolve())?.credentials?.accessToken,
      "fixture-latest-access",
    );
    assert.equal(
      await recordChatGPTPlanQuota(owner, first, quota, { now }),
      false,
      "Late quota from an attempt admitted before explicit retry is fenced",
    );
    assert.equal(
      (await restarted.readRegistration(first.id))?.planPause ?? null,
      null,
    );
    // The user's newly admitted attempt can pause again, with an actual known header.
    const retryAt = clock + 5000;
    const timedQuota = new PlanInferenceError(
      "quota",
      null,
      "subscription_sharing_usage_limit_exceeded",
      429,
      null,
      "error",
      null,
      retryAt,
      true,
    );
    assert.equal(
      await recordChatGPTPlanQuota(owner, current, timedQuota, { now }),
      true,
    );
    await assert.rejects(resolve(), {
      kind: "quota",
      requestStarted: false,
      retryAt,
    });
    clock = retryAt + 1;
    assert.equal(
      (await resolve())?.id,
      current.id,
      "Only an actual Retry-After permits timed admission",
    );
    // Unknown reset always stays unknown, even if much more time passes.
    assert.equal(
      await recordChatGPTPlanQuota(owner, current, quota, { now }),
      true,
    );
    clock += 86400_000;
    await assert.rejects(resolve(), {
      kind: "quota",
      retryAt: null,
      requestStarted: false,
    });
    const latest = (await owner.readRegistration(first.id))!;
    await owner.replaceRegistration(latest.revision, {
      ...latest,
      credentials: null,
    });
    assert.equal(
      await recordChatGPTPlanQuota(owner, current, quota, { now }),
      false,
      "A late request cannot restore a signed-out account",
    );
    assert.equal((await owner.readRegistration(first.id))?.credentials, null);
  });
}
test.after(() => closeDatabase());
