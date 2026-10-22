import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { waitUntilWallClockDeadline } from "./wall-clock-deadline";

test("an early timer wake cannot dispatch a wall-clock fault before its planned time", async () => {
  let now = 1_000;
  let dispatchedAt: number | null = null;
  const wakes: Array<{ milliseconds: number; resolve: () => void }> = [];
  const pending = waitUntilWallClockDeadline(
    1_010,
    new AbortController().signal,
    {
      now: () => now,
      wait: (milliseconds) =>
        new Promise<void>((resolve) => wakes.push({ milliseconds, resolve })),
    },
  ).then(() => {
    dispatchedAt = now;
  });
  assert.equal(wakes[0]?.milliseconds, 10);
  now = 1_005;
  wakes[0]!.resolve();
  await setImmediate();
  assert.equal(
    dispatchedAt,
    null,
    "the fault must remain unstarted after an early wake",
  );
  assert.equal(wakes[1]?.milliseconds, 5);
  now = 1_010;
  wakes[1]!.resolve();
  await pending;
  assert.equal(dispatchedAt, 1_010);
});

test("cancellation after an early timer wake prevents wall-clock fault dispatch", async () => {
  const controller = new AbortController();
  const reason = new Error("owned wall-clock run cancelled");
  let now = 1_000;
  let dispatches = 0;
  let wake!: () => void;
  const pending = waitUntilWallClockDeadline(1_010, controller.signal, {
    now: () => now,
    wait: () =>
      new Promise<void>((resolve) => {
        wake = resolve;
      }),
  }).then(() => {
    dispatches += 1;
  });
  const rejected = assert.rejects(pending, (error) => error === reason);
  now = 1_005;
  wake();
  controller.abort(reason);
  await rejected;
  assert.equal(dispatches, 0);
});
