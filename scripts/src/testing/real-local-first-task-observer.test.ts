import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import {
  observeOwnedFirstTask,
  type TaskReadSummary,
} from "./real-local-first-task-observer";

function fixture(responses: (Response | Error)[], deadline = 5000) {
  let clock = 0,
    reads = 0;
  const urls: string[] = [],
    methods: string[] = [],
    delays: number[] = [];
  const summary: TaskReadSummary = {
    attempts: 0,
    transientFailures: 0,
    lastFailure: null,
    lastTaskAt: null,
  };
  return {
    summary,
    urls,
    methods,
    delays,
    get reads() {
      return reads;
    },
    get clock() {
      return clock;
    },
    run: () =>
      observeOwnedFirstTask<{ status: string; id: number }>({
        baseUrl: "http://127.0.0.1:12345",
        operatorToken: "private-fixture-token",
        taskId: 1,
        deadline,
        summary,
        now: () => clock,
        sleep: async (ms) => {
          delays.push(ms);
          clock += ms;
        },
        fetch: (async (url, options) => {
          urls.push(String(url));
          methods.push(options?.method ?? "");
          assert.equal(new URL(String(url)).pathname, "/api/tasks/1");
          assert.equal(options?.method, "GET");
          const next = responses[reads++];
          if (next instanceof Error) throw next;
          assert.ok(next, "unexpected extra read or work replay");
          return next;
        }) as typeof fetch,
      }),
  };
}
const task = (status: string) => Response.json({ id: 1, status });

test("first-task observer follows the same work after a bounded rate-limited read", async () => {
  const f = fixture([
    task("in_progress"),
    new Response("private error body", {
      status: 429,
      headers: { "Retry-After": "1" },
    }),
    task("completed"),
  ]);
  assert.equal((await f.run()).status, "completed");
  assert.equal(f.reads, 3);
  assert.equal(new Set(f.urls).size, 1);
  assert.deepEqual(f.methods, ["GET", "GET", "GET"]);
  assert.deepEqual(f.delays, [1000, 1000]);
  assert.equal(f.summary.transientFailures, 1);
  assert.equal(f.summary.lastFailure?.status, 429);
  assert.ok(!JSON.stringify(f.summary).includes("private"));
});

test("first-task observer never retries terminal state, authentication or malformed data", async () => {
  const blocked = fixture([task("blocked")]);
  assert.equal((await blocked.run()).status, "blocked");
  assert.equal(blocked.reads, 1);
  for (const response of [
    new Response("private body", { status: 401 }),
    new Response("not json", { status: 200 }),
  ]) {
    const f = fixture([response]);
    await assert.rejects(f.run());
    assert.equal(f.reads, 1);
    assert.deepEqual(f.delays, []);
  }
});

test("first-task observer preserves its absolute deadline and transient-read cap without leaking exception text", async () => {
  const network = fixture([
    new TypeError("private connection detail"),
    task("completed"),
  ]);
  assert.equal((await network.run()).status, "completed");
  assert.equal(network.summary.lastFailure?.kind, "network");
  assert.ok(!JSON.stringify(network.summary).includes("private"));
  for (const backoff of [
    "10",
    "7200",
    "100000",
    "999999999999999999999999999999",
  ]) {
    const expired = fixture(
      [
        new Response("", { status: 429, headers: { "Retry-After": backoff } }),
        task("completed"),
      ],
      2000,
    );
    await assert.rejects(expired.run(), /task_observation_deadline/u);
    assert.equal(expired.clock, 2000);
    assert.equal(expired.reads, 1);
  }
  const persistent = fixture(
    Array.from({ length: 4 }, () => new Response("", { status: 503 })),
    15000,
  );
  await assert.rejects(persistent.run(), /task_observation_transient_limit/u);
  assert.equal(persistent.reads, 4);
  assert.deepEqual(persistent.methods, ["GET", "GET", "GET", "GET"]);
});

test("first-task observer distinguishes a real disconnected response body from malformed JSON", async () => {
  let reads = 0;
  const server = createServer((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/api/tasks/1");
    reads++;
    response.writeHead(200, { "Content-Type": "application/json" });
    if (reads === 1) {
      response.flushHeaders();
      response.write('{"status":');
      setTimeout(() => response.destroy(), 30);
    } else response.end(JSON.stringify({ id: 1, status: "completed" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const summary: TaskReadSummary = {
      attempts: 0,
      transientFailures: 0,
      lastFailure: null,
      lastTaskAt: null,
    };
    const result = await observeOwnedFirstTask({
      baseUrl: "http://127.0.0.1:" + address.port,
      operatorToken: "private-fixture-token",
      taskId: 1,
      deadline: Date.now() + 5000,
      summary,
      sleep: async () => undefined,
    });
    assert.equal(result.status, "completed");
    assert.equal(reads, 2);
    assert.equal(summary.transientFailures, 1);
    assert.equal(summary.lastFailure?.kind, "network");
    assert.equal(summary.lastFailure?.status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
