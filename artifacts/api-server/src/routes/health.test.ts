import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import app from "../app";
import {
  markRuntimeReady,
  markRuntimeShuttingDown,
  resetRuntimeLifecycleForTests,
} from "../lib/runtime-lifecycle";
import { closeHttpServerWithin } from "../lib/runtime-shutdown";
import { dbReady } from "@workspace/db";

function get(
  port: number,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path,
        headers: { Host: `127.0.0.1:${port}` },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
  });
}

test("readiness reflects startup, database, and shutdown state", async (t) => {
  await dbReady;
  resetRuntimeLifecycleForTests();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => {
    resetRuntimeLifecycleForTests();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const starting = await get(address.port, "/api/readyz");
  assert.equal(starting.status, 503);

  markRuntimeReady();
  const ready = await get(address.port, "/api/readyz");
  assert.equal(ready.status, 200);
  assert.equal(JSON.parse(ready.body).checks.database, true);

  markRuntimeShuttingDown();
  const draining = await get(address.port, "/api/readyz");
  assert.equal(draining.status, 503);

  const live = await get(address.port, "/api/healthz");
  assert.equal(live.status, 200);
});

test("HTTP shutdown force-closes a lingering request and remains idempotent", async () => {
  let markRequestStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  const server = http.createServer(() => markRequestStarted());
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const request = http.get({
    host: "127.0.0.1",
    port: address.port,
    path: "/never-finishes",
  });
  request.once("error", () => undefined);
  await requestStarted;

  const startedAt = Date.now();
  await Promise.all([
    closeHttpServerWithin(server, 50),
    closeHttpServerWithin(server, 50),
  ]);
  assert.ok(Date.now() - startedAt < 1_000);
  request.destroy();
});
