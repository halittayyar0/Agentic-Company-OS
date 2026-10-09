import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { observeCompletionResponseUsage } from "./completion-usage-observer";
import {
  createChatGPTPlanCompletion,
  getChatGPTPlanCatalogSnapshot,
  refreshChatGPTPlanCatalog,
} from "./chatgpt-plan-provider";
import {
  chatGPTPlanRequestId,
  PlanInferenceError,
  resolveChatGPTPlanModelId,
} from "./chatgpt-plan-responses";
import { openai } from "./client";
import {
  getDirectOpenAIClient,
  getDirectOpenAIModelCatalog,
  getOllamaCatalogSnapshot,
  getOllamaClient,
  isDirectOpenAIConfigured,
  isOllamaConfigured,
  refreshOllamaCatalog,
  resolveDirectOpenAIModelId,
  resolveOllamaModelId,
} from "./first-party-providers";
import {
  MODEL_CATALOG,
  getChatCompletionExtraParams,
  isKnownModelId,
  type ModelCatalogEntry,
  type ModelTier,
} from "./model-router";

/**
 * Provider-aware OpenAI-compatible routing.
 *
 * The Replit AI Integrations fleet stays exactly as it was. Any model id that
 * lives in the Replit fleet catalog keeps going through the existing `openai`
 * client. Vendor-prefixed ids route to OpenRouter, while direct OpenAI and
 * local Ollama use explicit public namespaces.
 *
 *   OPENROUTER_API_KEY       -- enable the provider
 *   The API origin is intentionally pinned to OpenRouter. Accepting a
 *   browser-configurable base URL would allow a malicious caller to redirect
 *   the Authorization header to an attacker-controlled server.
 */

export type ModelProvider =
  "replit" | "openrouter" | "openai" | "ollama" | "chatgpt";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Runtime-mutable provider state. The api-server injects credentials at
 * boot (from env OR a persisted runtime config file) and whenever the
 * operator updates them through the settings UI.
 */
const providerState = {
  openrouterApiKey: null as string | null,
};

export function configureOpenRouter(params: {
  apiKey: string | null | undefined;
  /** @deprecated OpenRouter's origin is security-pinned and cannot be overridden. */
  baseUrl?: string | null;
}): void {
  providerState.openrouterApiKey = params.apiKey?.trim() || null;
  _openrouter = null; // force client rebuild with new creds
}

export function resolveOpenRouterKey(): string | null {
  return (
    providerState.openrouterApiKey ?? process.env.OPENROUTER_API_KEY ?? null
  );
}

let _openrouter: OpenAI | null = null;

export function isOpenRouterConfigured(): boolean {
  return Boolean(resolveOpenRouterKey());
}

export function getOpenRouterClient(): OpenAI {
  const apiKey = resolveOpenRouterKey();
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY must be configured (env or Settings UI) to use OpenRouter models.",
    );
  }
  if (!_openrouter) {
    const defaultHeaders: Record<string, string> = {
      "X-Title": "Agentic Company OS",
    };
    const publicUrl = process.env.APP_PUBLIC_URL?.trim();
    if (publicUrl) {
      try {
        const parsed = new URL(publicUrl);
        if (
          (parsed.protocol === "https:" || parsed.protocol === "http:") &&
          !parsed.username &&
          !parsed.password
        ) {
          defaultHeaders["HTTP-Referer"] = parsed.origin;
        }
      } catch {
        // Invalid optional attribution never changes the provider endpoint.
      }
    }
    _openrouter = new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders,
    });
  }
  return _openrouter;
}

export interface OpenRouterModelEntry extends ModelCatalogEntry {
  provider: ModelProvider;
}

/**
 * Small, verified fallback catalog for offline/error states.
 *
 * This is not the source of truth. The selectable OpenRouter list comes from
 * the live Models API; these entries only keep the picker useful when that
 * metadata endpoint is temporarily unreachable.
 */
