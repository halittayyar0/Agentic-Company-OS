import {
  configureDirectOpenAI,
  configureOpenRouter,
  configureOllama,
  configureProviderRequestGuard,
  refreshModelCatalog,
} from "@workspace/ai-server";
import {
  db,
  dbReady,
  providerRuntimeConfigAcksTable,
  providerRuntimeConfigTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { RuntimeInstanceHandle } from "./orchestrator/runtime-instance-registry";
import {
  readRuntimeConfig,
  readRuntimeConfigSnapshot,
  normalizeRuntimeOllamaBaseUrl,
  ProviderConfigConflict,
  type RuntimeConfig,
} from "./runtime-config";
import {
  decryptRuntimeEnvelope,
  encryptRuntimeEnvelope,
  readRuntimeControlKey,
} from "./runtime-control-crypto";

interface DesiredProviderConfig {
  revision: number;
  config: RuntimeConfig;
}

let runtimeIdentity: Pick<RuntimeInstanceHandle, "id" | "startedAt"> | null =
  null;
let appliedRevision = 0;
let applyQueue: Promise<void> = Promise.resolve();

function normalizeConfig(config: RuntimeConfig): RuntimeConfig {
  const normalize = (value: string | null | undefined): string | null =>
    value?.trim() || null;
  return {
    openrouterApiKey: normalize(config.openrouterApiKey),
    openaiApiKey: normalize(config.openaiApiKey),
    ollamaBaseUrl: normalizeRuntimeOllamaBaseUrl(config.ollamaBaseUrl) ?? null,
  };
}

function assertProviderConfig(value: unknown): RuntimeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Provider runtime configuration is invalid.");
  }
  const record = value as Record<string, unknown>;
  for (const field of ["openrouterApiKey", "openaiApiKey"] as const) {
    const entry = record[field];
    if (
      entry !== undefined &&
      entry !== null &&
      (typeof entry !== "string" || entry.length > 512)
    ) {
      throw new Error("Provider runtime configuration is invalid.");
    }
  }
  return normalizeConfig({
    openrouterApiKey: record.openrouterApiKey as string | null | undefined,
    openaiApiKey: record.openaiApiKey as string | null | undefined,
    ollamaBaseUrl: normalizeRuntimeOllamaBaseUrl(record.ollamaBaseUrl),
  });
}

function isSplitRole(environment: NodeJS.ProcessEnv): boolean {
  return (
    environment.RUNTIME_ROLE === "api" || environment.RUNTIME_ROLE === "worker"
  );
}

async function ensureDesiredProviderConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<DesiredProviderConfig> {
  readRuntimeControlKey(environment);
  await dbReady;
  let [row] = await db
    .select()
    .from(providerRuntimeConfigTable)
    .where(eq(providerRuntimeConfigTable.singletonId, 1))
    .limit(1);
  if (!row) {
    const fallback = normalizeConfig(await readRuntimeConfig());
    const initialEnvelope = encryptRuntimeEnvelope(
      fallback,
      readRuntimeControlKey(environment),
    );
    await db
      .insert(providerRuntimeConfigTable)
      .values({
        singletonId: 1,
        revision: 1,
        ...initialEnvelope,
      })
      .onConflictDoNothing({ target: providerRuntimeConfigTable.singletonId });
    [row] = await db
      .select()
      .from(providerRuntimeConfigTable)
      .where(eq(providerRuntimeConfigTable.singletonId, 1))
      .limit(1);
  }
  if (!row) throw new Error("Provider runtime configuration is unavailable.");
  const config = assertProviderConfig(
    decryptRuntimeEnvelope(
      {
        ciphertext: row.ciphertext,
        nonce: row.nonce,
        authTag: row.authTag,
      },
      readRuntimeControlKey(environment),
    ),
  );
  return { revision: row.revision, config };
}

async function recordProviderConfigAck(
  revision: number,
  state: "applied" | "failed",
  error?: unknown,
): Promise<void> {
  if (!runtimeIdentity) return;
  const sanitizedError =
    state === "failed"
      ? (error instanceof Error
          ? error.message
          : "Provider config apply failed"
        )
          .replace(/[\r\n\t]+/g, " ")
          .slice(0, 1024) || "Provider config apply failed"
      : null;
  await db
    .insert(providerRuntimeConfigAcksTable)
    .values({
      runtimeInstanceId: runtimeIdentity.id,
      runtimeStartedAt: runtimeIdentity.startedAt,
      attemptedRevision: revision,
      appliedRevision,
      state,
      sanitizedError,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: providerRuntimeConfigAcksTable.runtimeInstanceId,
      set: {
        runtimeStartedAt: runtimeIdentity.startedAt,
        attemptedRevision: revision,
        appliedRevision,
        state,
        sanitizedError,
        updatedAt: new Date(),
      },
    });
}

