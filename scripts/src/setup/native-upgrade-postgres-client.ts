import { spawn } from "node:child_process";
import path from "node:path";
import { readNativeDistribution } from "./native-distribution";

/** Owns only the staging IPC child, never the instance lease. EOF asks the child
 * to close its actual PostgreSQL handle even after this parent is terminated.
 */
export async function startNativeUpgradePostgres(options: {
  stagingDirectory: string;
  targetRoot: string;
  signal?: AbortSignal;
}): Promise<{ stop(): Promise<void> }> {
  options.signal?.throwIfAborted();
  if (
    !path.isAbsolute(options.targetRoot) ||
    !path.isAbsolute(options.stagingDirectory)
  )
    throw new Error("native_upgrade_staging_identity");
  const distribution = await readNativeDistribution(options.targetRoot);
  if (
    !distribution ||
    !distribution.files.some(
      (row) => row.path === "scripts/src/setup/stage-postgres.mjs",
    )
  )
    throw new Error("native_upgrade_staging_package");
  options.signal?.throwIfAborted();
  const child = spawn(
    path.join(
      options.targetRoot,
      process.platform === "win32"
        ? "runtime/node/node.exe"
        : "runtime/node/bin/node",
    ),
    [
      path.join(options.targetRoot, "scripts/src/setup/stage-postgres.mjs"),
      options.stagingDirectory,
    ],
    {
      cwd: options.targetRoot,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "", LC_ALL: "C" },
    },
  );
  let readySeen = false,
    stoppedSeen = false,
    failed = false,
    stopping = false;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const closed = new Promise<number | null>((resolve) => {
    // With ignored stdio, Node on Windows can omit `close` after a manual IPC
    // disconnect even though `exit` was delivered. No pipes need draining here.
    child.once("exit", (code) => {
      options.signal?.removeEventListener("abort", abort);
      if (!readySeen) rejectReady(new Error("native_upgrade_staging_start"));
      resolve(code);
    });
    child.once("error", () => resolve(null));
  });
  const disconnect = () => {
    if (child.connected) child.disconnect();
  };
  const fail = () => {
    failed = true;
    rejectReady(new Error("native_upgrade_staging_protocol"));
    disconnect();
  };
  child.on("error", fail);
  child.on("message", (frame) => {
    if (
      !frame ||
      typeof frame !== "object" ||
      Array.isArray(frame) ||
      Object.keys(frame).join(",") !== "type"
    ) {
      fail();
      return;
    }
    const type = (frame as { type: unknown }).type;
    if (type === "ready" && !readySeen && !stopping && !failed) {
      readySeen = true;
      resolveReady();
    } else if (type === "stopped" && stopping && !stoppedSeen && !failed) {
      stoppedSeen = true;
    } else fail();
  });
  let cleanup: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (cleanup) return cleanup;
    stopping = true;
    if (child.connected)
      child.send({ type: "stop" }, (error) => {
        if (error) disconnect();
      });
    cleanup = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const code = await Promise.race([
          closed,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              disconnect();
              reject(new Error("native_upgrade_staging_cleanup_timeout"));
            }, 60_000);
          }),
        ]);
        if (code !== 0 || !stoppedSeen || failed)
          throw new Error("native_upgrade_staging_cleanup");
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    return cleanup;
  };
  function abort() {
    rejectReady(new Error("native_upgrade_staging_aborted"));
    void stop().catch(() => {});
  }
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("native_upgrade_staging_start_timeout")),
          60_000,
        );
      }),
    ]);
    options.signal?.throwIfAborted();
    return { stop };
  } catch (error) {
    await stop();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
