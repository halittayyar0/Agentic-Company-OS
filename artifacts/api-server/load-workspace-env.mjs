import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

/**
 * Load an optional gitignored workspace .env before the bundled API module is
 * imported. Node preserves values already present in process.env, so shell,
 * service-manager, and secret-manager configuration remains authoritative.
 */
export function loadWorkspaceEnv(
  envPath = resolve(import.meta.dirname, "../../.env"),
) {
  if (!existsSync(envPath)) return false;
  loadEnvFile(envPath);
  return true;
}
