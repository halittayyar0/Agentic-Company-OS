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
            headers: {
              "Content-Type": "application/json",
              "X-Forwarded-For": `192.0.2.${(attempt % 254) + 1}`,
            },
          },
          (res) => {
            res.resume();
            res.once("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                retryAfter: res.headers["retry-after"],
              }),
            );
          },
        );
        req.once("error", reject);
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
});
