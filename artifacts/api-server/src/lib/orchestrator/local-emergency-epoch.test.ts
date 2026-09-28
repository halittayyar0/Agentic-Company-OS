import assert from "node:assert/strict";
import test from "node:test";
import { runWithAgentBrowserControl } from "../vm/browser";
import {
  activateLocalEmergencyStop,
  assertLocalExecutionEpoch,
  captureLocalExecutionEpoch,
  deactivateLocalEmergencyStop,
  LocalEmergencyStopError,
} from "./local-emergency-epoch";

test("a stop epoch invalidates pre-checked autonomous side effects", async () => {
  deactivateLocalEmergencyStop();
  const captured = captureLocalExecutionEpoch();
  activateLocalEmergencyStop();
  assert.throws(
    () => assertLocalExecutionEpoch(captured),
    LocalEmergencyStopError,
  );
  let browserOperationRan = false;
  await assert.rejects(
    runWithAgentBrowserControl(999_991, async () => {
      browserOperationRan = true;
    }),
    LocalEmergencyStopError,
  );
  assert.equal(browserOperationRan, false);
  deactivateLocalEmergencyStop();
  assert.doesNotThrow(() => captureLocalExecutionEpoch());
});
