import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import {
  OperationsStreamConnectionLimiter,
  OperationsStreamHub,
} from "../lib/operations/operations-stream";
import { createOperationsRouter } from "./operations";

function firstFrame(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  frame: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          const boundary = body.indexOf("\n\n");
          if (boundary < 0) return;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            frame: body.slice(0, boundary + 2),
          });
          res.destroy();
          req.destroy();
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            frame: body,
          }),
        );
      },
    );
    req.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error);
    });
    req.end();
  });
}

test("operations SSE emits an authenticated-route snapshot with durable id and safe headers", async (t) => {
  const overviewCalls: unknown[] = [];
  const hub = new OperationsStreamHub({
    loadChanges: async () => [],
    autoStart: false,
  });
  const app = express();
  app.use(
    "/api",
    createOperationsRouter({
      environment: {
        OPS_SSE_MAX_CLIENTS: "2",
        OPERATIONS_STREAM_HEARTBEAT_MS: "1000",
        OPERATIONS_STREAM_MAX_DURATION_MS: "5000",
      },
      getOverview: async (input) => {
        overviewCalls.push(input);
        return {
          cursor: "7",
          runtime: { state: "live" },
        } as never;
      },
      streamHub: hub,
      streamLimiter: new OperationsStreamConnectionLimiter(2),
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const response = await firstFrame(
    address.port,
    "/api/ops/stream?windowHours=12&cursor=3",
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers["content-type"],
    "text/event-stream; charset=utf-8",
  );
  assert.equal(response.headers["cache-control"], "no-cache, no-transform");
  assert.equal(response.headers["x-accel-buffering"], "no");
  assert.equal(
    response.frame,
    'id: 7\nevent: snapshot\ndata: {"snapshot":{"cursor":"7","runtime":{"state":"live"}}}\n\n',
  );
  assert.deepEqual(overviewCalls, [{ windowHours: 12 }]);

  const futureCursor = await firstFrame(address.port, "/api/ops/stream", {
    "Last-Event-ID": "8",
  });
  assert.equal(futureCursor.status, 409);
  assert.match(futureCursor.frame, /ahead of the durable snapshot/u);
  assert.notEqual(
    futureCursor.headers["content-type"],
    "text/event-stream; charset=utf-8",
  );

  const invalidCursor = await firstFrame(address.port, "/api/ops/stream", {
    "Last-Event-ID": "01",
  });
  assert.equal(invalidCursor.status, 400);
  assert.match(invalidCursor.frame, /Invalid operations stream query/u);
});