export const OPENROUTER_MODEL_CATALOG: OpenRouterModelEntry[] = [
  {
    id: "minimax/minimax-m3:free",
    tier: "economy" as ModelTier,
    label: "MiniMax M3 (free)",
    supportsTools: true,
    description:
      "1M bağlam · ücretsiz · kodlama, araç kullanımı ve uzun soluklu ajan görevleri için.",
    provider: "openrouter",
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    tier: "premium" as ModelTier,
    label: "Claude Sonnet 4.5",
    supportsTools: true,
    description:
      "Dengeli ustalik; uzun baglam (1M), kod ve analitik isler icin guclu genel secim.",
    provider: "openrouter",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    tier: "economy" as ModelTier,
    label: "Claude Haiku 4.5",
    supportsTools: true,
    description:
      "Hizli ve ekonomik; rutin adimlar, judge ve siniflandirma icin.",
    provider: "openrouter",
  },
  {
    id: "google/gemini-2.5-flash",
    tier: "standard" as ModelTier,
    label: "Gemini 2.5 Flash",
    supportsTools: true,
    description:
      "Cok hizli, genis baglamli ve uygun maliyetli cok yonlu model.",
    provider: "openrouter",
  },
  {
    id: "deepseek/deepseek-v3.2",
    tier: "standard" as ModelTier,
    label: "DeepSeek V3.2",
    supportsTools: true,
    description: "Guclu akil yurutme/kodlama yapan acik agirlikli model.",
    provider: "openrouter",
  },
  {
    id: "deepseek/deepseek-r1",
    tier: "reasoning" as ModelTier,
    label: "DeepSeek R1",
    supportsTools: true,
    description: "Derin, cok adimli muhakeme gerektiren gorevler icin.",
    provider: "openrouter",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    tier: "standard" as ModelTier,
    label: "Llama 3.3 70B",
    supportsTools: true,
    description: "Acik kaynakli, saglam genel amacli sohbet modeli.",
    provider: "openrouter",
  },
];

// ---------------------------------------------------------------------------
// Live OpenRouter catalog sync
// ---------------------------------------------------------------------------

interface RemoteOpenRouterModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  pricing?: unknown;
  supported_parameters?: unknown;
}

const liveCatalog = {
  models: [] as OpenRouterModelEntry[],
  fetchedAt: 0,
  lastAttemptAt: 0,
};

const OPENROUTER_CATALOG_TTL_MS = 30 * 60_000;
const OPENROUTER_CATALOG_RETRY_MS = 60_000;
const OPENROUTER_PAGE_SIZE = 1_000;
const OPENROUTER_MAX_MODELS = 5_000;
let catalogRefreshPromise: Promise<OpenRouterModelEntry[]> | null = null;

/**
 * Fetches the complete live text-output model list from OpenRouter and caches
 * it for 30 minutes. Concurrent callers join the same refresh, failed refreshes
 * serve the last known-good result, and every API-returned variant (including
 * `:free` and `:thinking`) remains selectable.
 */
export async function fetchLiveOpenRouterCatalog(
  force = false,
): Promise<OpenRouterModelEntry[]> {
  const now = Date.now();
  if (
    !force &&
    liveCatalog.models.length > 0 &&
    now - liveCatalog.fetchedAt < OPENROUTER_CATALOG_TTL_MS
  ) {
    return liveCatalog.models;
  }
  if (!force && now - liveCatalog.lastAttemptAt < OPENROUTER_CATALOG_RETRY_MS) {
    return liveCatalog.models;
  }
  if (catalogRefreshPromise) return catalogRefreshPromise;

  const refresh = refreshLiveOpenRouterCatalog();
  catalogRefreshPromise = refresh;
  try {
    return await refresh;
  } finally {
    if (catalogRefreshPromise === refresh) catalogRefreshPromise = null;
  }
}

