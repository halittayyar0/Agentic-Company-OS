import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  configureDirectOpenAI,
  configureOpenRouter,
  createChatCompletion,
  getFullModelCatalog,
  getOllamaCatalogSnapshot,
  getOllamaConfigurationError,
  isOllamaConfigured,
  OPENAI_BASE_URL,
  OPENROUTER_BASE_URL,
  refreshModelCatalog,
  resolveOllamaEndpoint,
} from "@workspace/ai-server";
import { logger } from "../lib/logger";
import {
  ProviderConfigConflict,
  writeRuntimeConfigSnapshot,
  type RuntimeConfig,
} from "../lib/runtime-config";
import {
  readWorkspaceLocale,
  WORKSPACE_LOCALES,
  writeWorkspaceLocale,
} from "../lib/workspace-locale";
import {
  readProviderRuntimeConfigSnapshot,
  updateProviderRuntimeConfig,
} from "../lib/provider-runtime-config";
import {
  assertExecutionAllowed,
  EmergencyStopError,
} from "../lib/orchestrator/runtime-emergency-stop";
import { createRateLimiter } from "../lib/rate-limit";

type SettingsState = Awaited<
  ReturnType<typeof readProviderRuntimeConfigSnapshot>
>;
const PutLlmBody = z
  .object({
    openrouterApiKey: z.string().trim().max(512).nullish(),
    openaiApiKey: z.string().trim().max(512).nullish(),
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.openrouterApiKey !== undefined || body.openaiApiKey !== undefined,
  );
const TestLlmBody = z
  .object({
    model: z.string().trim().min(1).max(256),
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .strict();

// Internal seams keep route tests offline without accepting network targets or
// test-mode flags from an HTTP caller.
export function createSettingsRouter(
  dependencies: {
    readState?: () => Promise<SettingsState>;
    writeState?: (
      patch: RuntimeConfig,
      expectedRevision?: number,
    ) => Promise<{ revision: number; config: RuntimeConfig }>;
    refreshCatalog?: typeof refreshModelCatalog;
    catalog?: typeof getFullModelCatalog;
    complete?: typeof createChatCompletion;
    assertAllowed?: typeof assertExecutionAllowed;
    environment?: NodeJS.ProcessEnv;
  } = {},
): IRouter {
  const router = Router();
  const environment = dependencies.environment ?? process.env;
  const readState =
    dependencies.readState ??
    (() => readProviderRuntimeConfigSnapshot(environment));
  const catalog = dependencies.catalog ?? getFullModelCatalog;
  const refresh = dependencies.refreshCatalog ?? refreshModelCatalog;
  const writeState =
    dependencies.writeState ??
    ((patch, expectedRevision) =>
      environment.RUNTIME_ROLE === "api" ||
      environment.RUNTIME_ROLE === "worker"
        ? updateProviderRuntimeConfig(patch, environment, expectedRevision)
        : writeRuntimeConfigSnapshot(patch, expectedRevision));
  // In combined mode file writes and local client application must preserve the
  // same ordering. Split runtimes additionally fence revisions in PostgreSQL.
  let writes: Promise<unknown> = Promise.resolve();
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = writes.then(operation);
    writes = result.catch(() => undefined);
    return result;
  }
  const saveLimit = createRateLimiter({
    namespace: "settings-save",
    max: 12,
    windowMs: 60_000,
  });
  const testLimit = createRateLimiter({
    namespace: "settings-test",
    max: 6,
    windowMs: 60_000,
  });
  router.get("/settings/locale", async (_req, res) => {
    res.json({ locale: await readWorkspaceLocale() });
  });
  router.put("/settings/locale", async (req, res) => {
    const parsed = z
      .object({ locale: z.enum(WORKSPACE_LOCALES) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Unsupported workspace locale",
        code: "LOCALE_INVALID",
      });
      return;
    }
    await writeWorkspaceLocale(parsed.data.locale);
    res.json({ locale: parsed.data.locale });
  });

  router.get("/settings/llm", async (_req, res) => {
    try {
      await writes;
      const state = await readState();
      await refresh();
      const provider = (
        stored: string | null | undefined,
        env: string | undefined,
        baseUrl: string,
      ) => {
        const key = stored?.trim() || env?.trim() || null;
        return {
          configured: Boolean(key),
          hasKeyInEnv: Boolean(env?.trim()),
          keyPreview: maskKey(key),
          baseUrl,
          keySource: stored?.trim()
            ? "runtime"
            : env?.trim()
              ? "environment"
              : "none",
        };
      };
      const ollama = getOllamaCatalogSnapshot();
      res.json({
        revision: state.revision,
        storage: state.storage,
        openrouter: provider(
          state.config.openrouterApiKey,
          environment.OPENROUTER_API_KEY,
          OPENROUTER_BASE_URL,
        ),
        openai: provider(
          state.config.openaiApiKey,
          environment.OPENAI_API_KEY,
          OPENAI_BASE_URL,
        ),
        ollama: {
          configured: isOllamaConfigured(),
          reachable: ollama.reachable,
          baseUrl: safeOllamaUrl(),
          modelCount: ollama.models.length,
          toolModelCount: ollama.models.filter((model) => model.supportsTools)
            .length,
          catalogSyncedAt: ollama.fetchedAt,
          error: getOllamaConfigurationError() ?? ollama.error,
        },
        replitFleet: {
          configured: Boolean(
            environment.AI_INTEGRATIONS_OPENAI_BASE_URL &&
            environment.AI_INTEGRATIONS_OPENAI_API_KEY,
          ),
          baseUrl: safeOrigin(environment.AI_INTEGRATIONS_OPENAI_BASE_URL),
        },
        catalog: catalog(),
      });
    } catch {
      logger.warn("Provider settings could not be read");
      res.status(503).json({
        error: "Provider settings unavailable",
        code: "LLM_SETTINGS_UNAVAILABLE",
      });
    }
  });

  router.put("/settings/llm", saveLimit, async (req, res) => {
    const parsed = PutLlmBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid provider settings",
        code: "LLM_SETTINGS_INVALID",
      });
      return;
    }
    const { openrouterApiKey, openaiApiKey, expectedRevision } = parsed.data;
    const patch = {
      ...(openrouterApiKey !== undefined ? { openrouterApiKey } : {}),
      ...(openaiApiKey !== undefined ? { openaiApiKey } : {}),
    };
    try {
      const result = await serialize(async () => {
        const update = await writeState(patch, expectedRevision);
        configureOpenRouter({ apiKey: update.config.openrouterApiKey ?? null });
        configureDirectOpenAI({ apiKey: update.config.openaiApiKey ?? null });
        await refresh();
        const current = catalog();
        return {
          ok: true as const,
          revision: update.revision,
          configured: current.providers.some((provider) => provider.available),
          configuredProviders: current.providers
            .filter((provider) => provider.available)
            .map((provider) => provider.id),
          catalog: current,
        };
      });
      logger.info(
        {
          providers: Object.keys(patch).map((key) =>
            key === "openaiApiKey" ? "openai" : "openrouter",
          ),
          revision: result.revision,
        },
        "Provider settings saved",
      );
      res.json(result);
    } catch (error) {
      if (error instanceof ProviderConfigConflict) {
        res.status(409).json({
          error: "Provider settings changed; refresh before saving",
          code: error.code,
        });
        return;
      }
      // A persistence or post-commit catalog failure may have saved the key.
      // Do not call it a rollback or include credential-bearing error details.
      logger.warn("Provider settings result could not be confirmed");
      res.status(503).json({
        error: "Provider settings result is unknown",
        code: "LLM_SETTINGS_UNCONFIRMED",
      });
    }
  });

  router.post("/settings/llm/test", testLimit, async (req, res) => {
    const parsed = TestLlmBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "Select a model explicitly",
        code: "LLM_TEST_INVALID",
      });
      return;
    }
    const started = Date.now();
    try {
      await writes;
      const before = await readState();
      if (
        parsed.data.expectedRevision !== undefined &&
        parsed.data.expectedRevision !== before.revision
      )
        throw new ProviderConfigConflict();
      const current = catalog();
      const model = current.models.find(
        (entry) => entry.id === parsed.data.model,
      );
      if (
        !model ||
        current.providers.find((entry) => entry.id === model.provider)
          ?.available !== true
      ) {
        res.status(400).json({
          ok: false,
          error: "Model or provider unavailable",
          code: "LLM_MODEL_UNAVAILABLE",
        });
        return;
      }
      await (dependencies.assertAllowed ?? assertExecutionAllowed)();
      const { completion, provider } = await (
        dependencies.complete ?? createChatCompletion
      )({
        model: model.id,
        messages: [{ role: "user", content: "Reply only with OK." }],
        maxTokens: 10,
        signal: AbortSignal.timeout(20_000),
        disableRetries: true,
      });
      const after = await readState();
      if (after.revision !== before.revision) {
        res.status(409).json({
          ok: false,
          error: "Settings changed during the test",
          code: "LLM_TEST_STALE",
        });
        return;
      }
      if (
        provider !== model.provider ||
        !completion.choices[0]?.message?.content?.trim()
      ) {
        res.status(502).json({
          ok: false,
          error: "No usable provider response",
          code: "LLM_TEST_EMPTY_RESPONSE",
          latencyMs: Date.now() - started,
        });
        return;
      }
      // The response body may contain sensitive upstream text; do not echo it.
      res.json({
        ok: true,
        provider,
        model: model.id,
        sample: "",
        revision: before.revision,
        latencyMs: Date.now() - started,
      });
    } catch (error) {
      const code =
        error instanceof ProviderConfigConflict
          ? error.code
          : error instanceof EmergencyStopError
            ? error.code
            : "LLM_TEST_FAILED";
      const status =
        error instanceof ProviderConfigConflict
          ? 409
          : error instanceof EmergencyStopError
            ? 423
            : 502;
      logger.warn({ code }, "Provider connection test was not confirmed");
      res.status(status).json({
        ok: false,
        error: "Provider connection test was not confirmed",
        code,
        latencyMs: Date.now() - started,
      });
    }
  });
  return router;
}

export function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 12) return "*".repeat(key.length);
  return `${key.slice(0, 4)}${"*".repeat(8)}${key.slice(-4)}`;
}
function safeOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}
function safeOllamaUrl(): string | null {
  try {
    return resolveOllamaEndpoint()?.openAIBaseUrl ?? null;
  } catch {
    return null;
  }
}
export default createSettingsRouter();
