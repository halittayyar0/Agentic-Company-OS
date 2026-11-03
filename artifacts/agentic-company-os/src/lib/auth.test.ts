import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setImmediate as nextTurn } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { getAuthStatus, login } from "./auth";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const validStatus = {
  enabled: true,
  authenticated: true,
  sessionExpiresAt: null,
};
const jsonResponse = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });

function deadline(t: TestContext) {
  const controller = new AbortController();
  const durations: number[] = [];
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    durations.push(milliseconds);
    return controller.signal;
  });
  return { controller, durations };
}

async function stalledPeer(t: TestContext, sendHeaders: boolean) {
  const received = deferred<void>(),
    readingBody = deferred<void>();
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    if (sendHeaders) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"enabled":true,');
    }
    received.resolve();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const nativeFetch = globalThis.fetch;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const response = await nativeFetch(new URL(String(input), base), init);
      const read = response.json.bind(response);
      response.json = () => {
        readingBody.resolve();
        return read();
      };
      return response;
    },
  );
  return {
    started: sendHeaders ? readingBody.promise : received.promise,
    requestCount: () => requests,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

for (const sendHeaders of [false, true]) {
  test(`auth status deadline rejects ${sendHeaders ? "a body stalled after HTTP200" : "a request with no response headers"}`, async (t) => {
    const timeout = deadline(t),
      peer = await stalledPeer(t, sendHeaders);
    const request = getAuthStatus();
    let rejected = false;
    void request.catch(() => {
      rejected = true;
    });
    try {
      await peer.started;
      timeout.controller.abort(
        new DOMException("Status deadline", "TimeoutError"),
      );
      await nextTurn();
      await nextTurn();
      assert.equal(
        rejected,
        true,
        "The status read must reject before a stalled response completes",
      );
      assert.deepEqual(timeout.durations, [15_000]);
      assert.equal(peer.requestCount(), 1);
      await assert.rejects(request);
    } finally {
      await peer.close();
      await request.catch(() => undefined);
    }
  });
}

test("caller cancellation aborts auth status while its response body is pending", async (t) => {
  deadline(t);
  const caller = new AbortController(),
    peer = await stalledPeer(t, true);
  const request = getAuthStatus(caller.signal);
  let rejected = false;
  void request.catch(() => {
    rejected = true;
  });
  try {
    await peer.started;
    caller.abort();
    await nextTurn();
    await nextTurn();
    assert.equal(rejected, true);
    await assert.rejects(request);
  } finally {
    await peer.close();
    await request.catch(() => undefined);
  }
});

test("a pre-aborted caller sends no auth request to the server", async (t) => {
  deadline(t);
  const caller = new AbortController(),
    peer = await stalledPeer(t, false);
  caller.abort();
  const request = getAuthStatus(caller.signal);
  let rejected = false;
  void request.catch(() => {
    rejected = true;
  });
  try {
    await nextTurn();
    await nextTurn();
    assert.equal(rejected, true);
    assert.equal(peer.requestCount(), 0);
    await assert.rejects(request);
  } finally {
    await peer.close();
    await request.catch(() => undefined);
  }
});

test("late valid auth data cannot authorize a read after its deadline", async (t) => {
  const timeout = deadline(t),
    response = deferred<Response>();
  t.mock.method(globalThis, "fetch", () => response.promise);
  const request = getAuthStatus();
  void request.catch(() => undefined);
  timeout.controller.abort(new DOMException("Status deadline", "TimeoutError"));
  response.resolve(jsonResponse(validStatus));
  await assert.rejects(request);
});

test("auth status keeps invalid payloads closed and accepts a complete valid status", async (t) => {
  deadline(t);
  let payload: unknown = null;
  t.mock.method(globalThis, "fetch", async () => jsonResponse(payload));
  for (payload of [
    null,
    false,
    {},
    { ...validStatus, authenticated: "true" },
    { ...validStatus, sessionExpiresAt: 123 },
  ]) {
    await assert.rejects(getAuthStatus());
  }
  payload = validStatus;
  assert.deepEqual(await getAuthStatus(), validStatus);
});

test("login writes remain single-dispatch and only the following status read gets a deadline", async (t) => {
  const timeout = deadline(t),
    written = deferred<Response>();
  const calls: { path: string; method: string; signalled: boolean }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const path = String(input);
      calls.push({
        path,
        method: init?.method ?? "GET",
        signalled: Boolean(init?.signal),
      });
      return path === "/api/auth/login"
        ? written.promise
        : Promise.resolve(jsonResponse(validStatus));
    },
  );
  const request = login("synthetic-fixture-key");
  await nextTurn();
  assert.deepEqual(timeout.durations, []);
  assert.deepEqual(calls, [
    { path: "/api/auth/login", method: "POST", signalled: false },
  ]);
  written.resolve(new Response(null, { status: 204 }));
  assert.deepEqual(await request, validStatus);
  assert.deepEqual(timeout.durations, [15_000]);
  assert.deepEqual(calls, [
    { path: "/api/auth/login", method: "POST", signalled: false },
    { path: "/api/auth/status", method: "GET", signalled: true },
  ]);
});
