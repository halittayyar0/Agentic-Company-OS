export type StagingPostgresFrame = { type: "ready" | "stopped" | "failed" };
interface StagingPostgres {
  prepare(): Promise<unknown>;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
}

/** The staging child owns PostgreSQL; the parent retains the installation lease.
 * IPC EOF must abort startup and join cleanup before this child exits. Never
 * select an external process using a PID persisted by an earlier attempt.
 */
export function createStagingPostgresLifecycle(options: {
  create(signal: AbortSignal): Promise<StagingPostgres>;
  send(frame: StagingPostgresFrame): void | Promise<void>;
  finish(code: number): void;
}) {
  const controller = new AbortController();
  let owned: StagingPostgres | undefined;
  let startup: Promise<void> | undefined, running: Promise<void> | undefined;
  let cleanup: Promise<void> | undefined;
  let closing = false,
    failed = false;
  const lifecycle = {
    run(): Promise<void> {
      if (closing) return cleanup ?? Promise.resolve();
      if (running) return running;
      startup = Promise.resolve().then(async () => {
        controller.signal.throwIfAborted();
        owned = await options.create(controller.signal);
        controller.signal.throwIfAborted();
        await owned.prepare();
        controller.signal.throwIfAborted();
        await owned.start();
        if (!closing) await options.send({ type: "ready" });
      });
      running = startup.catch(async () => {
        if (!closing) failed = true;
        await lifecycle.shutdown();
      });
      return running;
    },
    shutdown(failure = false): Promise<void> {
      failed ||= failure;
      if (cleanup) return cleanup;
      closing = true;
      controller.abort();
      cleanup = Promise.resolve().then(async () => {
        await startup?.catch(() => {});
        try {
          await owned?.stop();
        } catch {
          failed = true;
        }
        try {
          await options.send({ type: failed ? "failed" : "stopped" });
        } catch {
          // A dead parent cannot receive acknowledgement. Cleanup still ran.
        }
        options.finish(failed ? 1 : 0);
      });
      return cleanup;
    },
    message(value: unknown): Promise<void> {
      const valid =
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).join(",") === "type" &&
        (value as { type: unknown }).type === "stop";
      return lifecycle.shutdown(!valid);
    },
  };
  return lifecycle;
}