async function refreshLiveOpenRouterCatalog(): Promise<OpenRouterModelEntry[]> {
  liveCatalog.lastAttemptAt = Date.now();
  try {
    const rawModels: RemoteOpenRouterModel[] = [];
    let offset = 0;
    let totalCount: number | null = null;

    while (offset < OPENROUTER_MAX_MODELS) {
      const url = new URL(`${OPENROUTER_BASE_URL}/models`);
      url.searchParams.set("output_modalities", "text");
      url.searchParams.set("limit", String(OPENROUTER_PAGE_SIZE));
      url.searchParams.set("offset", String(offset));

      const response = await fetchOpenRouterModelsPage(url);
      const payload = (await response.json()) as unknown;
      const page = parseModelsPage(payload);
      rawModels.push(...page.models);
      totalCount ??= page.totalCount;

      if (page.models.length === 0) break;
      offset += page.models.length;
      if (totalCount !== null && offset >= totalCount) break;
      if (totalCount === null && page.models.length < OPENROUTER_PAGE_SIZE)
        break;
    }

    const entries = normalizeOpenRouterModels(rawModels);
    if (entries.length === 0) {
      throw new Error("OpenRouter Models API returned an empty catalog");
    }
    liveCatalog.models = entries;
    liveCatalog.fetchedAt = Date.now();
    return entries;
  } catch {
    // Preserve the last known-good live result. The verified fallback remains
    // visible when no successful live sync has happened yet.
    return liveCatalog.models;
  }
}

async function fetchOpenRouterModelsPage(url: URL): Promise<Response> {
  // The Models API is public. Never attach the inference credential to a
  // metadata request; this removes redirect/header-forwarding risk entirely.
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter Models API returned ${response.status}`);
  }
  return response;
}

function parseModelsPage(payload: unknown): {
  models: RemoteOpenRouterModel[];
  totalCount: number | null;
} {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("OpenRouter Models API returned an invalid payload");
  }
  const rawTotal = payload.total_count;
  const totalCount =
    typeof rawTotal === "number" &&
    Number.isSafeInteger(rawTotal) &&
    rawTotal >= 0
      ? Math.min(rawTotal, OPENROUTER_MAX_MODELS)
      : null;
  return {
    models: payload.data.slice(0, OPENROUTER_MAX_MODELS),
    totalCount,
  };
}

/** Normalizes untrusted OpenRouter metadata without dropping model variants. */
export function normalizeOpenRouterModels(
  rawModels: RemoteOpenRouterModel[],
): OpenRouterModelEntry[] {
  const seen = new Set<string>();
  const entries: OpenRouterModelEntry[] = [];

  for (const raw of rawModels.slice(0, OPENROUTER_MAX_MODELS)) {
    if (!isRecord(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (
      !id ||
      id.length > 256 ||
      !isSafeOpenRouterModelId(id) ||
      seen.has(id)
    ) {
      continue;
    }
    seen.add(id);

    const name = sanitizeCatalogText(raw.name, 256) || id;
    entries.push({
      id,
      tier: inferTier(raw),
      label: shortLabel(name),
      description: buildDescription(raw),
      supportsTools:
        Array.isArray(raw.supported_parameters) &&
        raw.supported_parameters.includes("tools"),
      provider: "openrouter",
    });
  }

  return entries;
}

/**
 * OpenRouter model metadata is remote, untrusted UI input. Keep the complete
 * current ID grammar (including aliases prefixed with `~`) while rejecting
 * Unicode lookalikes, bidi controls, zero-width characters, whitespace and
 * URL/query delimiters that could spoof a picker row or an audit log.
 */
function isSafeOpenRouterModelId(id: string): boolean {
  return /^[~A-Za-z0-9._-]+\/[~A-Za-z0-9._:+-]+$/u.test(id);
}

function sanitizeCatalogText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function inferTier(m: RemoteOpenRouterModel): ModelTier {
  const pricing = isRecord(m.pricing) ? m.pricing : {};
  const promptPrice = parsePrice(pricing.prompt);
  const completionPrice = parsePrice(pricing.completion);
  if (promptPrice === 0 && completionPrice === 0) return "economy";
  const id = typeof m.id === "string" ? m.id : "";
  const name = typeof m.name === "string" ? m.name : "";
  if (
    /(?:^|[/:._ -])(?:r1|reasoning|thinking)(?:$|[/:._ -])/i.test(
      `${id} ${name}`,
    )
  ) {
    return "reasoning";
  }
  if (promptPrice === null) return "standard";
  if (promptPrice <= 0.0000015) return "economy"; // <= $1.5/M
  if (promptPrice >= 0.000008) return "premium"; // >= $8/M
  return "standard";
}

function shortLabel(name: string): string {
  // "Anthropic: Claude Sonnet 4.5" -> "Claude Sonnet 4.5"
  const withoutVendor = name.includes(": ")
    ? name.split(": ").slice(1).join(": ")
    : name;
  return sanitizeCatalogText(withoutVendor, 72);
}

function buildDescription(m: RemoteOpenRouterModel): string {
  const contextLength =
    typeof m.context_length === "number" &&
    Number.isFinite(m.context_length) &&
    m.context_length > 0
      ? m.context_length
      : null;
  const ctx = contextLength
    ? `${formatContextLength(contextLength)} bağlam`
    : null;
  const pricing = isRecord(m.pricing) ? m.pricing : null;
  const price = pricing
    ? pricingSummary(pricing.prompt, pricing.completion)
    : null;
  const rawDescription = sanitizeCatalogText(m.description, 1_000);
  const firstSentence = rawDescription.split(/(?<=[.!?])\s/u)[0]?.slice(0, 140);
  return (
    [ctx, price, firstSentence].filter(Boolean).join(" · ") ||
    "OpenRouter canlı model kataloğu."
  );
}

function pricingSummary(prompt?: unknown, completion?: unknown): string | null {
  const promptPrice = parsePrice(prompt);
  const completionPrice = parsePrice(completion);
  if (promptPrice === null && completionPrice === null) return null;
  const fmt = (value: number | null) => {
    if (value === null) return "?";
    const perMillion = value * 1_000_000;
    if (perMillion === 0) return "ücretsiz";
    return `$${perMillion < 1 ? perMillion.toFixed(2) : perMillion.toFixed(1)}/M`;
  };
  return `girdi ${fmt(promptPrice)} / çıktı ${fmt(completionPrice)}`;
}

function parsePrice(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatContextLength(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number(millions.toFixed(1))}M`;
  }
  return `${Math.round(tokens / 1_000)}K`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolves which backend serves a given model id. */
