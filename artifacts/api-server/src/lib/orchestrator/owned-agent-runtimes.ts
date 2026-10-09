import { assertLocalExecutionEpoch } from "./local-emergency-epoch";

/** Kernel/controller-owned runtimes are distinct from an ordinary immediate
 * child: unregister only after their complete cleanup proof, never on parent
 * exit. Failed cleanup stays visible and can be retried. No operator processes
 * are implicitly registered or selected by name. */
const runtimes = new Set<{ stop(): Promise<void> }>();
export function registerOwnedAgentRuntime(
  epoch: number,
  cleanup: () => Promise<void>,
) {
  assertLocalExecutionEpoch(epoch);
  let pending: Promise<void> | null = null,
    stopped = false;
  const runtime = {
    stop(): Promise<void> {
      if (stopped) return Promise.resolve();
      if (pending) return pending;
      // Run immediately: emergency stop cannot leave this behind a microtask.
      let proof: Promise<void>;
      try {
        proof = cleanup();
      } catch (error) {
        return Promise.reject(error);
      }
      pending = proof.then(
        () => {
          stopped = true;
          runtimes.delete(runtime);
        },
        (error) => {
          pending = null;
          throw error;
        },
      );
      return pending;
    },
  };
  runtimes.add(runtime);
  return runtime;
}
export function ownedAgentRuntimeCount() {
  return runtimes.size;
}
export function stopOwnedAgentRuntimes(): number {
  const active = [...runtimes];
  for (const runtime of active) void runtime.stop().catch(() => {});
  return active.length;
}
