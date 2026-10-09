import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import test from "node:test";
import type {
  ChatGPTRegistration,
  ChatGPTRegistrationAccess,
  ChatGPTRegistrationStore,
} from "@workspace/ai-server/chatgpt-plan-types";
import { ChatGPTRegistrationConflict } from "./chatgpt-registration-store";
import { createChatGPTSignInController } from "./chatgpt-sign-in";
import { createChatGPTSessionManager } from "./chatgpt-session";
import { runChatGPTConnectionCLI } from "./chatgpt-cli";

async function fixture(
  action: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>,
) {
  const value = await createFixture();
  try {
    await action(value);
  } finally {
    await value.controller.close();
    value.server.closeAllConnections();
    await new Promise<void>((resolve) => value.server.close(() => resolve()));
  }
}

async function createFixture() {
  let now = Date.now();
  const hostId = `urn:uuid:${randomUUID()}`;
  const registrations = new Map<string, ChatGPTRegistration>();
  let activeId: string | null = null,
    queue = Promise.resolve();
  let replacementGate: Promise<void> | undefined,
    replacementRequests = 0;
  const projection = (record: ChatGPTRegistration) => ({
    id: record.id,
    accountId: record.accountId,
    email: record.email,
    revision: record.revision,
    signedIn: record.credentials !== null,
    canUsePlan: !!record.credentials?.grants.includes(
      "chatgpt.tokens.use.direct",
    ),
    expiresAt: record.credentials?.expiresAt ?? null,
  });
  const access: ChatGPTRegistrationAccess = {
    getHostId: async () => hostId,
    readRegistration: async (id) =>
      structuredClone(registrations.get(id) ?? null),
    readActiveRegistration: async () =>
      structuredClone(activeId ? (registrations.get(activeId) ?? null) : null),
    activateRegistration: async (id, expectedRevision) => {
      if (registrations.get(id)?.revision !== expectedRevision)
        throw new ChatGPTRegistrationConflict();
      activeId = id;
    },
    readPublicStatus: async (id) => {
      const record = registrations.get(id);
      return record ? projection(record) : null;
    },
    listPublicStatus: async () => [...registrations.values()].map(projection),
    replaceRegistration: async (expectedRevision, input) => {
      if ((registrations.get(input.id)?.revision ?? 0) !== expectedRevision)
        throw new ChatGPTRegistrationConflict();
      replacementRequests++;
      if (replacementGate) await replacementGate;
      const saved = {
        ...structuredClone(input),
        revision: expectedRevision + 1,
        updatedAt: now,
      };
      registrations.set(input.id, saved);
      return structuredClone(saved);
    },
  };
  const store: ChatGPTRegistrationStore = {
    ...access,
    withRegistrationRefreshLock: async (_id, action) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => (release = resolve));
      await previous;
      try {
        return await action(access);
      } finally {
        release();
      }
    },
  };
  const old: ChatGPTRegistration = {
    id: randomUUID(),
    hostId,
    clientId: "oaiapp_existing",
    accountId: createHash("sha256")
      .update(
        JSON.stringify([
          "https://auth.openai.com",
          "oaiapp_existing",
          "existing-subject",
        ]),
      )
      .digest("hex"),
    subject: "existing-subject",
    email: "same@example.test",
    revision: 1,
    updatedAt: now,
    credentials: {
      accessToken: "existing-access",
      refreshToken: "existing-refresh",
      idToken: "existing-id-hint",
      grants: [
        "openid",
        "offline_access",
        "resource.invoke",
        "chatgpt.tokens.use.direct",
      ],
      expiresAt: now + 3600_000,
    },
  };
  registrations.set(old.id, old);
  activeId = old.id;
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  let tokenRequests = 0,
    tokenFailure: number | null = null,
    identityOnly = false;
  let exchangeGate: Promise<void> | undefined;
  let latestRefresh = "existing-refresh",
    revocationRequests = 0,
    revocationFailure: number | null = null;
  let wrongSubject = false,
    revocationEndpoint = "https://auth.openai.com/api/accounts/oauth/revoke";
  const authorizations = new Map<string, URL>();
  const forms: URLSearchParams[] = [];
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/.well-known/jwks.json") {
      response.end(
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
      );
      return;
    }
    if (request.url === "/.well-known/openid-configuration") {
      response.end(
        JSON.stringify({
          issuer: "https://auth.openai.com",
          revocation_endpoint: revocationEndpoint,
        }),
      );
      return;
    }
    assert.ok(
      ["/api/accounts/oauth/token", "/api/accounts/oauth/revoke"].includes(
        request.url!,
      ),
    );
    assert.equal(request.method, "POST");
    assert.match(
      String(request.headers["content-type"]),
      /application\/x-www-form-urlencoded/,
    );
    let body = "";
    for await (const chunk of request) body += chunk;
    const form = new URLSearchParams(body);
    forms.push(form);
    if (request.url === "/api/accounts/oauth/revoke") {
      revocationRequests++;
      assert.equal(form.get("client_id"), old.clientId);
      assert.equal(form.get("token_type_hint"), "refresh_token");
      assert.equal(form.get("token"), latestRefresh);
      if (revocationFailure) {
        response.writeHead(revocationFailure);
        response.end("temporary fixture outage");
      } else {
        response.end();
      }
      return;
    }
    tokenRequests++;
    if (exchangeGate) await exchangeGate;
    const refresh = form.get("grant_type") === "refresh_token";
    const authorization = refresh
      ? undefined
      : authorizations.get(form.get("code")!);
    if (!refresh) {
      assert.ok(authorization);
      assert.equal(form.get("grant_type"), "authorization_code");
      assert.equal(
        form.get("redirect_uri"),
        authorization.searchParams.get("redirect_uri"),
      );
      assert.equal(
        createHash("sha256")
          .update(form.get("code_verifier")!)
          .digest("base64url"),
        authorization.searchParams.get("code_challenge"),
      );
    } else {
      assert.equal(form.has("scope"), false);
      assert.equal(form.has("code_verifier"), false);
      if (form.get("refresh_token") !== latestRefresh) {
        response.writeHead(400);
        response.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
    }
    assert.equal(form.get("resource"), "https://api.openai.com/v1");
    assert.equal(form.has("client_secret"), false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (tokenFailure) {
      response.writeHead(tokenFailure);
      response.end(
        JSON.stringify({
          error:
            tokenFailure === 400
              ? "invalid_grant"
              : "temporary_fixture_failure",
        }),
      );
      return;
    }
    const clientId = form.get("client_id")!;
    const claims = {
      iss: "https://auth.openai.com",
      aud: clientId,
      sub: wrongSubject
        ? "wrong-account-subject"
        : clientId === old.clientId
          ? old.subject
          : "new-subject",
      ...(authorization
        ? { nonce: authorization.searchParams.get("nonce") }
        : {}),
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 3600,
      email: "same@example.test",
      name: "Fixture Account",
    };
    const prefix = `${Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
    const idToken = `${prefix}.${sign("RSA-SHA256", Buffer.from(prefix), privateKey).toString("base64url")}`;
    if (refresh) latestRefresh = `rotated-refresh-${tokenRequests}`;
    response.end(
      JSON.stringify({
        token_type: "Bearer",
        access_token: refresh
          ? `rotated-access-${tokenRequests}`
          : "new-access-secret",
        refresh_token: refresh ? latestRefresh : "new-refresh-secret",
        id_token: idToken,
        expires_in: 3600,
        scope: identityOnly
          ? "openid profile email"
          : "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://auth.openai.com");
    return fetch(`http://127.0.0.1:${address.port}${url.pathname}`, init);
  };
  const controller = createChatGPTSignInController({
    store,
    now: () => now,
    fetch: request,
  });
  const sessions = createChatGPTSessionManager({
    store,
    now: () => now,
    fetch: request,
  });
  return {
    request,
    store,
    old,
    registrations,
    controller,
    sessions,
    anotherSessionManager: () =>
      createChatGPTSessionManager({ store, now: () => now, fetch: request }),
    server,
    forms,
    advance: (milliseconds: number) => (now += milliseconds),
    tokenRequests: () => tokenRequests,
    failure: (status: number | null) => (tokenFailure = status),
    revocationFailure: (status: number | null) => (revocationFailure = status),
    revocationRequests: () => revocationRequests,
    wrongSubject: () => (wrongSubject = true),
    foreignRevocationEndpoint: () =>
      (revocationEndpoint = "https://untrusted.example/steal"),
    identityOnly: () => (identityOnly = true),
    pauseExchange: () => {
      let release!: () => void;
      exchangeGate = new Promise<void>((resolve) => (release = resolve));
      return release;
    },
    pauseReplacement: () => {
      let release!: () => void;
      replacementGate = new Promise<void>((resolve) => (release = resolve));
      return release;
    },
    replacementRequests: () => replacementRequests,
    callback: async (
      attempt: { attemptId: string; authorizeUrl: string },
      overrides: Record<string, string | null> = {},
    ) => {
      const authorization = new URL(attempt.authorizeUrl),
        code = randomUUID();
      authorizations.set(code, authorization);
      const callback = new URL(authorization.searchParams.get("redirect_uri")!);
      callback.searchParams.set(
        "state",
        authorization.searchParams.get("state")!,
      );
      callback.searchParams.set("code", code);
      if (
        authorization.searchParams.get("client_id") === "dynamic_agent_client"
      )
        callback.searchParams.set("client_id", "oaiapp_fixture_new");
      for (const [key, value] of Object.entries(overrides)) {
        if (value === null) callback.searchParams.delete(key);
        else callback.searchParams.set(key, value);
      }
      return fetch(callback);
    },
  };
}

