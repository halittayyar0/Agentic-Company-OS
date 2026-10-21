import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStagingPostgresLifecycle } from "./native-upgrade-postgres-lifecycle";
import { createNativeUpgradePostgresWorker } from "./native-upgrade-postgres-worker";

// Internal bundled child. Listeners precede all asynchronous validation/startup.
if (!process.send || !process.connected || process.argv.length !== 3) {
  process.exitCode = 1;
} else {
  const lifecycle = createStagingPostgresLifecycle({
    create: (signal) =>
      createNativeUpgradePostgresWorker({
        stagingDirectory: process.argv[2],
        targetRoot: path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../..",
        ),
        signal,
      }),
    send: (frame) =>
      new Promise<void>((resolve, reject) => {
        if (!process.connected) {
          resolve();
          return;
        }
        process.send!(frame, (error: Error | null) =>
          error ? reject(error) : resolve(),
        );
      }),
    finish: (code) => process.exit(code),
  });
  process.on("disconnect", () => {
    void lifecycle.shutdown();
  });
  process.on("message", (value) => {
    void lifecycle.message(value);
  });
  process.on("SIGTERM", () => {
    void lifecycle.shutdown();
  });
  process.on("SIGINT", () => {
    void lifecycle.shutdown();
  });
  void lifecycle.run();
}
