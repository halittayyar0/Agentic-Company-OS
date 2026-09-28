import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseReadGate } from "./database-read-gate";
test("observations wait for an injected database pause and retry only a read interrupted by that pause", async () => {
  const gate = new DatabaseReadGate(1000);
  let reads = 0;
  await gate.pause(async () => {});
  const waiting = gate.read(async () => ++reads);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(reads, 0);
  await gate.resume(async () => {});
  assert.equal(await waiting, 1);
  let reject!: () => void;
  const interrupted = gate.read(async () => {
    reads++;
    if (reads === 2)
      await new Promise((_resolve, fail) => {
        reject = () => fail(new Error("paused"));
      });
    return reads;
  });
  await new Promise((resolve) => setImmediate(resolve));
  await gate.pause(async () => {});
  reject();
  await gate.resume(async () => {});
  assert.equal(await interrupted, 3);
  await assert.rejects(
    gate.read(async () => {
      throw Error("unrelated failure");
    }),
    /unrelated/,
  );
});
