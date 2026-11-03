import assert from "node:assert/strict";
import { type ChildProcess, execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";
import {
  beginWindowsStorageDiagnostics,
  formatWindowsStorageDiagnostics,
} from "./owner-private-storage";

function fixture() {
  let clock = 0;
  const monitor = {
    enable() {
      return true;
    },
    disable() {
      this.disabled = true;
      return true;
    },
    disabled: false,
    max: 23_000_000,
    count: 2,
  };
  const child = Object.assign(new EventEmitter(), {
    stderr: new PassThrough(),
    killed: false,
  });
  const tracker = beginWindowsStorageDiagnostics({
    now: () => clock,
    newMonitor: () => monitor,
  });
  return {
    monitor,
    child,
    tracker,
    setClock(value: number) {
      clock = value;
    },
  };
}

test("Windows storage diagnostics join the first readiness marker and preserve other listeners", () => {
  const f = fixture();
  const unrelated = () => {};
  f.child.stderr.on("data", unrelated);
  f.tracker.attach(f.child as unknown as ChildProcess);
  f.setClock(2);
  f.child.emit("spawn");
  f.setClock(9);
  f.child.stderr.write("PRIVATE_PATH ACOS_PRIVATE_STORAGE_STA");
  f.setClock(11);
  f.child.stderr.write("RTED PRIVATE_SECRET");
  f.setClock(12);
  f.child.stderr.write("ACOS_PRIVATE_STORAGE_STARTED");
  f.setClock(18);
  const value = f.tracker.finish();
  assert.deepEqual(value, {
    spawned: true,
    spawnDelayMs: 2,
    startMarkerDelayMs: 11,
    elapsedMs: 18,
    killed: false,
    eventLoopMaxDelayMs: 23,
    eventLoopSamples: 2,
  });
  assert.equal(f.child.listenerCount("spawn"), 0);
  assert.equal(f.child.stderr.listenerCount("data"), 1);
  assert.equal(f.monitor.disabled, true);
});

test("Windows storage diagnostics retain absent readiness and do not export private output", () => {
  const f = fixture();
  f.tracker.attach(f.child as unknown as ChildProcess);
  f.child.emit("spawn");
  f.child.stderr.write("PRIVATE_PATH raw-error PRIVATE_SECRET");
  f.child.killed = true;
  f.setClock(15_002);
  const value = f.tracker.finish();
  assert.equal(value.startMarkerDelayMs, null);
  assert.equal(value.killed, true);
  assert.equal(value.elapsedMs, 15_002);
  const serialized = formatWindowsStorageDiagnostics({
    ...value,
    target: "PRIVATE_PATH",
    output: "PRIVATE_SECRET",
  } as typeof value);
  assert.ok(serialized.startsWith("windows_private_storage_timing "));
  assert.doesNotMatch(
    serialized,
    /PRIVATE_PATH|PRIVATE_SECRET|raw-error|target|output/,
  );
  assert.deepEqual(
    Object.keys(
      JSON.parse(serialized.slice("windows_private_storage_timing ".length)),
    ).sort(),
    Object.keys(value).sort(),
  );
});

test("Windows storage diagnostics stop once and never attach after finishing", () => {
  const f = fixture();
  f.setClock(4);
  const first = f.tracker.finish();
  f.setClock(1000);
  f.tracker.attach(f.child as unknown as ChildProcess);
  assert.deepEqual(f.tracker.finish(), first);
  assert.equal(f.child.listenerCount("spawn"), 0);
  assert.equal(f.child.stderr.listenerCount("data"), 0);
  assert.equal(f.monitor.disabled, true);
});

test("Windows storage diagnostics bound every numeric field and retain only fixed keys", () => {
  const f = fixture();
  f.tracker.attach(f.child as unknown as ChildProcess);
  f.setClock(9e12);
  f.child.emit("spawn");
  f.child.stderr.write("ACOS_PRIVATE_STORAGE_STARTED");
  f.monitor.max = Number.POSITIVE_INFINITY;
  f.monitor.count = 9e12;
  const value = f.tracker.finish();
  for (const field of [
    value.spawnDelayMs,
    value.startMarkerDelayMs,
    value.elapsedMs,
    value.eventLoopMaxDelayMs,
    value.eventLoopSamples,
  ])
    assert.ok(
      Number.isInteger(field) && Number(field) >= 0 && Number(field) <= 900_000,
    );
  assert.equal(value.elapsedMs, 900_000);
});

async function observed(
  command: string,
  options: { timeout?: number; maxBuffer?: number } = {},
) {
  const tracker = beginWindowsStorageDiagnostics();
  const pending = promisify(execFile)(
    process.execPath,
    ["-e", command],
    options,
  );
  tracker.attach(pending.child);
  try {
    return { output: await pending, timing: tracker.finish() };
  } catch (error) {
    const timing = tracker.finish();
    return { error, timing };
  } finally {
    tracker.finish();
  }
}

test("Windows storage diagnostics leave actual execFile output and completion intact", async () => {
  const result = await observed(
    "process.stdout.write('PRIVATE_OK');process.stderr.write('ACOS_PRIVATE_STORAGE_STARTED')",
  );
  assert.equal(result.output?.stdout, "PRIVATE_OK");
  assert.equal(result.output?.stderr, "ACOS_PRIVATE_STORAGE_STARTED");
  assert.equal(result.timing.spawned, true);
  assert.notEqual(result.timing.startMarkerDelayMs, null);
});

test("Windows storage diagnostics preserve an actual child exit error without retaining its stderr", async () => {
  const result = await observed(
    "process.stderr.write('PRIVATE_SECRET');process.exit(7)",
  );
  assert.equal((result.error as NodeJS.ErrnoException).code, 7);
  assert.equal(
    (result.error as Error & { stderr: string }).stderr,
    "PRIVATE_SECRET",
  );
  assert.equal(result.timing.spawned, true);
  assert.doesNotMatch(
    formatWindowsStorageDiagnostics(result.timing),
    /PRIVATE_SECRET/,
  );
});

test("Windows storage diagnostics preserve the actual original child timeout", async () => {
  const result = await observed("setTimeout(()=>{},10000)", { timeout: 50 });
  assert.equal((result.error as Error & { killed: boolean }).killed, true);
  assert.equal(result.timing.killed, true);
  assert.equal(result.timing.startMarkerDelayMs, null);
});

test("Windows storage diagnostics preserve the actual original child output limit", async () => {
  const result = await observed(
    "process.stdout.write('PRIVATE_SECRET'.repeat(1000))",
    { maxBuffer: 16 },
  );
  assert.equal(
    (result.error as NodeJS.ErrnoException).code,
    "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
  );
  assert.equal(result.timing.spawned, true);
  assert.doesNotMatch(
    formatWindowsStorageDiagnostics(result.timing),
    /PRIVATE_SECRET/,
  );
});

test("Windows storage diagnostics distinguish an owned Node event-loop stall", async () => {
  const tracker = beginWindowsStorageDiagnostics();
  const pending = promisify(execFile)(process.execPath, [
    "-e",
    "process.stdin.once('data',()=>process.stdout.write('PRIVATE_OK'))",
  ]);
  tracker.attach(pending.child);
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
    pending.child.stdin!.end("finish");
    await pending;
    assert.ok(tracker.finish().eventLoopMaxDelayMs >= 80);
  } finally {
    tracker.finish();
  }
});
