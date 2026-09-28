import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { loadEnvFile } from "node:process";

/**
 * Load an optional gitignored workspace .env before the bundled API module is
 * imported. Node preserves values already present in process.env, so shell,
 * service-manager, and secret-manager configuration remains authoritative.
 */
export function loadWorkspaceEnv(
  envPath = process.env.WORKSPACE_ENV_FILE ??
    resolve(import.meta.dirname, "../../.env"),
) {
  if (!isAbsolute(envPath))
    throw new Error("Workspace env path must be absolute");
  if (!existsSync(envPath)) return false;
  loadEnvFile(envPath);
  return true;
}
