import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import {
  createOperatorAuth,
  DEFAULT_OPERATOR_AUDIT_ID,
  matchesOperatorToken,
  readOperatorAuditId,
} from "./operator-auth";
import { createRateLimiter } from "./rate-limit";

const TOKEN = "test-operator-token-that-is-at-least-32-characters";

function request(
  port: number,
  input: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: input.path,
        method: input.method ?? "GET",
        headers: input.headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(input.body);
  });
}

async function listen(
  app: express.Express,
): Promise<{ server: http.Server; port: number }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, port: address.port };
}

test("operator tokens use digest-based constant-length comparison", () => {
  assert.equal(matchesOperatorToken(TOKEN, TOKEN), true);
  assert.equal(matchesOperatorToken("short", TOKEN), false);
  assert.equal(matchesOperatorToken(`${TOKEN}x`, TOKEN), false);
});

test("operator audit identity is stable, non-secret configuration", () => {
  assert.equal(readOperatorAuditId({}), DEFAULT_OPERATOR_AUDIT_ID);
  assert.equal(
    readOperatorAuditId({ OPERATOR_AUTH_TOKEN: TOKEN }),
    DEFAULT_OPERATOR_AUDIT_ID,
  );
  assert.equal(
    readOperatorAuditId({ OPERATOR_AUDIT_ID: "ops-primary" }),
    "ops-primary",
  );
  assert.equal(
    readOperatorAuditId({ OPERATOR_AUDIT_ID: "operator-e\u0301" }),
    "operator-é",
  );
  assert.throws(
    () => readOperatorAuditId({ OPERATOR_AUDIT_ID: " operator " }),
    /OPERATOR_AUDIT_ID/u,
  );
  assert.throws(
    () => readOperatorAuditId({ OPERATOR_AUDIT_ID: "ğ".repeat(129) }),
    /256 UTF-8 bytes/u,
  );
});

test("operator login is rate limited independently", async (t) => {
  const auth = createOperatorAuth({ token: TOKEN, secureCookies: true });
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth/login",
    createRateLimiter({ namespace: "test-login", max: 2, windowMs: 60_000 }),
  );
  app.use("/api/auth", auth.router);
  const { server, port } = await listen(app);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(port, {
      path: "/api/auth/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "wrong-token" }),
    });
    assert.equal(response.status, 401);
  }
  const limited = await request(port, {
    path: "/api/auth/login",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "60");
});

test("signed HttpOnly session and bearer auth protect operator routes", async (t) => {
  const auth = createOperatorAuth({ token: TOKEN, secureCookies: true });
  const app = express();
  app.use(express.json());
  app.use("/api/auth", auth.router);
  app.use("/api", auth.requireAuthentication);
  app.get("/api/protected", (_req, res) => res.json({ ok: true }));
  const { server, port } = await listen(app);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const denied = await request(port, { path: "/api/protected" });
  assert.equal(denied.status, 401);
  assert.match(denied.headers["www-authenticate"] ?? "", /^Bearer /);

  const login = await request(port, {
    path: "/api/auth/login",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers["set-cookie"]?.[0] ?? "";
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Strict/i);
  const cookie = setCookie.split(";", 1)[0];

  const cookieAccess = await request(port, {
    path: "/api/protected",
    headers: { Cookie: cookie },
  });
  assert.equal(cookieAccess.status, 200);

  const tamperedAccess = await request(port, {
    path: "/api/protected",
    headers: { Cookie: `${cookie}tampered` },
  });
  assert.equal(tamperedAccess.status, 401);

  const bearerAccess = await request(port, {
    path: "/api/protected",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(bearerAccess.status, 200);
});
