import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserControlError,
  BrowserControlRegistry,
  BrowserActionQueue,
  BrowserSessionCloseGate,
} from "./browser-control";

test("operator take-over atomically blocks agent browser actions", () => {
  const registry = new BrowserControlRegistry(10_000);
  const taken = registry.takeOver(1, 1_000);
  assert.equal(taken.owner, "operator");
  assert.ok(taken.leaseId);
  assert.throws(() => registry.beginAgentAction(1, 1_001), BrowserControlError);

  const released = registry.release(1, taken.leaseId!, 1_002);
  assert.equal(released.owner, "agent");
  const claim = registry.beginAgentAction(1, 1_003);
  registry.endAgentAction(1, claim);
  assert.equal(registry.snapshot(1, 1_004).agentActionInFlight, false);
});

test("take-over cannot race an in-flight agent action", () => {
  const registry = new BrowserControlRegistry(10_000);
  const claim = registry.beginAgentAction(2, 2_000);
  assert.throws(() => registry.takeOver(2, 2_001), /devam ediyor/);
  registry.endAgentAction(2, claim);
  assert.equal(registry.takeOver(2, 2_002).owner, "operator");
});

test("operator lease heartbeat is exact, expires, and clear removes stale state", () => {
  const registry = new BrowserControlRegistry(5_000);
  const taken = registry.takeOver(3, 3_000);
  assert.throws(() => registry.heartbeat(3, "wrong", 3_100), /gecersiz/);
  const renewed = registry.heartbeat(3, taken.leaseId!, 3_200);
  assert.equal(renewed.leaseExpiresAt, new Date(8_200).toISOString());
  assert.equal(registry.snapshot(3, 8_201).owner, "agent");

  registry.takeOver(3, 9_000);
  registry.clear(3);
  assert.equal(registry.snapshot(3, 9_001).owner, "agent");
});

test("active lease is neither leaked nor silently reacquired", () => {
  const registry = new BrowserControlRegistry(10_000);
  const taken = registry.takeOver(4, 4_000);
  assert.equal(registry.publicSnapshot(4, 4_001).leaseId, null);
  assert.throws(() => registry.takeOver(4, 4_002), /baska bir operator/);
  assert.throws(
    () => registry.beginOperatorAction(4, "wrong", 4_003),
    /tam ve etkin leaseId/,
  );
  const claim = registry.beginOperatorAction(4, taken.leaseId!, 4_004);
  assert.throws(
    () => registry.release(4, taken.leaseId!, 4_005),
    /devam ediyor/,
  );
  assert.throws(() => registry.clear(4), /devam ederken/);
  registry.endOperatorAction(4, claim);
  assert.throws(
    () => registry.assertCanClose(4, undefined, 4_005),
    /exact leaseId/,
  );
  assert.doesNotThrow(() => registry.assertCanClose(4, taken.leaseId!, 4_005));
  assert.equal(registry.release(4, taken.leaseId!, 4_006).owner, "agent");
});

test("system shutdown clears in-flight state without stale callback resurrection", () => {
  const registry = new BrowserControlRegistry(10_000);
  const claim = registry.beginAgentAction(5, 5_000);
  registry.clearForSystemShutdown(5);
  assert.doesNotThrow(() => registry.endAgentAction(5, claim));
  assert.equal(registry.snapshot(5, 5_001).owner, "agent");
  assert.equal(registry.snapshot(5, 5_001).agentActionInFlight, false);
});

test("a stale close lease cannot close a later agent-owned session", () => {
  const registry = new BrowserControlRegistry(5_000);
  const expired = registry.takeOver(20, 1000);
  assert.throws(
    () => registry.assertCanClose(20, expired.leaseId!, 6001),
    /tam ve etkin leaseId/,
  );
  assert.doesNotThrow(() => registry.assertCanClose(20, undefined, 6001));
  const released = registry.takeOver(20, 7000);
  registry.release(20, released.leaseId!, 7001);
  assert.throws(
    () => registry.assertCanClose(20, released.leaseId!, 7002),
    /tam ve etkin leaseId/,
  );
});

test("session close gate closes the check-to-claim race", () => {
  const gate = new BrowserSessionCloseGate();
  const closeToken = gate.begin(6);
  assert.throws(() => gate.assertAvailable(6), BrowserControlError);
  assert.equal(gate.tryBegin(6), null);
  gate.finish(6, "wrong-token");
  assert.throws(() => gate.assertAvailable(6), BrowserControlError);
  gate.finish(6, closeToken);
  assert.doesNotThrow(() => gate.assertAvailable(6));
  gate.beginShutdown([6]);
  assert.throws(() => gate.assertAvailable(7), BrowserControlError);
});

test("emergency browser pause blocks every session then cleanly resumes", () => {
  const gate = new BrowserSessionCloseGate();
  const pauseToken = gate.beginPause([8, 9]);
  assert.throws(() => gate.assertAvailable(8), BrowserControlError);
  assert.throws(() => gate.assertAvailable(999), BrowserControlError);
  assert.equal(gate.tryBegin(10), null);
  gate.finishPause("wrong-token");
  assert.throws(() => gate.assertAvailable(8), BrowserControlError);
  gate.finishPause(pauseToken);
  assert.doesNotThrow(() => gate.assertAvailable(8));
  assert.doesNotThrow(() => gate.assertAvailable(999));
});

test("operator browser actions execute in bounded FIFO order", async () => {
  const queue = new BrowserActionQueue(2);
  const order: number[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = queue.enqueue(7, async () => {
    await firstGate;
    order.push(1);
  });
  const second = queue.enqueue(7, async () => {
    order.push(2);
  });
  await assert.rejects(
    () => queue.enqueue(7, async () => order.push(3)),
    /kuyrugu dolu/,
  );
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, [1, 2]);
});