test("official loopback PKCE sign-in preserves the active account until explicit confirmation", async () => {
  await fixture(async (f) => {
    const attempt = await f.controller.beginSignIn();
    assert.deepEqual(Object.keys(attempt).sort(), [
      "attemptId",
      "authorizeUrl",
      "expiresAt",
    ]);
    const url = new URL(attempt.authorizeUrl);
    assert.equal(
      url.origin + url.pathname,
      "https://auth.openai.com/api/accounts/authorize",
    );
    assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
    assert.equal(url.searchParams.get("agent_name_hint"), "Agentic Company OS");
    assert.equal(url.searchParams.get("ext_agent_host_id"), f.old.hostId);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const redirect = new URL(url.searchParams.get("redirect_uri")!);
    assert.equal(redirect.hostname, "127.0.0.1");
    assert.equal(redirect.pathname, "/auth/callback");
    assert.equal((await f.callback(attempt)).status, 200);
    const pending = await f.controller.readSignInStatus(attempt.attemptId);
    assert.equal(pending.state, "review");
    assert.equal(pending.proposedAccount?.canUsePlan, true);
    assert.ok(!JSON.stringify(pending).includes("secret"));
    assert.ok(!JSON.stringify(pending).includes("idToken"));
    assert.equal(f.registrations.size, 1);
    assert.equal((await f.store.readActiveRegistration())?.id, f.old.id);
    await f.controller.confirmAccount(attempt.attemptId, 0);
    assert.equal(f.registrations.size, 2);
    assert.notEqual((await f.store.readActiveRegistration())?.id, f.old.id);
    await assert.rejects(f.controller.confirmAccount(attempt.attemptId, 0));
    assert.equal(f.tokenRequests(), 1);
  });
});