async function ensureProviderConfigCurrent(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const run = applyQueue.then(async () => {
    let desiredRevision = appliedRevision;
    let rollbackRevision: number | null = null;
    try {
      const desired = await ensureDesiredProviderConfig(environment);
      desiredRevision = desired.revision;
      if (desired.revision !== appliedRevision) {
        rollbackRevision = appliedRevision;
        configureOpenRouter({
          apiKey: desired.config.openrouterApiKey ?? null,
        });
        configureDirectOpenAI({
          apiKey: desired.config.openaiApiKey ?? null,
        });
        configureOllama({
          baseUrl:
            desired.config.ollamaBaseUrl ??
            environment.OLLAMA_BASE_URL?.trim() ??
            null,
        });
        appliedRevision = desired.revision;
        // A runtime is not eligible to make even catalog/provider requests
        // under a new revision until that local application is durably
        // acknowledged. If the ack or subsequent catalog refresh fails, roll
        // the tracked revision back so the next request must re-apply it.
        await recordProviderConfigAck(desired.revision, "applied");
        await refreshModelCatalog(true);
        rollbackRevision = null;
        return;
      }
      await recordProviderConfigAck(desired.revision, "applied");
    } catch (error) {
      if (rollbackRevision !== null) appliedRevision = rollbackRevision;
      await recordProviderConfigAck(desiredRevision, "failed", error).catch(
        () => undefined,
      );
      throw error;
    }
  });
  applyQueue = run.catch(() => undefined);
  return run;
}

/** Called by provider bootstrap before the runtime can accept work. */
export async function prepareProviderRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): Promise<RuntimeConfig> {
  if (!isSplitRole(environment)) return readRuntimeConfig();
  const desired = await ensureDesiredProviderConfig(environment);
  appliedRevision = desired.revision;
  return desired.config;
}

/** Installs the per-request revision guard after the initial provider wiring. */
export function installProviderRuntimeConfigGuard(
  environment: NodeJS.ProcessEnv,
): void {
  configureProviderRequestGuard(
    isSplitRole(environment)
      ? () => ensureProviderConfigCurrent(environment)
      : null,
  );
}

export async function setProviderRuntimeIdentity(
  identity: Pick<RuntimeInstanceHandle, "id" | "startedAt">,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  runtimeIdentity = { id: identity.id, startedAt: identity.startedAt };
  if (isSplitRole(environment)) await ensureProviderConfigCurrent(environment);
}

export async function readEffectiveProviderRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeConfig> {
  if (!isSplitRole(environment)) return readRuntimeConfig();
  return (await ensureDesiredProviderConfig(environment)).config;
}

/** Refresh local routing before retrying a task that had no usable provider. */
export async function syncProviderRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (isSplitRole(environment)) await ensureProviderConfigCurrent(environment);
}

export async function readProviderRuntimeConfigSnapshot(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<DesiredProviderConfig & { storage: "database" | "local-file" }> {
  if (isSplitRole(environment))
    return {
      ...(await ensureDesiredProviderConfig(environment)),
      storage: "database",
    };
  return { ...(await readRuntimeConfigSnapshot()), storage: "local-file" };
}

export async function updateProviderRuntimeConfig(
  patch: RuntimeConfig,
  environment: NodeJS.ProcessEnv = process.env,
  expectedRevision?: number,
): Promise<{ revision: number; config: RuntimeConfig }> {
  if (!isSplitRole(environment)) {
    throw new Error("Durable provider revisions require a split runtime role.");
  }
  await ensureDesiredProviderConfig(environment);
  const secret = readRuntimeControlKey(environment);
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(providerRuntimeConfigTable)
      .where(eq(providerRuntimeConfigTable.singletonId, 1))
      .for("update")
      .limit(1);
    if (!current) {
      throw new Error("Provider runtime configuration is unavailable.");
    }
    if (expectedRevision !== undefined && current.revision !== expectedRevision)
      throw new ProviderConfigConflict();
    const currentConfig = assertProviderConfig(
      decryptRuntimeEnvelope(
        {
          ciphertext: current.ciphertext,
          nonce: current.nonce,
          authTag: current.authTag,
        },
        secret,
      ),
    );
    const config = normalizeConfig({ ...currentConfig, ...patch });
    const envelope = encryptRuntimeEnvelope(config, secret);
    const [updated] = await transaction
      .update(providerRuntimeConfigTable)
      .set({
        revision: sql`${providerRuntimeConfigTable.revision} + 1`,
        ...envelope,
        updatedAt: new Date(),
      })
      .where(eq(providerRuntimeConfigTable.singletonId, 1))
      .returning({ revision: providerRuntimeConfigTable.revision });
    if (!updated) {
      throw new Error("Provider runtime configuration update was lost.");
    }
    return { revision: updated.revision, config };
  });
}

/** Test-only reset for process-global provider coordination state. */
export function resetProviderRuntimeConfigForTest(): void {
  runtimeIdentity = null;
  appliedRevision = 0;
  applyQueue = Promise.resolve();
  configureProviderRequestGuard(null);
}