export function resolveModelProvider(modelId: string): ModelProvider | null {
  if (resolveChatGPTPlanModelId(modelId)) return "chatgpt";
  if (!modelId) return null;
  if (isKnownModelId(modelId)) return "replit";
  if (resolveDirectOpenAIModelId(modelId)) return "openai";
  if (resolveOllamaModelId(modelId)) return "ollama";
  const hit = OPENROUTER_MODEL_CATALOG.some((m) => m.id === modelId);
  if (hit) return "openrouter";
  // OpenRouter supports aliases and newly published ids before a local cache
  // refresh. Preserve that forward compatibility, but only for the same
  // display-safe ASCII grammar accepted from the live catalog.
  if (isSafeOpenRouterModelId(modelId)) return "openrouter";
  return null;
}

export interface UnifiedChatCompletionParams {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  maxTokens?: number;
  responseFormat?: { type: "json_object" | "text" };
  signal?: AbortSignal;
  /** Diagnostics can opt out of SDK retries to bound billable attempts. */
  disableRetries?: boolean;
  /** Host-owned, call-local durable admission. Awaited once immediately before
   * inference transport, after local provider/credential validation. */
  beforeRequest?: () => Promise<void>;
  /** Host-owned parsed usage observer; never serialized or globally shared. */
  onResponseUsage?: (
    evidence: import("./completion-usage-observer").ResponseUsageEvidence,
  ) => Promise<void>;
}

/** Plan preview rejects an output-token ceiling. The host retains its own
 * admission budgets; they are not an upstream cap on an in-flight response. */
