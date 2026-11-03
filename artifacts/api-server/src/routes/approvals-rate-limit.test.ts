import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import { createApprovalsRouter } from "./approvals";

test("approval review and decisions share a socket-address limit before authentication and database work", async (t) => {
  let authenticationCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createApprovalsRouter({
      resultReviewAuth: {
        enabled: true,
        authenticate: () => {
          authenticationCalls += 1;
          return { authenticated: false, sessionExpiresAt: null };
        },
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  let connections = 0;
  server.on("connection", () => {
    connections += 1;
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const request = (decision: boolean, attempt: number) =>
    new Promise<{ status: number; retryAfter: string | undefined }>(
      (resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port: address.port,
            path: `/api/approvals/1/${decision ? "decision" : "result-review"}`,
            method: decision ? "POST" : "GET",
            // The bucket must follow the peer address across new connections.
            // A pooled idle-socket race is unrelated to that security boundary.
            agent: false,
            headers: {
              "Content-Type": "application/json",
              "X-Forwarded-For": `192.0.2.${(attempt % 254) + 1}`,
            },
          },
          (res) => {
            res.once("error", fail);
            res.once("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                retryAfter: res.headers["retry-after"],
              }),
            );
            res.resume();
          },
        );
        function fail(error: NodeJS.ErrnoException) {
          const code =
            typeof error.code === "string" &&
            /^[A-Z0-9_]{1,40}$/u.test(error.code)
              ? error.code
              : "HTTP_FIXTURE_ERROR";
          reject(
            new Error(
              `Approval fixture transport failed: attempt=${attempt}, decision=${decision}, reusedSocket=${req.reusedSocket}, code=${code}`,
            ),
          );
        }
        req.once("error", fail);
        req.end(decision ? "{}" : undefined);
      },
    );
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const decision = attempt % 2 === 1;
    assert.equal(
      (await request(decision, attempt)).status,
      decision ? 400 : 401,
    );
  }
  assert.equal(authenticationCalls, 150);
  for (const decision of [false, true]) {
    const blocked = await request(decision, 301);
    assert.equal(blocked.status, 429);
    assert.ok(
      Number(blocked.retryAfter) > 0 && Number(blocked.retryAfter) <= 60,
    );
  }
  assert.equal(authenticationCalls, 150);
  assert.equal(
    connections,
    302,
    "the shared peer-address limit must hold across independent TCP connections",
  );
});