test("wrong state, denied consent, missing or wrong issued client cannot replace an account", async () => {
  for (const kind of [
    "wrong-state",
    "denied",
    "missing-client",
    "wrong-returning-client",
  ] as const)
    await fixture(async (f) => {
      const attempt = await f.controller.beginSignIn(
        kind === "wrong-returning-client" ? { registrationId: f.old.id } : {},
      );
      const overrides: Record<string, string | null> =
        kind === "wrong-state"
          ? { state: "forged" }
          : kind === "denied"
            ? { error: "access_denied", code: null }
            : kind === "missing-client"
              ? { client_id: null }
              : { client_id: "oaiapp_wrong" };
      const response = await f.callback(attempt, overrides);
      assert.ok(response.status >= 400 || kind === "denied");
      const status = await f.controller.readSignInStatus(attempt.attemptId);
      assert.equal(
        status.state,
        kind === "wrong-state"
          ? "pending"
          : kind === "denied"
            ? "denied"
            : "failed",
      );
      assert.equal(f.tokenRequests(), 0);
      assert.equal(
        (await f.store.readActiveRegistration())?.credentials?.accessToken,
        "existing-access",
      );
    });
});

test("cancelled and expired sign-in listeners reject callbacks without network exchange", async () => {
  for (const cancelled of [true, false])
    await fixture(async (f) => {
      const attempt = await f.controller.beginSignIn();
      if (cancelled) await f.controller.cancelSignIn(attempt.attemptId);
      else f.advance(11 * 60_000);
      assert.equal(
        (await f.controller.readSignInStatus(attempt.attemptId)).state,
        cancelled ? "cancelled" : "expired",
      );
      await assert.rejects(f.callback(attempt));
      assert.equal(f.tokenRequests(), 0);
      assert.equal(f.registrations.size, 1);
    });
});

