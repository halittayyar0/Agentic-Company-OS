import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptivePollingInterval,
  IDLE_POLL_MS,
  LIVE_POLL_MS,
} from "./adaptive-polling";

test("adaptive polling pauses outside the active visible surface", () => {
  assert.equal(
    adaptivePollingInterval({ documentVisible: false, live: true }),
    false,
  );
  assert.equal(
    adaptivePollingInterval({
      active: false,
      documentVisible: true,
      live: true,
    }),
    false,
  );
});

test("adaptive polling keeps live work fast and stretches idle work", () => {
  assert.equal(
    adaptivePollingInterval({ documentVisible: true, live: true }),
    LIVE_POLL_MS,
  );
  assert.equal(
    adaptivePollingInterval({ documentVisible: true, live: false }),
    IDLE_POLL_MS,
  );
  assert.equal(
    adaptivePollingInterval({
      documentVisible: true,
      live: true,
      liveMs: 900,
      idleMs: 2_800,
    }),
    900,
  );
});
