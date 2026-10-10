import { readBoundedRegularFile } from "./read-bounded-file";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateOllamaBaseUrl } from "@workspace/ai-server";

/**
 * Persisted runtime configuration (operator-editable from the Settings UI).
 *
 * Stored at <workspace-root>/data/runtime-config.json (gitignored). Never
 * put secrets here in production deployments that share disks -- this file
 * exists so local/self-hosted operators can wire provider keys without
 * touching env vars.
 */

export interface RuntimeConfig {
  openrouterApiKey?: string | null;
  openaiApiKey?: string | null;
  ollamaBaseUrl?: string | null;
  ollamaCloudOrigin?: string | null;
}

export function normalizeRuntimeOllamaCloudOrigin(
  value: unknown,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (
    typeof value !== "string" ||
    validateOllamaBaseUrl(value).origin !== value
  )
    throw new Error(
      "Ollama cloud consent must name a canonical private origin.",
    );
  return value;
}

function effectiveOllamaOrigin(
  config: RuntimeConfig,
  environment: NodeJS.ProcessEnv,
): string | null {
  const address = config.ollamaBaseUrl ?? environment.OLLAMA_BASE_URL?.trim();
  if (!address) return null;
  try {
    return validateOllamaBaseUrl(address).origin;
  } catch {
    return null;
  }
}

/** Saved consent cannot authorize a different environment or restored address. */
export function effectiveOllamaCloudOrigin(
  config: RuntimeConfig,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const consent = normalizeRuntimeOllamaCloudOrigin(config.ollamaCloudOrigin);
  return consent && consent === effectiveOllamaOrigin(config, environment)
    ? consent
    : null;
}

/** Called while the file queue or database row lock owns the exact revision. */
export function applyRuntimeConfigPatch(
  current: RuntimeConfig,
  patch: RuntimeConfig,
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const next = { ...current, ...patch };
  next.ollamaBaseUrl = normalizeRuntimeOllamaBaseUrl(next.ollamaBaseUrl);
  if (next.ollamaCloudOrigin !== undefined)
    next.ollamaCloudOrigin = normalizeRuntimeOllamaCloudOrigin(
      next.ollamaCloudOrigin,
    );
  if (
    patch.ollamaBaseUrl !== undefined &&
    effectiveOllamaOrigin(current, environment) !==
      effectiveOllamaOrigin(next, environment) &&
    patch.ollamaCloudOrigin === undefined
  )
    next.ollamaCloudOrigin = null;
  if (
    patch.ollamaCloudOrigin &&
    patch.ollamaCloudOrigin !== effectiveOllamaOrigin(next, environment)
  )
    throw new Error("Ollama cloud consent does not match the selected server.");
  return next;
}

export function normalizeRuntimeOllamaBaseUrl(
  value: unknown,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") {
    throw new Error("Local model address must be a string or null.");
  }
  if (!value.trim()) return null;
  return validateOllamaBaseUrl(value).openAIBaseUrl;
}

export class ProviderConfigConflict extends Error {
  readonly code = "LLM_CONFIG_CHANGED";
  constructor() {
    super("Provider settings changed; refresh before saving.");
  }
}
export interface RuntimeConfigSnapshot {
  revision: number;
  config: RuntimeConfig;
}

let cachedRoot: string | null = null;
let writeQueue: Promise<void> = Promise.resolve();
const MAX_CONFIG_BYTES = 64 * 1024;

function findWorkspaceRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function configPath(): string {
  cachedRoot ??= findWorkspaceRoot();
  return path.join(cachedRoot, "data", "runtime-config.json");
}

export async function readRuntimeConfig(): Promise<RuntimeConfig> {
  return (await readRuntimeConfigSnapshot()).config;
}

export async function readRuntimeConfigSnapshot(): Promise<RuntimeConfigSnapshot> {
  try {
    const filePath = configPath();
    const raw = await readBoundedRegularFile(filePath, MAX_CONFIG_BYTES);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Runtime configuration must be a JSON object.");
    }
    const record = parsed as Record<string, unknown>;
    const revision = record._revision ?? 0;
    if (!Number.isSafeInteger(revision) || (revision as number) < 0)
      throw new Error("Runtime configuration revision is invalid.");
    const openrouterApiKey = readOptionalSecret(
      record.openrouterApiKey,
      "openrouterApiKey",
    );
    const openaiApiKey = readOptionalSecret(
      record.openaiApiKey,
      "openaiApiKey",
    );
    return {
      revision: revision as number,
      config: {
        openrouterApiKey,
        openaiApiKey,
        ollamaBaseUrl: normalizeRuntimeOllamaBaseUrl(record.ollamaBaseUrl),
        ...(record.ollamaCloudOrigin === undefined
          ? {}
          : {
              ollamaCloudOrigin: normalizeRuntimeOllamaCloudOrigin(
                record.ollamaCloudOrigin,
              ),
            }),
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { revision: 0, config: {} };
    throw new Error("Failed to read the runtime configuration.", {
      cause: error,
    });
  }
}

function readOptionalSecret(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined || value === null || typeof value === "string") {
    return value as string | null | undefined;
  }
  throw new Error(`${field} must be a string or null.`);
}

export async function writeRuntimeConfig(
  patch: RuntimeConfig,
): Promise<RuntimeConfig> {
  return (await writeRuntimeConfigSnapshot(patch)).config;
}

export async function writeRuntimeConfigSnapshot(
  patch: RuntimeConfig,
  expectedRevision?: number,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeConfigSnapshot> {
  let resolveWrite: (() => void) | undefined;
  const previousWrite = writeQueue;
  writeQueue = new Promise<void>((resolve) => {
    resolveWrite = resolve;
  });
  await previousWrite;
  try {
    const filePath = configPath();
    await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const current = await readRuntimeConfigSnapshot();
    if (expectedRevision !== undefined && expectedRevision !== current.revision)
      throw new ProviderConfigConflict();
    if (current.revision >= Number.MAX_SAFE_INTEGER)
      throw new Error("Runtime configuration revision limit reached.");
    const revision = current.revision + 1;
    const next = applyRuntimeConfigPatch(current.config, patch, environment);
    for (const key of Object.keys(next) as Array<keyof RuntimeConfig>) {
      if (next[key] === "" || next[key] === undefined) delete next[key];
    }
    const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fsp.writeFile(
        tempPath,
        JSON.stringify({ ...next, _revision: revision }, null, 2),
        {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        },
      );
      await fsp.rename(tempPath, filePath);
    } catch (error) {
      await fsp.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
    if (process.platform !== "win32") {
      await fsp.chmod(filePath, 0o600);
    }
    return { revision, config: next };
  } finally {
    resolveWrite?.();
  }
}