test("identity-only grants cannot be upgraded by callback scope; returning consent reuses issued client", async () => {
  await fixture(async (f) => {
    f.identityOnly();
    const attempt = await f.controller.beginSignIn({
      registrationId: f.old.id,
    });
    const url = new URL(attempt.authorizeUrl);
    assert.equal(url.searchParams.get("client_id"), f.old.clientId);
    assert.equal(url.searchParams.has("agent_name_hint"), false);
    assert.equal(
      url.searchParams.get("id_token_hint"),
      f.old.credentials!.idToken,
    );
    assert.equal(
      (
        await f.callback(attempt, {
          client_id: null,
          scope: "resource.invoke chatgpt.tokens.use.direct",
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.controller.readSignInStatus(attempt.attemptId)).proposedAccount
        ?.canUsePlan,
      false,
    );
    await assert.rejects(
      f.controller.confirmAccount(attempt.attemptId, 0),
      ChatGPTRegistrationConflict,
    );
    await f.controller.confirmAccount(attempt.attemptId, 1);
    assert.equal((await f.store.readPublicStatus(f.old.id))?.canUsePlan, false);
  });
});

test("temporary exchange failure retains issued client for a fresh attempt and preserves old credentials", async () => {
  await fixture(async (f) => {
    f.failure(503);
    const attempt = await f.controller.beginSignIn();
    assert.equal((await f.callback(attempt)).status, 503);
    assert.equal(
      (await f.controller.readSignInStatus(attempt.attemptId)).failureKind,
      "temporary",
    );
    const retry = await f.controller.beginSignIn({
      retryAttemptId: attempt.attemptId,
    });
    const before = new URL(attempt.authorizeUrl),
      after = new URL(retry.authorizeUrl);
    assert.equal(after.searchParams.get("client_id"), "oaiapp_fixture_new");
    assert.notEqual(
      after.searchParams.get("state"),
      before.searchParams.get("state"),
    );
    assert.notEqual(
      after.searchParams.get("nonce"),
      before.searchParams.get("nonce"),
    );
    assert.notEqual(
      after.searchParams.get("code_challenge"),
      before.searchParams.get("code_challenge"),
    );
    assert.equal(after.searchParams.has("agent_name_hint"), false);
    f.failure(null);
    assert.equal((await f.callback(retry, { client_id: null })).status, 200);
    assert.equal(
      (await f.store.readActiveRegistration())?.credentials?.accessToken,
      "existing-access",
    );
  });
});

test("incorrect callback route, Host and duplicate parameters leave the legitimate attempt available", async () => {
  await fixture(async (f) => {
    const attempt = await f.controller.beginSignIn(),
      authorization = new URL(attempt.authorizeUrl);
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    callback.searchParams.set(
      "state",
      authorization.searchParams.get("state")!,
    );
    callback.searchParams.set("code", "forged-code");
    callback.searchParams.set("client_id", "oaiapp_fixture_new");
    const wrongPath = new URL(callback);
    wrongPath.pathname = "/callback";
    assert.equal((await fetch(wrongPath)).status, 404);
    const wrongHostStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        callback,
        { headers: { Host: "wrong.example" } },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode!));
        },
      );
      request.once("error", reject);
      request.end();
    });
    assert.equal(wrongHostStatus, 400);
    callback.searchParams.append(
      "state",
      authorization.searchParams.get("state")!,
    );
    assert.equal((await fetch(callback)).status, 400);
    assert.equal(
      (await f.controller.readSignInStatus(attempt.attemptId)).state,
      "pending",
    );
    assert.equal(f.tokenRequests(), 0);
    assert.equal((await f.callback(attempt)).status, 200);
  });
});

test("concurrent callback replay exchanges one code and cannot auto-select a candidate", async () => {
  await fixture(async (f) => {
    const attempt = await f.controller.beginSignIn();
    const responses = await Promise.all([
      f.callback(attempt),
      f.callback(attempt),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 409],
    );
    assert.equal(f.tokenRequests(), 1);
    assert.equal(f.registrations.size, 1);
    assert.equal(
      (await f.controller.readSignInStatus(attempt.attemptId)).state,
      "review",
    );
  });
});

