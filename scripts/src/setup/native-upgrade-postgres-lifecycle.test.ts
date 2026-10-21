import assert from "node:assert/strict";
import test from "node:test";
import { createStagingPostgresLifecycle } from "./native-upgrade-postgres-lifecycle";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("parent disconnect during startup aborts readiness and waits for the owned database to close", async () => {
  const starting = deferred(),
    stopping = deferred(),
    entered = deferred();
  const frames: unknown[] = [],
    exits: number[] = [];
  let stops = 0,
    signal!: AbortSignal;
  const lifecycle = createStagingPostgresLifecycle({
    create: async (input) => {
      signal = input;
      return {
        prepare: async () => {},
        start: async () => {
          entered.resolve();
          await starting.promise;
        },
        stop: async () => {
          stops++;
          await stopping.promise;
        },
      };
    },
    send: (frame) => {
      frames.push(frame);
    },
    finish: (code) => {
      exits.push(code);
    },
  });
  void lifecycle.run();
  await entered.promise;
  const closed = lifecycle.shutdown();
  assert.equal(signal.aborted, true);
  assert.deepEqual(exits, []);
  starting.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(stops, 1);
  assert.deepEqual(frames, []);
  assert.deepEqual(exits, []);
  stopping.resolve();
  await closed;
  await lifecycle.shutdown();
  assert.equal(stops, 1);
  assert.deepEqual(frames, [{ type: "stopped" }]);
  assert.deepEqual(exits, [0]);
});

test("ready is sent only after startup; explicit repeated stop cleans up once", async () => {
  const order: string[] = [];
  const lifecycle = createStagingPostgresLifecycle({
    create: async () => ({
      prepare: async () => {
        order.push("prepare");
      },
      start: async () => {
        order.push("start");
      },
      stop: async () => {
        order.push("stop");
      },
    }),
    send: (frame) => {
      order.push(frame.type);
    },
    finish: (code) => {
      order.push(`exit:${code}`);
    },
  });
  await lifecycle.run();
  await Promise.all([
    lifecycle.message({ type: "stop" }),
    lifecycle.message({ type: "stop" }),
  ]);
  assert.deepEqual(order, [
    "prepare",
    "start",
    "ready",
    "stop",
    "stopped",
    "exit:0",
  ]);
});

test("startup and cleanup failures produce safe failure frames without error contents", async () => {
  for (const failAt of ["prepare", "start", "stop"]) {
    const frames: unknown[] = [],
      exits: number[] = [];
    let stops = 0;
    const lifecycle = createStagingPostgresLifecycle({
      create: async () => ({
        prepare: async () => {
          if (failAt === "prepare") throw new Error("secret password");
        },
        start: async () => {
          if (failAt === "start") throw new Error("secret URL");
        },
        stop: async () => {
          stops++;
          if (failAt === "stop") throw new Error("private path");
        },
      }),
      send: (frame) => {
        frames.push(frame);
      },
      finish: (code) => {
        exits.push(code);
      },
    });
    await lifecycle.run();
    await lifecycle.shutdown();
    assert.equal(stops, 1);
    assert.deepEqual(
      frames,
      failAt === "stop"
        ? [{ type: "ready" }, { type: "failed" }]
        : [{ type: "failed" }],
    );
    assert.deepEqual(exits, [1]);
  }
});

test("closed or malformed protocols never start a database", async () => {
  for (const input of [
    null,
    { type: "ready" },
    { type: "stop", directory: "/other" },
    "stop",
  ]) {
    let created = 0;
    const frames: unknown[] = [],
      exits: number[] = [];
    const lifecycle = createStagingPostgresLifecycle({
      create: async () => {
        created++;
        throw new Error("must not create");
      },
      send: (frame) => {
        frames.push(frame);
      },
      finish: (code) => {
        exits.push(code);
      },
    });
    await lifecycle.message(input);
    await lifecycle.run();
    assert.equal(created, 0);
    assert.deepEqual(frames, [{ type: "failed" }]);
    assert.deepEqual(exits, [1]);
  }
});
