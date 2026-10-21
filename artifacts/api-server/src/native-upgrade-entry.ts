import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNativeUpgradeMigrationCLI } from "./lib/native-upgrade-cli";

if (!process.send || !process.connected) {
  process.stderr.write("native_upgrade_parent_required\n");
  process.exitCode = 1;
} else {
  const controller = new AbortController();
  const stop = () =>
    controller.abort(new Error("native_upgrade_parent_disconnected"));
  process.once("disconnect", stop);
  // An independent deadline also closes the checked DB socket if a disconnect
  // notification is delayed after forced parent loss.
  let heartbeat = setTimeout(stop, 10000);
  const receive = (message: unknown) => {
    if (
      !message ||
      typeof message !== "object" ||
      Array.isArray(message) ||
      Object.keys(message).join(",") !== "type" ||
      (message as { type: unknown }).type !== "parent_alive"
    ) {
      stop();
      return;
    }
    clearTimeout(heartbeat);
    heartbeat = setTimeout(stop, 10000);
  };
  process.on("message", receive);
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.exitCode = await runNativeUpgradeMigrationCLI(process.argv.slice(2), {
    migrationsDirectory: path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "db-migrations",
    ),
    signal: controller.signal,
  });
  process.removeListener("disconnect", stop);
  process.removeListener("message", receive);
  clearTimeout(heartbeat);
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
  if (process.connected) process.disconnect();
}
