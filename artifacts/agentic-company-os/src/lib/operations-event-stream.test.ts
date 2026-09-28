import assert from "node:assert/strict";
import test from "node:test";

import {
  createOperationsStreamClient,
  operationsStreamScopeKey,
  operationsStreamUrl,
  type EventSourceLike,
} from "./operations-event-stream";

class FakeEventSource implements EventSourceLike {
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  closed = false;

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const bucket = this.listeners.get(type) ?? new Set();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, input: { data?: unknown; id?: string } = {}) {
    const event = {
      data:
        typeof input.data === "string"
          ? input.data
          : JSON.stringify(input.data ?? {}),
      lastEventId: input.id ?? "",
    } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function manualRuntime(start = "2026-09-01T12:00:00.000Z") {
  let nowMs = new Date(start).getTime();
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => new Date(nowMs),
    setTimeout(callback: () => void, delayMs: number) {
      const id = nextId++;
      timers.set(id, { at: nowMs + delayMs, callback });
      return id;
    },
    clearTimeout(id: unknown) {
      timers.delete(Number(id));
    },
    advance(ms: number) {
      nowMs += ms;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= nowMs)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        due[1].callback();
      }
    },
    pendingTimers: () => timers.size,
  };
}

test("operations stream URLs are same-origin, scoped, and contain no credentials", () => {
  assert.equal(operationsStreamScopeKey({ scope: "global" }), "global");
  assert.equal(
    operationsStreamScopeKey({ scope: "project", taskId: 42 }),
    "project:42",
  );
  assert.equal(operationsStreamUrl({ scope: "global" }), "/api/ops/stream");
  assert.equal(
    operationsStreamUrl({ scope: "project", taskId: 42 }),
    "/api/ops/stream?taskId=42",
  );
  assert.throws(
    () => operationsStreamUrl({ scope: "project", taskId: 0 }),
    /positive integer/,
  );
});

test("visible heartbeats keep transport live without inventing durable activity", () => {
  const runtime = manualRuntime();
  const source = new FakeEventSource();
  const snapshots: unknown[] = [];
  const client = createOperationsStreamClient({
    scope: { scope: "project", taskId: 101 },
    eventSourceFactory: () => source,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    runtime,
    staleAfterMs: 10_000,
    disconnectedAfterMs: 30_000,
  });

  assert.equal(client.getSnapshot().state, "connecting");
  source.emit("snapshot", {
    id: "9007199254740993",
    data: { generatedAt: "2026-09-01T12:00:00.000Z", rootTask: { id: 101 } },
  });
  assert.equal(client.getSnapshot().state, "live");
  assert.equal(client.getSnapshot().lastEventId, "9007199254740993");
  assert.equal(client.getSnapshot().lastEventAt, "2026-09-01T12:00:00.000Z");
  assert.equal(snapshots.length, 1);

  runtime.advance(9_000);
  source.emit("heartbeat", { data: { at: runtime.now().toISOString() } });
  assert.equal(client.getSnapshot().state, "live");
  assert.equal(client.getSnapshot().lastEventId, "9007199254740993");
  assert.equal(client.getSnapshot().lastEventAt, "2026-09-01T12:00:00.000Z");
  assert.equal(
    client.getSnapshot().transportLastFrameAt,
    "2026-09-01T12:00:09.000Z",
  );

  runtime.advance(10_001);
  assert.equal(client.getSnapshot().state, "stale");
  runtime.advance(20_000);
  assert.equal(client.getSnapshot().state, "disconnected");
  client.destroy();
  assert.equal(source.closed, true);
  assert.equal(runtime.pendingTimers(), 0);
});

