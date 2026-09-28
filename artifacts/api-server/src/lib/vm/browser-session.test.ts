import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectBrowserSession,
  runWithOperatorBrowserControl,
  takeOverBrowserControl,
  captureView,
} from "./browser";

test("invalid operator lease cannot create a browser session", async () => {
  const agentId = 98_765;
  assert.equal((await inspectBrowserSession(agentId)).active, false);
  await assert.rejects(
    () =>
      runWithOperatorBrowserControl(agentId, "invalid-lease", async () => {
        throw new Error("operation must never run");
      }),
    /tam ve etkin leaseId/,
  );
  assert.equal((await inspectBrowserSession(agentId)).active, false);
});

test("browser acquisition checks admission before creating a session", async () => {
  const agentId = 98_766;
  await assert.rejects(
    () =>
      takeOverBrowserControl(agentId, undefined, async () => {
        throw new Error("admission denied");
      }),
    /admission denied/,
  );
  assert.equal((await inspectBrowserSession(agentId)).active, false);
  const view = await captureView(agentId);
  assert.equal(view.available, false);
  assert.equal(
    (await inspectBrowserSession(agentId)).active,
    false,
    "reading a missing view must not create a browser",
  );
});
