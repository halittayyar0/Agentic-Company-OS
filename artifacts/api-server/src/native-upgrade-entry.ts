import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNativeUpgradeMigrationCLI } from "./lib/native-upgrade-cli";

process.exitCode = await runNativeUpgradeMigrationCLI(process.argv.slice(2), {
  migrationsDirectory: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "db-migrations",
  ),
});
