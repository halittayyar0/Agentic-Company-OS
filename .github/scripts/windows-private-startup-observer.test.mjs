import assert from "node:assert/strict";
import { ChildProcess, execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";
import { createObservedSpawn } from "./windows-private-startup-observer.mjs";

function fixture() {
  let clock = 0;
  const rows = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  const monitor = {
    enable() {},
    disable() {
      this.disabled = true;
    },
    max: 23_000_000,
    count: 2,
  };
  const options = {
    file: "owned-helper",
    args: ["PRIVATE_ARGUMENT"],
    envPairs: ["SECRET=value"],
  };
  const original = function (actual) {
    assert.equal(this, child);
    assert.equal(actual, options);
    return 41;
  };
  const observed = createObservedSpawn(original, {
    matches: (value) => value === "owned-helper",
    now: () => clock,
    onRecord: (value) => rows.push(value),
    newMonitor: () => monitor,
  });
  return {
    child,
    rows,
    monitor,
    options,
    observed,
    setClock: (value) => {
      clock = value;
    },
  };
}

test("records only closed spawn/readiness/exit facts and joins fragmented markers", () => {
  const f = fixture();
  assert.equal(f.observed.call(f.child, f.options), 41);
  f.setClock(2);
  f.child.emit("spawn");
  f.setClock(9);
  f.child.stderr.write("PRIVATE_PATH ACOS_PRIVATE_STORAGE_STA");
  f.setClock(11);
  f.child.stderr.write("RTED PRIVATE_SECRET");
  f.setClock(14);
  f.child.stdout.write("PRIVATE_OK");
  f.setClock(18);
  f.child.emit("close", 0, null);
  assert.deepEqual(f.rows, [
    {
      index: 1,
      spawned: true,
      spawnDelayMs: 2,
      startMarkerDelayMs: 11,
      okMarkerDelayMs: 14,
      elapsedMs: 18,
      closeCode: 0,
      closeSignal: null,
      killed: false,
      spawnCallThrew: false,
      eventLoopMaxDelayMs: 23,
      eventLoopSamples: 2,
    },
  ]);
  assert.equal(f.monitor.disabled, true);
  assert.doesNotMatch(
    JSON.stringify(f.rows),
    /PRIVATE_PATH|PRIVATE_SECRET|PRIVATE_ARGUMENT|SECRET=value/,
  );
});

test("does not observe or change another executable", () => {
  const f = fixture();
  f.options.file = "unrelated";
  assert.equal(f.observed.call(f.child, f.options), 41);
  f.child.emit("spawn");
  f.child.emit("close", 0, null);
  assert.deepEqual(f.rows, []);
});

test("reports absent readiness and killed status without exporting child output", () => {
  const f = fixture();
  f.observed.call(f.child, f.options);
  f.child.emit("spawn");
  f.child.killed = true;
  f.child.stderr.write("PRIVATE_PATH private-token raw-error");
  f.setClock(15_002);
  f.child.emit("close", null, "SIGTERM");
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].startMarkerDelayMs, null);
  assert.equal(f.rows[0].killed, true);
  assert.equal(f.rows[0].elapsedMs, 15_002);
  assert.doesNotMatch(
    JSON.stringify(f.rows),
    /PRIVATE_PATH|private-token|raw-error/,
  );
});

test("preserves a synchronous spawn failure and releases the observer", () => {
  const f = fixture();
  const originalError = new Error("PRIVATE_PATH");
  const observed = createObservedSpawn(
    () => {
      throw originalError;
    },
    {
      matches: () => true,
      now: () => 0,
      onRecord: (row) => f.rows.push(row),
      newMonitor: () => f.monitor,
    },
  );
  assert.throws(
    () => observed.call(f.child, f.options),
    (error) => error === originalError,
  );
  assert.equal(f.monitor.disabled, true);
  assert.equal(f.rows[0].spawnCallThrew, true);
  assert.doesNotMatch(JSON.stringify(f.rows), /PRIVATE_PATH/);
});

async function withActualChild(callback) {
  const original = ChildProcess.prototype.spawn;
  const rows = [];
  ChildProcess.prototype.spawn = createObservedSpawn(original, {
    matches: (value) => value === process.execPath,
    onRecord: (row) => rows.push(row),
  });
  try {
    await callback(rows);
  } finally {
    ChildProcess.prototype.spawn = original;
  }
}

test("leaves the actual execFile promisify child, stdout and stderr contract intact", async () => {
  await withActualChild(async (rows) => {
    const result = promisify(execFile)(process.execPath, [
      "-e",
      "process.stdout.write('PRIVATE_OK');process.stderr.write('ACOS_PRIVATE_STORAGE_STARTED');",
    ]);
    assert.ok(result.child instanceof ChildProcess);
    const output = await result;
    assert.equal(output.stdout, "PRIVATE_OK");
    assert.equal(output.stderr, "ACOS_PRIVATE_STORAGE_STARTED");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].closeCode, 0);
    assert.notEqual(rows[0].startMarkerDelayMs, null);
    assert.notEqual(rows[0].okMarkerDelayMs, null);
  });
});

test("preserves actual nonzero exit errors without exporting their private stderr", async () => {
  await withActualChild(async (rows) => {
    await assert.rejects(
      promisify(execFile)(process.execPath, [
        "-e",
        "process.stderr.write('PRIVATE_SECRET');process.exit(7)",
      ]),
      (error) => error.code === 7 && error.stderr === "PRIVATE_SECRET",
    );
    assert.equal(rows[0].closeCode, 7);
    assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_SECRET/);
  });
});

test("retains the original actual child timeout without retrying or adding grace", async () => {
  await withActualChild(async (rows) => {
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        ["-e", "setTimeout(()=>{},10000)"],
        { timeout: 50 },
      ),
      (error) => error.killed === true,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].killed, true);
    assert.equal(rows[0].okMarkerDelayMs, null);
  });
});

test("distinguishes an owned Node event-loop stall from the child readiness marker", async () => {
  await withActualChild(async (rows) => {
    const result = promisify(execFile)(process.execPath, [
      "-e",
      "process.stdin.once('data',()=>process.stdout.write('PRIVATE_OK'))",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
    result.child.stdin.end("finish");
    await result;
    assert.equal(rows.length, 1);
    assert.ok(rows[0].eventLoopMaxDelayMs >= 80);
    assert.notEqual(rows[0].okMarkerDelayMs, null);
  });
});

test("retains the original actual output bound without exporting captured bytes", async () => {
  await withActualChild(async (rows) => {
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        ["-e", "process.stdout.write('PRIVATE_SECRET'.repeat(1000))"],
        { maxBuffer: 16 },
      ),
      (error) => error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    );
    assert.equal(rows.length, 1);
    assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_SECRET/);
  });
});