export function completionTokenControl(
  model: string,
  limit: number,
): { maxTokens?: number } {
  return resolveChatGPTPlanModelId(model) ? {} : { maxTokens: limit };
}

export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 120_000;
const MIN_LLM_REQUEST_TIMEOUT_MS = 5_000;
const MAX_LLM_REQUEST_TIMEOUT_MS = 10 * 60_000;

export class ChatCompletionTimeoutError extends Error {
  readonly code = "LLM_REQUEST_TIMEOUT";
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`LLM request exceeded the ${timeoutMs}ms runtime deadline`);
    this.name = "ChatCompletionTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function resolveLlmRequestTimeoutMs(
  raw = process.env.LLM_REQUEST_TIMEOUT_MS,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LLM_REQUEST_TIMEOUT_MS;
  }
  return Math.min(
    MAX_LLM_REQUEST_TIMEOUT_MS,
    Math.max(MIN_LLM_REQUEST_TIMEOUT_MS, Math.floor(parsed)),
  );
}

/**
 * Applies a hard promise deadline as well as an AbortSignal. The promise race
 * protects capacity even if a provider client is slow to observe abort.
 */
export async function withChatCompletionTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal,
  timeoutMs = resolveLlmRequestTimeoutMs(),
): Promise<T> {
  const timeoutController = new AbortController();
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutController.signal])
    : timeoutController.signal;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let removeAbortListener: () => void = () => {};

  const abortPromise = new Promise<never>((_resolve, reject) => {
    const rejectForAbort = () => {
      if (timeoutController.signal.aborted && !callerSignal?.aborted) {
        reject(new ChatCompletionTimeoutError(timeoutMs));
        return;
      }
      reject(
        callerSignal?.reason instanceof Error
          ? callerSignal.reason
          : new DOMException("The request was aborted", "AbortError"),
      );
    };
    if (signal.aborted) {
      rejectForAbort();
      return;
    }
    signal.addEventListener("abort", rejectForAbort, { once: true });
    removeAbortListener = () =>
      signal.removeEventListener("abort", rejectForAbort);
  });

  timer = setTimeout(
    () => {
      timeoutController.abort(
        new DOMException("The operation timed out", "TimeoutError"),
      );
    },
    Math.max(1, timeoutMs),
  );
  timer.unref?.();

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(signal)),
      abortPromise,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    removeAbortListener();
  }
}

export type UnifiedCompletion = OpenAI.Chat.Completions.ChatCompletion;

export interface ProviderRequestMetadata {
  provider: ModelProvider;
  model: string;
  requestId: string | null;
  clientRequestId: string | null;
  outcome: "success" | "error";
}

let providerRequestObserver:
  ((metadata: ProviderRequestMetadata) => void) | null = null;
let providerRequestGuard: (() => Promise<void>) | null = null;

/**
 * Lets the host application route safe provider request metadata through its
 * structured logger without coupling this library to a logging framework.
 * Prompts, responses, headers, URLs, and credentials are never emitted.
 */
export function configureProviderRequestObserver(
  observer: ((metadata: ProviderRequestMetadata) => void) | null,
): void {
  providerRequestObserver = observer;
}

/**
 * Installs a host-owned fail-closed boundary that runs immediately before
 * every provider request. Split runtimes use it to apply the latest durable
 * credential revision; a database, decrypt or apply failure prevents any
 * network call with stale credentials.
 */
export function configureProviderRequestGuard(
  guard: (() => Promise<void>) | null,
): void {
  providerRequestGuard = guard;
}

function observeProviderRequest(metadata: ProviderRequestMetadata): void {
  try {
    providerRequestObserver?.(metadata);
  } catch {
    // Observability must never turn a completed model request into a failure.
  }
}

function providerRequestIdFromError(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const requestId = (error as { request_id?: unknown }).request_id;
  return typeof requestId === "string" && requestId.length <= 256
    ? requestId
    : null;
}

