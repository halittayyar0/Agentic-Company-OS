import assert from "node:assert/strict";
import test from "node:test";
import {
  registerOwnedAgentRuntime,
  stopOwnedAgentRuntimes,
  ownedAgentRuntimeCount,
} from "./owned-agent-runtimes";
import {
  captureLocalExecutionEpoch,
  activateLocalEmergencyStop,
  deactivateLocalEmergencyStop,
} from "./local-emergency-epoch";

test("an owned runtime remains registered until its complete cleanup proof resolves; stop is idempotent", async () => {
  let release!: () => void,
    stops = 0;
  const proof = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = registerOwnedAgentRuntime(
    captureLocalExecutionEpoch(),
    async () => {
      stops++;
      await proof;
    },
  );
  const one = runtime.stop(),
    two = runtime.stop();
  assert.equal(stops, 1);
  assert.equal(ownedAgentRuntimeCount(), 1);
  release();
  await Promise.all([one, two]);
  assert.equal(ownedAgentRuntimeCount(), 0);
});
test("emergency stop fences a stale registration and invokes only registered runtime cleanup", async () => {
  let stopped = 0;
  const epoch = captureLocalExecutionEpoch();
  const runtime = registerOwnedAgentRuntime(epoch, async () => {
    stopped++;
  });
  activateLocalEmergencyStop();
  try {
    assert.throws(() => registerOwnedAgentRuntime(epoch, async () => {}));
    assert.equal(stopOwnedAgentRuntimes(), 1);
    await runtime.stop();
    assert.equal(stopped, 1);
    assert.equal(ownedAgentRuntimeCount(), 0);
  } finally {
    deactivateLocalEmergencyStop();
  }
});
test("failed cleanup remains visible and registered and may be retried without inventing a stopped process tree", async () => {
  let attempts = 0;
  const runtime = registerOwnedAgentRuntime(
    captureLocalExecutionEpoch(),
    async () => {
      if (++attempts === 1) throw new Error("fixture failed cleanup");
    },
  );
  await assert.rejects(runtime.stop());
  assert.equal(ownedAgentRuntimeCount(), 1);
  await runtime.stop();
  assert.equal(ownedAgentRuntimeCount(), 0);
});

test("a synchronous controller failure cannot throw out of the emergency stop loop", async () => {
  let attempts = 0;
  const runtime = registerOwnedAgentRuntime(
    captureLocalExecutionEpoch(),
    () => {
      if (++attempts === 1)
        throw new Error("fixture synchronous controller failure");
      return Promise.resolve();
    },
  );
  assert.equal(stopOwnedAgentRuntimes(), 1);
  await runtime.stop();
  assert.equal(ownedAgentRuntimeCount(), 0);
});
