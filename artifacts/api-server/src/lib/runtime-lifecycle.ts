let ready = false;
let shuttingDown = false;

export function markRuntimeReady(): void {
  if (!shuttingDown) ready = true;
}

export function markRuntimeShuttingDown(): void {
  ready = false;
  shuttingDown = true;
}

export function runtimeLifecycle(): {
  ready: boolean;
  shuttingDown: boolean;
} {
  return { ready, shuttingDown };
}

/** Tests only: the production process never transitions out of shutdown. */
export function resetRuntimeLifecycleForTests(): void {
  ready = false;
  shuttingDown = false;
}
