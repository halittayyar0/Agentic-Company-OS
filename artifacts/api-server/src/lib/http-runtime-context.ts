import type { RuntimeInstanceHandle } from "./orchestrator/runtime-instance-registry";
import {
  assertRuntimeClaimHandle,
  RuntimeClaimAdmissionError,
} from "./orchestrator/runtime-instance-registry";

let boundHandle: RuntimeInstanceHandle | null = null;

/** Binds the one HTTP runtime incarnation before the listener opens. */
export function bindHttpRuntimeHandle(handle: RuntimeInstanceHandle): void {
  assertRuntimeClaimHandle(handle);
  if (boundHandle === handle) return;
  if (boundHandle !== null) {
    throw new RuntimeClaimAdmissionError(
      "HTTP runtime context is already bound to another incarnation",
    );
  }
  boundHandle = handle;
}

/** Returns the exact locally-owned handle; absence always fails closed. */
export function requireHttpRuntimeHandle(): RuntimeInstanceHandle {
  if (!boundHandle) {
    throw new RuntimeClaimAdmissionError("HTTP runtime context is not bound");
  }
  return boundHandle;
}

/** Only the same handle object can release the process-wide binding. */
export function releaseHttpRuntimeHandle(
  handle: RuntimeInstanceHandle,
): boolean {
  if (boundHandle !== handle) return false;
  boundHandle = null;
  return true;
}