test("cancellation during a token exchange fences late credentials and closes the listener", async () => {
  await fixture(async (f) => {
    const release = f.pauseExchange();
    try {
      const attempt = await f.controller.beginSignIn();
      const callback = f.callback(attempt).then(
        (response) => response,
        (error: unknown) => error,
      );
      const deadline = Date.now() + 2000;
      while (f.tokenRequests() === 0 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(f.tokenRequests(), 1);
      await f.controller.cancelSignIn(attempt.attemptId);
      assert.ok((await callback) instanceof Error);
      release();
      assert.equal(
        (await f.controller.readSignInStatus(attempt.attemptId)).state,
        "cancelled",
      );
      assert.equal(f.registrations.size, 1);
      assert.equal(
        (await f.store.readActiveRegistration())?.credentials?.accessToken,
        "existing-access",
      );
    } finally {
      release();
    }
  });
});

test("a worker rotation during account review prevents stale confirmation from replacing valid credentials", async () => {
  await fixture(async (f) => {
    const attempt = await f.controller.beginSignIn({
      registrationId: f.old.id,
    });
    assert.equal((await f.callback(attempt, { client_id: null })).status, 200);
    await f.store.replaceRegistration(1, {
      ...f.old,
      credentials: { ...f.old.credentials!, accessToken: "working-rotation" },
    });
    await assert.rejects(
      f.controller.confirmAccount(attempt.attemptId, 1),
      ChatGPTRegistrationConflict,
    );
    assert.equal(
      (await f.store.readActiveRegistration())?.credentials?.accessToken,
      "working-rotation",
    );
  });
});

test("an explicitly confirmed account save exposes its committing phase and cannot falsely report cancellation", async () => {
  await fixture(async (f) => {
    const attempt = await f.controller.beginSignIn();
    assert.equal((await f.callback(attempt)).status, 200);
    const release = f.pauseReplacement();
    const confirmation = f.controller.confirmAccount(attempt.attemptId, 0);
    try {
      const deadline = Date.now() + 2000;
      while (f.replacementRequests() === 0 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(f.replacementRequests(), 1);
      assert.equal(
        (await f.controller.readSignInStatus(attempt.attemptId)).state,
        "confirming",
      );
      await assert.rejects(
        f.controller.cancelSignIn(attempt.attemptId),
        /confirmation_in_progress/,
      );
      assert.equal((await f.store.readActiveRegistration())?.id, f.old.id);
    } finally {
      release();
      await confirmation;
    }
    assert.equal(
      (await f.controller.readSignInStatus(attempt.attemptId)).state,
      "connected",
    );
    assert.notEqual((await f.store.readActiveRegistration())?.id, f.old.id);
  });
});

test("independent session owners renew one rotating token and persist one complete new credential bundle", async () => {
  await fixture(async (f) => {
    f.advance(3600_001);
    const other = f.anotherSessionManager();
    const results = await Promise.all([
      f.sessions.renewRegistration(f.old.id),
      other.renewRegistration(f.old.id),
    ]);
    assert.equal(f.tokenRequests(), 1);
    assert.deepEqual(
      results.map((record) => record.revision),
      [2, 2],
    );
    const current = (await f.store.readRegistration(f.old.id))!;
    assert.equal(current.clientId, f.old.clientId);
    assert.equal(current.subject, f.old.subject);
    assert.equal(current.credentials?.refreshToken, "rotated-refresh-1");
    assert.equal(current.credentials?.accessToken, "rotated-access-1");
    assert.ok(current.credentials?.idToken.includes("."));
    assert.ok(
      !JSON.stringify(await f.store.readPublicStatus(f.old.id)).includes(
        "refresh",
      ),
    );
  });
});

test("temporary renewal failure preserves old tokens while confirmed invalid_grant removes only credentials", async () => {
  for (const status of [503, 400])
    await fixture(async (f) => {
      f.advance(3600_001);
      f.failure(status);
      await assert.rejects(
        f.sessions.renewRegistration(f.old.id),
        status === 503 ? /session_temporary/ : /session_sign_in_required/,
      );
      const saved = (await f.store.readRegistration(f.old.id))!;
      assert.equal(saved.clientId, f.old.clientId);
      assert.equal(saved.hostId, f.old.hostId);
      assert.equal(
        saved.credentials?.refreshToken ?? null,
        status === 503 ? "existing-refresh" : null,
      );
      assert.equal(f.tokenRequests(), status === 503 ? 2 : 1);
    });
});

test("a refresh signed for another account cannot replace the selected registration", async () => {
  await fixture(async (f) => {
    f.advance(3600_001);
    f.wrongSubject();
    await assert.rejects(
      f.sessions.renewRegistration(f.old.id),
      /session_refresh_unconfirmed/,
    );
    assert.equal(
      (await f.store.readRegistration(f.old.id))?.credentials?.refreshToken,
      "existing-refresh",
    );
    assert.equal((await f.store.readRegistration(f.old.id))?.revision, 1);
  });
});

test("sign-out distinguishes confirmed remote revocation, local-only failure and unsafe metadata", async () => {
  for (const kind of ["confirmed", "temporary", "foreign-endpoint"] as const)
    await fixture(async (f) => {
      if (kind === "temporary") f.revocationFailure(503);
      if (kind === "foreign-endpoint") f.foreignRevocationEndpoint();
      const result = await f.sessions.signOut(f.old.id);
      assert.equal(result.localSignedOut, true);
      assert.equal(result.revocationConfirmed, kind === "confirmed");
      assert.equal(
        f.revocationRequests(),
        kind === "confirmed" ? 1 : kind === "temporary" ? 2 : 0,
      );
      const saved = (await f.store.readRegistration(f.old.id))!;
      assert.equal(saved.credentials, null);
      assert.equal(saved.clientId, f.old.clientId);
      assert.equal(saved.hostId, f.old.hostId);
    });
});

test("a future refresh floor pauses an expired session without sending a request", async () => {
  await fixture(async (f) => {
    await f.store.replaceRegistration(1, {
      ...f.old,
      credentials: {
        ...f.old.credentials!,
        expiresAt: f.old.updatedAt - 1000,
        earliestRefreshAt: f.old.updatedAt + 60_000,
      },
    });
    await assert.rejects(
      f.sessions.renewRegistration(f.old.id),
      /session_refresh_deferred/,
    );
    assert.equal(f.tokenRequests(), 0);
    assert.equal(
      (await f.store.readRegistration(f.old.id))?.credentials?.refreshToken,
      "existing-refresh",
    );
  });
});

test("interactive CLI sign-in validates the loopback exchange and preserves selection when account confirmation is declined", async () => {
  for (const accept of [true, false])
    await fixture(async (f) => {
      const output: string[] = [],
        errors: string[] = [];
      const exit = await runChatGPTConnectionCLI(
        ["sign-in", "--same-computer"],
        {
          store: async () => f.store,
          fetch: f.request,
          write: (value) => output.push(value),
          writeError: (value) => errors.push(value),
          openAuthorization: async (authorizeUrl) => {
            assert.equal(
              (await f.callback({ attemptId: randomUUID(), authorizeUrl }))
                .status,
              200,
            );
          },
          confirm: async (account) => {
            assert.equal(account.canUsePlan, true);
            return accept;
          },
        },
      );
      assert.equal(exit, accept ? 0 : 1);
      assert.deepEqual(errors, []);
      assert.equal(
        (await f.store.readActiveRegistration())!.id === f.old.id,
        !accept,
      );
      assert.equal(f.tokenRequests(), 1);
      for (const secret of [
        "new-refresh-secret",
        "new-access-secret",
        "existing-id-hint",
      ])
        assert.ok(!output.join("\n").includes(secret));
    });
});

test("returning CLI sign-in refuses to print an ID-token hint in a manual authorization link", async () => {
  await fixture(async (f) => {
    const output: string[] = [],
      errors: string[] = [];
    assert.equal(
      await runChatGPTConnectionCLI(
        [
          "sign-in",
          "--same-computer",
          "--registration",
          f.old.id,
          "--manual-link",
        ],
        {
          store: async () => f.store,
          fetch: f.request,
          write: (value) => output.push(value),
          writeError: (value) => errors.push(value),
          confirm: async () => true,
        },
      ),
      1,
    );
    assert.equal(f.tokenRequests(), 0);
    assert.ok(![...output, ...errors].join("\n").includes("existing-id-hint"));
    assert.equal((await f.store.readActiveRegistration())!.id, f.old.id);
  });
});

test("plan consent is requested only when explicitly enabling it on a selected saved account", async () => {
  await fixture(async (f) => {
    const ordinary = await f.controller.beginSignIn({
      registrationId: f.old.id,
    });
    assert.equal(
      new URL(ordinary.authorizeUrl).searchParams.has("prompt"),
      false,
    );
    const enabling = await f.controller.beginSignIn({
      registrationId: f.old.id,
      requestPlanPermission: true,
    });
    assert.equal(
      new URL(enabling.authorizeUrl).searchParams.get("prompt"),
      "consent",
    );
    assert.equal(
      new URL(enabling.authorizeUrl).searchParams.get("client_id"),
      f.old.clientId,
    );
    await assert.rejects(
      f.controller.beginSignIn({ requestPlanPermission: true }),
      /input_invalid/,
    );
    assert.equal((await f.store.readActiveRegistration())!.revision, 1);
  });
});