/**
 * Provider-aware chat completion entrypoint.
 *
 * - Replit fleet models keep every legacy behavior intact, including the
 *   mandatory `reasoning_effort: "none"` when tools are attached.
 * - OpenRouter models are called via the OpenRouter client with plain
 *   `max_tokens` semantics and no reasoning_effort injection.
 */
export async function createChatCompletion(
  params: UnifiedChatCompletionParams,
): Promise<{ completion: UnifiedCompletion; provider: ModelProvider }> {
  const { model, messages, tools, maxTokens, responseFormat, signal } = params;
  if (resolveChatGPTPlanModelId(model)) {
    // The plan stream owns its deadline so cancellation retains observed usage.
    // An outer generic race could discard that accounting when it wins first.
    await withChatCompletionTimeout(
      async () => providerRequestGuard?.(),
      signal,
    );
    try {
      const completion = await createChatGPTPlanCompletion(
        params,
        resolveLlmRequestTimeoutMs(),
      );
      observeProviderRequest({
        provider: "chatgpt",
        model,
        requestId: chatGPTPlanRequestId(completion),
        clientRequestId: null,
        outcome: "success",
      });
      return { completion, provider: "chatgpt" };
    } catch (error) {
      observeProviderRequest({
        provider: "chatgpt",
        model,
        requestId: error instanceof PlanInferenceError ? error.requestId : null,
        clientRequestId: null,
        outcome: "error",
      });
      throw error;
    }
  }
  return withChatCompletionTimeout(async (boundedSignal) => {
    await providerRequestGuard?.();
    const dispatch = async () => {
      boundedSignal.throwIfAborted();
      await params.beforeRequest?.();
      boundedSignal.throwIfAborted();
    };
    // Legacy fleet always wins for known Replit model ids.
    if (isKnownModelId(model)) {
      const client = openai.chat.completions;
      await dispatch();
      const completion = await client.create(
        {
          model,
          messages,
          tools: tools && tools.length > 0 ? tools : undefined,
          max_completion_tokens: maxTokens,
          ...(responseFormat ? { response_format: responseFormat } : {}),
          ...getChatCompletionExtraParams(model, Boolean(tools?.length)),
        },
        {
          signal: boundedSignal,
          maxRetries: params.disableRetries ? 0 : undefined,
        },
      );
      await observeCompletionResponseUsage(params, completion, "replit");
      return { completion, provider: "replit" as const };
    }

    if (resolveModelProvider(model) === "openrouter") {
      const client = getOpenRouterClient();
      await dispatch();
      const completion = await client.chat.completions.create(
        {
          model,
          messages,
          tools: tools && tools.length > 0 ? tools : undefined,
          max_tokens: maxTokens,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        },
        {
          signal: boundedSignal,
          maxRetries: params.disableRetries ? 0 : undefined,
        },
      );
      await observeCompletionResponseUsage(params, completion, "openrouter");
      return { completion, provider: "openrouter" as const };
    }

    const directOpenAIModel = resolveDirectOpenAIModelId(model);
    if (directOpenAIModel) {
      const client = getDirectOpenAIClient();
      const clientRequestId = randomUUID();
      await dispatch();
      try {
        const result = await client.chat.completions
          .create(
            {
              model: directOpenAIModel,
              messages,
              tools: tools && tools.length > 0 ? tools : undefined,
              max_completion_tokens: maxTokens,
              ...(responseFormat ? { response_format: responseFormat } : {}),
              ...getChatCompletionExtraParams(
                directOpenAIModel,
                Boolean(tools?.length),
              ),
            },
            {
              signal: boundedSignal,
              maxRetries: params.disableRetries ? 0 : undefined,
              headers: { "X-Client-Request-Id": clientRequestId },
            },
          )
          .withResponse();
        observeProviderRequest({
          provider: "openai",
          model: directOpenAIModel,
          requestId: result.request_id ?? null,
          clientRequestId,
          outcome: "success",
        });
        await observeCompletionResponseUsage(params, result.data, "openai");
        return { completion: result.data, provider: "openai" as const };
      } catch (error) {
        observeProviderRequest({
          provider: "openai",
          model: directOpenAIModel,
          requestId: providerRequestIdFromError(error),
          clientRequestId,
          outcome: "error",
        });
        throw error;
      }
    }

    const ollamaModel = resolveOllamaModelId(model);
    if (ollamaModel) {
      const client = getOllamaClient();
      await dispatch();
      const completion = await client.chat.completions.create(
        {
          model: ollamaModel,
          messages,
          tools: tools && tools.length > 0 ? tools : undefined,
          max_tokens: maxTokens,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        },
        {
          signal: boundedSignal,
          maxRetries: params.disableRetries ? 0 : undefined,
        },
      );
      await observeCompletionResponseUsage(params, completion, "ollama");
      return { completion, provider: "ollama" as const };
    }

    throw new Error(`Unknown model "${model}" (no provider resolves it).`);
  }, signal);
}

