import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileChatGPTRegistrationStore } from "./chatgpt-registration-store";
import { exportChatGPTSession, importChatGPTSession } from "./chatgpt-handoff";
import { runChatGPTConnectionCLI } from "./chatgpt-cli";
import {
  recordChatGPTPlanQuota,
  retryChatGPTPlanQuota,
} from "./chatgpt-plan-admission";
import { PlanInferenceError } from "@workspace/ai-server";

test("protected selected-session handoff retires the source, preserves the target host and cannot replay consumed credentials", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "acos-session-handoff-"));
  try {
    const source = await createFileChatGPTRegistrationStore(
      path.join(root, "source"),
    );
    const target = await createFileChatGPTRegistrationStore(
      path.join(root, "target"),
    );
    const sourceHost = await source.getHostId(),
      targetHost = await target.getHostId();
    const id = randomUUID(),
      clientId = "oaiapp_handoff_fixture",
      subject = "fixture-selected-subject",
      now = Date.now();
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "fixture", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: "https://auth.openai.com",
        aud: clientId,
        sub: subject,
        iat: Math.floor(now / 1000),
        exp: Math.floor(now / 1000) + 3600,
      }),
    ).toString("base64url");
    const content = `${header}.${payload}`;
    const idToken = `${content}.${sign("RSA-SHA256", Buffer.from(content), privateKey).toString("base64url")}`;
    const accountId = createHash("sha256")
      .update(JSON.stringify(["https://auth.openai.com", clientId, subject]))
      .digest("hex");
    await source.replaceRegistration(0, {
      id,
      hostId: sourceHost,
      clientId,
      accountId,
      subject,
      credentials: {
        accessToken: "fixture-handoff-access",
        refreshToken: "fixture-handoff-refresh",
        idToken,
        grants: [
          "openid",
          "offline_access",
          "resource.invoke",
          "chatgpt.tokens.use.direct",
        ],
        expiresAt: now + 3600_000,
      },
    });
    await source.activateRegistration(id, 1);
    await recordChatGPTPlanQuota(
      source,
      (await source.readRegistration(id))!,
      new PlanInferenceError("quota", null, "rate_limit_exceeded", 429),
    );
    const firstPause = (await source.readRegistration(id))!.planPause!;
    await retryChatGPTPlanQuota(source, id, 2, firstPause.id);
    await recordChatGPTPlanQuota(
      source,
      (await source.readRegistration(id))!,
      new PlanInferenceError("quota", null, "rate_limit_exceeded", 429),
    );
    const transferredPause = (await source.readRegistration(id))!.planPause!;
    const transferDirectory = path.join(root, "transfer");
    await assert.rejects(
      exportChatGPTSession({
        store: source,
        registrationId: id,
        expectedRevision: 0,
        targetHostId: targetHost,
        directory: path.join(root, "stale"),
      }),
      /revision_conflict/,
    );
    assert.equal(
      (await source.readRegistration(id))!.credentials!.refreshToken,
      "fixture-handoff-refresh",
    );
    const output: string[] = [],
      errors: string[] = [];
    assert.equal(
      await runChatGPTConnectionCLI(
        [
          "export",
          "--registration",
          id,
          "--expected-revision",
          "4",
          "--target-host",
          targetHost,
          "--transfer-directory",
          transferDirectory,
        ],
        {
          store: async () => source,
          write: (value) => output.push(value),
          writeError: (value) => errors.push(value),
        },
      ),
      0,
    );
    assert.equal(JSON.parse(output.pop()!).sourceSignedOut, true);
    assert.equal((await source.readRegistration(id))!.credentials, null);
    assert.equal((await source.readRegistration(id))!.clientId, clientId);
    assert.equal(await source.getHostId(), sourceHost);
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(transferDirectory, "session-transfer.json"),
          "utf8",
        ),
      ).state,
      "ready",
    );
    const request: typeof fetch = async (url) => {
      assert.equal(
        String(url),
        "https://auth.openai.com/.well-known/jwks.json",
      );
      return new Response(
        JSON.stringify({
          keys: [
            {
              ...publicKey.export({ format: "jwk" }),
              kid: "fixture",
              use: "sig",
              alg: "RS256",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    await assert.rejects(
      importChatGPTSession({
        store: source,
        directory: transferDirectory,
        expectedRevision: 2,
        fetch: request,
      }),
      /target_host_mismatch/,
    );
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(transferDirectory, "session-transfer.json"),
          "utf8",
        ),
      ).state,
      "ready",
    );
    assert.equal(
      await runChatGPTConnectionCLI(
        [
          "import",
          "--expected-revision",
          "0",
          "--transfer-directory",
          transferDirectory,
        ],
        {
          store: async () => target,
          fetch: request,
          write: (value) => output.push(value),
          writeError: (value) => errors.push(value),
        },
      ),
      0,
    );
    const imported = JSON.parse(output.pop()!);
    assert.deepEqual(errors, []);
    assert.equal(imported.account.canUsePlan, true);
    assert.equal(imported.transferFileCleared, true);
    const active = (await target.readActiveRegistration())!;
    assert.equal(active.hostId, targetHost);
    assert.equal(active.clientId, clientId);
    assert.equal(active.subject, subject);
    assert.equal(active.credentials!.refreshToken, "fixture-handoff-refresh");
    assert.equal(
      active.planAdmissionVersion,
      0,
      "admission generations belong to this host's authority",
    );
    assert.deepEqual(
      active.planPause,
      transferredPause,
      "a host transfer does not bypass the account's unknown quota reset",
    );
    assert.equal(await target.getHostId(), targetHost);
    const consumed = await readFile(
      path.join(transferDirectory, "session-transfer.json"),
      "utf8",
    );
    assert.equal(JSON.parse(consumed).state, "consumed");
    assert.ok(!consumed.includes("fixture-handoff-refresh"));
    assert.ok(!consumed.includes(idToken));
    await assert.rejects(
      importChatGPTSession({
        store: target,
        directory: transferDirectory,
        expectedRevision: 1,
        fetch: request,
      }),
      /transfer_not_ready/,
    );
    assert.equal((await target.readActiveRegistration())!.revision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
