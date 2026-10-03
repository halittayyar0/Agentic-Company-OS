import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import test from "node:test";
import express from "express";
import {
  db,
  dbReady,
  closeDatabase,
  chatgptRegistrationsTable,
  chatgptRegistrationLocksTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { createOperatorAuth } from "../lib/operator-auth";
import { createPostgresChatGPTRegistrationStore } from "../lib/chatgpt-registration-store";
import { createChatGPTSignInController } from "../lib/chatgpt-sign-in";
import { createChatGPTSessionManager } from "../lib/chatgpt-session";
import { createChatGPTConnectionRouter } from "./chatgpt-connection";

test("operator connection routes keep tokens private, reject remote callbacks and fence explicit account selection", async () => {
  await dbReady;
  const store = await createPostgresChatGPTRegistrationStore(
    db,
    "fixture-route-encryption-key-not-a-human-secret",
  );
  const id = randomUUID(),
    hostId = await store.getHostId();
  await store.replaceRegistration(0, {
    id,
    hostId,
    clientId: "oaiapp_route_fixture",
    accountId: "fixture-route-account",
    subject: "fixture-route-subject",
    email: "route@example.test",
    credentials: {
      accessToken: "fixture-private-route-access",
      refreshToken: "fixture-private-route-refresh",
      idToken: "fixture-private-route-id",
      grants: [
        "openid",
        "offline_access",
        "resource.invoke",
        "chatgpt.tokens.use.direct",
      ],
      expiresAt: Date.now() + 3600_000,
    },
  });
  const unavailableFetch: typeof fetch = async () => {
    throw new Error("fixture-private-error-with-token");
  };
  const controller = createChatGPTSignInController({
    store,
    fetch: unavailableFetch,
  });
  const sessions = createChatGPTSessionManager({
    store,
    fetch: unavailableFetch,
  });
  const authToken = "fixture-operator-token-only-not-human-secret";
  const auth = createOperatorAuth({ token: authToken, secureCookies: false });
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    auth.requireAuthentication,
    createChatGPTConnectionRouter({
      store: async () => store,
      controller: async () => controller,
      sessions: async () => sessions,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/connections/chatgpt`;
  const request = async (
    path = "",
    method = "GET",
    body?: unknown,
    authorized = true,
    host?: string,
  ) => {
    const headers = {
      "Content-Type": "application/json",
      ...(authorized ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(host ? { Host: host } : {}),
    };
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const response = host
      ? await new Promise<{ status: number; raw: string }>(
          (resolve, reject) => {
            const native = httpRequest(
              base + path,
              { method, headers },
              (incoming) => {
                let raw = "";
                incoming.setEncoding("utf8");
                incoming.on("data", (part) => (raw += part));
                incoming.on("end", () =>
                  resolve({ status: incoming.statusCode!, raw }),
                );
                incoming.on("error", reject);
              },
            );
            native.on("error", reject);
            native.end(payload);
          },
        )
      : await fetch(base + path, {
          method,
          headers,
          ...(payload === undefined ? {} : { body: payload }),
        }).then(async (value) => ({
          status: value.status,
          raw: await value.text(),
        }));
    const raw = response.raw;
    for (const secret of [
      "fixture-private-route-access",
      "fixture-private-route-refresh",
      "fixture-private-error-with-token",
      hostId,
      ...(path === "/sign-in" && method === "POST"
        ? []
        : ["fixture-private-route-id", "oaiapp_route_fixture"]),
    ])
      assert.ok(!raw.includes(secret), raw);
    return { status: response.status, value: raw ? JSON.parse(raw) : null };
  };
  try {
    assert.equal((await request("", "GET", undefined, false)).status, 401);
    const initial = await request();
    assert.equal(initial.status, 200);
    assert.equal(initial.value.registrations[0].signedIn, true);
    assert.equal(initial.value.activeRegistrationId, null);
    assert.equal(
      (await request(`/accounts/${id}/select`, "POST", { expectedRevision: 0 }))
        .status,
      409,
    );
    assert.equal(await store.readActiveRegistration(), null);
    assert.equal(
      (
        await request(`/accounts/${id}/select`, "POST", {
          expectedRevision: 1,
          accessToken: "browser-injected-token",
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(`/accounts/${id}/select`, "POST", { expectedRevision: 1 }))
        .status,
      200,
    );
    assert.equal((await request()).value.activeRegistrationId, id);
    assert.equal((await request("/sign-in", "POST", {})).status, 400);
    assert.equal(
      (await request("/sign-in", "POST", { callbackLocation: "remote-server" }))
        .status,
      400,
    );
    assert.equal(
      (
        await request(
          "/sign-in",
          "POST",
          { callbackLocation: "same-computer", registrationId: id },
          true,
          "server.example.test",
        )
      ).status,
      422,
    );
    const attempt = await request("/sign-in", "POST", {
      callbackLocation: "same-computer",
      registrationId: id,
    });
    assert.equal(attempt.status, 201);
    const authorize = new URL(attempt.value.authorizeUrl);
    assert.equal(authorize.origin, "https://auth.openai.com");
    assert.equal(
      (
        await request(`/sign-in/${attempt.value.attemptId}/confirm`, "POST", {
          expectedRevision: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (await request(`/sign-in/${attempt.value.attemptId}`, "DELETE")).status,
      204,
    );
    assert.equal(
      (await request(`/sign-in/${attempt.value.attemptId}`)).value.state,
      "cancelled",
    );
    assert.equal((await request("/sign-in/not-a-uuid")).status, 400);
    assert.equal((await request(`/sign-in/${randomUUID()}`)).status, 404);
    const logout = await request(`/accounts/${id}/session`, "DELETE");
    assert.equal(logout.status, 200);
    assert.deepEqual(logout.value, {
      localSignedOut: true,
      revocationConfirmed: false,
    });
    assert.equal((await store.readRegistration(id))!.credentials, null);
    assert.equal((await request()).value.registrations[0].signedIn, false);
    assert.equal(
      (await request(`/accounts/${id}/select`, "POST", { expectedRevision: 2 }))
        .status,
      409,
    );
  } finally {
    await controller.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db
      .update(chatgptRegistrationLocksTable)
      .set({ activeRegistrationId: null })
      .where(eq(chatgptRegistrationLocksTable.activeRegistrationId, id));
    await db
      .delete(chatgptRegistrationsTable)
      .where(eq(chatgptRegistrationsTable.id, id));
    await closeDatabase();
  }
});