/** Full catalog across providers plus live availability flags. */
export function getFullModelCatalog(): {
  providers: Array<{
    id: ModelProvider;
    label: string;
    available: boolean;
  }>;
  models: Array<
    ModelCatalogEntry & { provider: ModelProvider; isDefault: boolean }
  >;
  liveSyncedAt: number | null;
} {
  const replitAvailable = Boolean(
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  );

  const replitModels = MODEL_CATALOG.map((m) => ({
    ...m,
    provider: "replit" as ModelProvider,
    isDefault: m.id === "gpt-5.6-terra",
  }));

  const sourceModels =
    liveCatalog.models.length > 0
      ? rankOpenRouterModels(liveCatalog.models)
      : OPENROUTER_MODEL_CATALOG;
  const openRouterModels = sourceModels.map((model) => ({
    ...model,
    isDefault: false,
  }));
  const directOpenAIModels = getDirectOpenAIModelCatalog().map((model) => ({
    ...model,
    isDefault: model.id === "openai:gpt-5.6-terra",
  }));
  const ollamaModels = getOllamaCatalogSnapshot().models.map((model) => ({
    ...model,
    isDefault: false,
  }));
  const chatgpt = getChatGPTPlanCatalogSnapshot();

  return {
    providers: [
      {
        id: "replit",
        label: "Yerlesik Filo (Replit AI)",
        available: replitAvailable,
      },
      {
        id: "openrouter",
        label: "OpenRouter",
        available: isOpenRouterConfigured(),
      },
      {
        id: "openai",
        label: "OpenAI (doğrudan)",
        available: isDirectOpenAIConfigured(),
      },
      {
        id: "ollama",
        label: "Ollama (yerel)",
        available: isOllamaConfigured(),
      },
      { id: "chatgpt", label: "ChatGPT plan", available: chatgpt.available },
    ],
    models: [
      ...replitModels,
      ...openRouterModels,
      ...directOpenAIModels,
      ...ollamaModels,
      ...chatgpt.models.map((model) => ({
        ...model,
        provider: "chatgpt" as const,
        isDefault: false,
      })),
    ],
    liveSyncedAt: liveCatalog.fetchedAt || null,
  };
}

/**
 * Refreshes the live portion of the catalog. Called by the settings route
 * before serving the catalog so the UI always sees the full list.
 */
export async function refreshModelCatalog(force = false): Promise<void> {
  await Promise.all([
    fetchLiveOpenRouterCatalog(force),
    refreshOllamaCatalog(force),
    refreshChatGPTPlanCatalog(force),
  ]);
}

function rankOpenRouterModels(
  models: OpenRouterModelEntry[],
): OpenRouterModelEntry[] {
  const priority = new Map(
    OPENROUTER_MODEL_CATALOG.map((model, index) => [model.id, index]),
  );
  return [...models].sort((left, right) => {
    const leftRank = priority.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = priority.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.label.localeCompare(right.label, "en", {
      sensitivity: "base",
      numeric: true,
    });
  });
}
