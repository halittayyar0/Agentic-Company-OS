import assert from "node:assert/strict";
import test from "node:test";

test("operations stream cursor and frames are canonical and heartbeat stays id-less", async () => {
  const modulePath = "./operations-stream";
  const stream = await import(modulePath).catch(() => null);
  assert.ok(stream?.parseOperationsCursor, "parseOperationsCursor must exist");
  assert.equal(stream.parseOperationsCursor(undefined), "0");
  assert.equal(stream.parseOperationsCursor("0"), "0");
  assert.equal(stream.parseOperationsCursor("42"), "42");
  for (const invalid of ["", "01", "+1", "-1", "1.0", " 1", "2147483648"]) {
    assert.throws(() => stream.parseOperationsCursor(invalid), TypeError);
  }

  assert.equal(
    stream.formatOperationsSseFrame({
      event: "operations_changed",
      id: "42",
      data: { snapshot: { cursor: "42" } },
    }),
    'id: 42\nevent: operations_changed\ndata: {"snapshot":{"cursor":"42"}}\n\n',
  );
  assert.equal(
    stream.formatOperationsSseFrame({
      event: "heartbeat",
      data: { runtimeState: "live" },
    }),
    'event: heartbeat\ndata: {"runtimeState":"live"}\n\n',
  );
});

test("one shared poll fans durable changes out from the oldest subscriber cursor", async () => {
  const stream = await import("./operations-stream");
  const afterValues: string[] = [];
  const hub = new stream.OperationsStreamHub({
    loadChanges: async (afterCursor: string) => {
      afterValues.push(afterCursor);
      return [{ id: "3" }, { id: "6" }];
    },
    autoStart: false,
  });
  const first: string[] = [];
  const second: string[] = [];
  const unsubscribeFirst = hub.subscribe("2", (cursor: string) => {
    first.push(cursor);
  });
  const unsubscribeSecond = hub.subscribe("5", (cursor: string) => {
    second.push(cursor);
  });

  await hub.pollNow();
  assert.deepEqual(afterValues, ["2"]);
  assert.deepEqual(first, ["3", "6"]);
  assert.deepEqual(second, ["6"]);

  unsubscribeFirst();
  unsubscribeSecond();
  await hub.pollNow();
  assert.equal(
    afterValues.length,
    1,
    "an idle hub must not query the database",
  );
  hub.stop();
});

test("the process-local stream limiter rejects excess clients and releases exactly once", async () => {
  const stream = await import("./operations-stream");
  const limiter = new stream.OperationsStreamConnectionLimiter(1);
  const release = limiter.tryAcquire();
  assert.equal(typeof release, "function");
  assert.equal(limiter.tryAcquire(), null);
  release?.();
  release?.();
  assert.equal(limiter.active, 0);
  assert.equal(typeof limiter.tryAcquire(), "function");
});