test("durable cursor handling rejects malformed, duplicate, and out-of-order frames", () => {
  const runtime = manualRuntime();
  const source = new FakeEventSource();
  const snapshots: unknown[] = [];
  const cursors: Array<string | undefined> = [];
  const client = createOperationsStreamClient({
    scope: { scope: "global" },
    eventSourceFactory: () => source,
    onSnapshot: (snapshot, cursor) => {
      snapshots.push(snapshot);
      cursors.push(cursor);
    },
    runtime,
  });

  source.emit("snapshot", {
    id: "41",
    data: { generatedAt: runtime.now().toISOString(), n: 1 },
  });
  source.emit("snapshot", {
    id: "041",
    data: { generatedAt: runtime.now().toISOString(), n: 2 },
  });
  source.emit("snapshot", {
    id: "41",
    data: { generatedAt: runtime.now().toISOString(), n: 3 },
  });
  source.emit("snapshot", { id: "42", data: "null" });
  source.emit("activity", {
    id: "40",
    data: { snapshot: { generatedAt: runtime.now().toISOString(), n: 4 } },
  });
  source.emit("receipt", {
    id: "43",
    data: { snapshot: { generatedAt: runtime.now().toISOString(), n: 5 } },
  });

  assert.deepEqual(
    snapshots.map((entry) => (entry as { n: number }).n),
    [1, 5],
  );
  assert.equal(client.getSnapshot().lastEventId, "43");
  assert.deepEqual(cursors, ["41", "43"]);
  client.destroy();
});

test("native reconnect remains owned by one EventSource and errors age last-good data", () => {
  const runtime = manualRuntime();
  const source = new FakeEventSource();
  let factoryCalls = 0;
  const client = createOperationsStreamClient({
    scope: { scope: "project", taskId: 5 },
    eventSourceFactory: () => {
      factoryCalls += 1;
      return source;
    },
    onSnapshot: () => undefined,
    runtime,
    staleAfterMs: 10_000,
    disconnectedAfterMs: 30_000,
  });

  source.emit("snapshot", {
    id: "1",
    data: { generatedAt: runtime.now().toISOString() },
  });
  runtime.advance(2_000);
  source.emit("error");
  assert.equal(client.getSnapshot().state, "stale");
  assert.equal(client.getSnapshot().reconnectCount, 1);
  assert.equal(factoryCalls, 1);
  assert.equal(source.closed, false);

  source.emit("open");
  source.emit("heartbeat", { data: { at: runtime.now().toISOString() } });
  assert.equal(client.getSnapshot().state, "live");
  assert.equal(factoryCalls, 1);
  client.destroy();
});

test("a silent initial connection reaches a bounded disconnected state", () => {
  const runtime = manualRuntime();
  const source = new FakeEventSource();
  const client = createOperationsStreamClient({
    scope: { scope: "global" },
    eventSourceFactory: () => source,
    onSnapshot: () => undefined,
    runtime,
    staleAfterMs: 10_000,
    disconnectedAfterMs: 30_000,
  });

  runtime.advance(29_999);
  assert.equal(client.getSnapshot().state, "connecting");
  runtime.advance(1);
  assert.equal(client.getSnapshot().state, "disconnected");

  source.emit("open");
  assert.equal(client.getSnapshot().state, "connecting");
  runtime.advance(30_000);
  assert.equal(client.getSnapshot().state, "disconnected");
  client.destroy();
});

test("disabled clients create no source and expose a stable disabled state", () => {
  const runtime = manualRuntime();
  let factoryCalls = 0;
  const client = createOperationsStreamClient({
    scope: { scope: "global" },
    enabled: false,
    eventSourceFactory: () => {
      factoryCalls += 1;
      return new FakeEventSource();
    },
    onSnapshot: () => undefined,
    runtime,
  });
  assert.equal(client.getSnapshot().state, "disabled");
  assert.equal(factoryCalls, 0);
  assert.equal(runtime.pendingTimers(), 0);
  client.destroy();
});

test("constructor failures degrade to polling-safe disconnected state", () => {
  const runtime = manualRuntime();
  const client = createOperationsStreamClient({
    scope: { scope: "global" },
    eventSourceFactory: () => {
      throw new Error("EventSource blocked by policy");
    },
    onSnapshot: () => undefined,
    runtime,
  });

  assert.equal(client.getSnapshot().state, "disconnected");
  assert.equal(client.getSnapshot().reconnectCount, 1);
  assert.equal(runtime.pendingTimers(), 0);
  client.destroy();
});
