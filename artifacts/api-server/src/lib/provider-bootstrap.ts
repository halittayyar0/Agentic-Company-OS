import {
  configureDirectOpenAI,
  configureOllama,
  configureOpenRouter,
  configureProviderRequestObserver,
  refreshModelCatalog,
} from "@workspace/ai-server";
import { logger } from "./logger";
import { chatgptConnectionRuntime } from "./chatgpt-connection-runtime";
import { configureChatGPTPlanRuntime } from "./chatgpt-plan-runtime";
import {
  readRuntimeConfig,
  effectiveOllamaCloudOrigin,
  type RuntimeConfig,
} from "./runtime-config";
import {
  installProviderRuntimeConfigGuard,
  prepareProviderRuntimeConfig,
} from "./provider-runtime-config";

export interface ProviderBootstrapDependencies {
  readRuntimeConfig(): Promise<RuntimeConfig>;
  configureOpenRouter(input: { apiKey: string | null }): void;
  configureDirectOpenAI(input: { apiKey: string | null }): void;
  configureOllama(input: {
    baseUrl: string | null;
    cloudOrigin?: string | null;
  }): void;
  configureChatGPTProvider?(): void;
  configureRequestObserver(observer: (metadata: unknown) => void): void;
  logProviderRequest(metadata: unknown): void;
  refreshModelCatalog(): Promise<void>;
  prepareRuntimeConfig?(environment: NodeJS.ProcessEnv): Promise<RuntimeConfig>;
  installRequestGuard?(environment: NodeJS.ProcessEnv): void;
}

const defaultDependencies: ProviderBootstrapDependencies = {
  readRuntimeConfig,
  configureOpenRouter,
  configureDirectOpenAI,
  configureOllama,
  configureChatGPTProvider() {
    configureChatGPTPlanRuntime(chatgptConnectionRuntime, {
      onQuotaPersistenceFailure() {
        logger.warn(
          "Could not persist ChatGPT plan quota pause; the current worker remains paused",
        );
      },
    });
  },
  configureRequestObserver(observer) {
    configureProviderRequestObserver((metadata) => observer(metadata));
  },
  logProviderRequest(metadata) {
    logger.info(metadata, "AI provider request completed");
  },
  refreshModelCatalog,
  prepareRuntimeConfig: prepareProviderRuntimeConfig,
  installRequestGuard: installProviderRuntimeConfigGuard,
};

/**
 * Gives API and worker processes the exact same server-side provider setup and
 * readiness boundary without importing Express or the scheduler.
 */
export async function bootstrapProviders(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: ProviderBootstrapDependencies = defaultDependencies,
): Promise<void> {
  const providerConfig = dependencies.prepareRuntimeConfig
    ? await dependencies.prepareRuntimeConfig(environment)
    : await dependencies.readRuntimeConfig();
  dependencies.configureOpenRouter({
    apiKey: providerConfig.openrouterApiKey ?? null,
  });
  dependencies.configureDirectOpenAI({
    apiKey: providerConfig.openaiApiKey ?? null,
  });
  dependencies.configureOllama({
    baseUrl:
      providerConfig.ollamaBaseUrl ??
      (environment.OLLAMA_BASE_URL?.trim() || null),
    ...(providerConfig.ollamaCloudOrigin !== undefined
      ? { cloudOrigin: effectiveOllamaCloudOrigin(providerConfig, environment) }
      : {}),
  });
  dependencies.configureChatGPTProvider?.();
  dependencies.configureRequestObserver((metadata) => {
    dependencies.logProviderRequest(metadata);
  });
  dependencies.installRequestGuard?.(environment);
  await dependencies.refreshModelCatalog();
}
