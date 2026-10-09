import { isIP } from "node:net";
import OpenAI from "openai";
import pLimit from "p-limit";
import type { ModelCatalogEntry, ModelTier } from "./model-router";

export type FirstPartyModelProvider = "openai" | "ollama";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_MODEL_PREFIX = "openai:";
export const OLLAMA_MODEL_PREFIX = "ollama:";

const providerState = {
  openaiApiKey: null as string | null,
  ollamaBaseUrl: null as string | null,
};

let directOpenAIClient: OpenAI | null = null;
let ollamaClient: OpenAI | null = null;
let ollamaClientBaseUrl: string | null = null;

export function configureDirectOpenAI(params: {
  apiKey: string | null | undefined;
}): void {
  providerState.openaiApiKey = params.apiKey?.trim() || null;
  directOpenAIClient = null;
}

export function resolveDirectOpenAIKey(): string | null {
  return (
    providerState.openaiApiKey ?? process.env.OPENAI_API_KEY?.trim() ?? null
  );
}

export function isDirectOpenAIConfigured(): boolean {
  return Boolean(resolveDirectOpenAIKey());
}

export function getDirectOpenAIClient(): OpenAI {
  const apiKey = resolveDirectOpenAIKey();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY must be configured (env, secret manager, or Settings UI) to use direct OpenAI models.",
    );
  }
  directOpenAIClient ??= new OpenAI({
    apiKey,
    // Credential traffic is intentionally pinned to OpenAI's first-party API.
    // Neither HTTP clients nor the Settings API can override this value.
    baseURL: OPENAI_BASE_URL,
    fetch: (input, init) => globalThis.fetch(input, init),
  });
  return directOpenAIClient;
}

const DIRECT_OPENAI_MODELS: Array<ModelCatalogEntry & { upstreamId: string }> =
  [
    {
      id: `${OPENAI_MODEL_PREFIX}gpt-5.6-luna`,
      upstreamId: "gpt-5.6-luna",
      tier: "economy",
      label: "GPT-5.6 Luna",
      supportsTools: true,
      description:
        "OpenAI doğrudan · hızlı, yüksek hacimli ve maliyet duyarlı ajan işleri.",
    },
    {
      id: `${OPENAI_MODEL_PREFIX}gpt-5.6-terra`,
      upstreamId: "gpt-5.6-terra",
      tier: "standard",
      label: "GPT-5.6 Terra",
      supportsTools: true,
      description:
        "OpenAI doğrudan · yetenek, hız ve maliyet arasında dengeli genel seçim.",
    },
    {
      id: `${OPENAI_MODEL_PREFIX}gpt-5.6-sol`,
      upstreamId: "gpt-5.6-sol",
      tier: "premium",
      label: "GPT-5.6 Sol",
      supportsTools: true,
      description:
        "OpenAI doğrudan · karmaşık profesyonel çalışma ve kritik kararlar.",
    },
  ];

const SAFE_UPSTREAM_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/**
 * Additional direct OpenAI aliases are server-admin configuration only. They
 * are namespaced in the public catalog so they can never collide with the
 * legacy Replit fleet's model IDs.
 */
export function getDirectOpenAIModelCatalog(): Array<
  ModelCatalogEntry & { provider: "openai" }
> {
  const configured = (process.env.OPENAI_MODEL_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => SAFE_UPSTREAM_MODEL_ID.test(value));
  const seen = new Set(DIRECT_OPENAI_MODELS.map((model) => model.upstreamId));
  const extras: Array<ModelCatalogEntry & { upstreamId: string }> = [];
  for (const upstreamId of configured.slice(0, 50)) {
    if (seen.has(upstreamId)) continue;
    seen.add(upstreamId);
    extras.push({
      id: `${OPENAI_MODEL_PREFIX}${upstreamId}`,
      upstreamId,
      tier: "standard",
      label: upstreamId,
      supportsTools: true,
      description:
        "OpenAI doğrudan · sunucu yöneticisinin izin verdiği özel model kimliği.",
    });
  }
  return [...DIRECT_OPENAI_MODELS, ...extras].map(
    ({ upstreamId: _upstreamId, ...model }) => ({
      ...model,
      provider: "openai" as const,
    }),
  );
}

export function resolveDirectOpenAIModelId(modelId: string): string | null {
  if (!modelId.startsWith(OPENAI_MODEL_PREFIX)) return null;
  const upstreamId = modelId.slice(OPENAI_MODEL_PREFIX.length);
  if (!SAFE_UPSTREAM_MODEL_ID.test(upstreamId)) return null;
  return getDirectOpenAIModelCatalog().some((model) => model.id === modelId)
    ? upstreamId
    : null;
}

export interface ValidatedOllamaEndpoint {
  origin: string;
  openAIBaseUrl: string;
}

/**
 * Ollama receives prompts, so its target is a data-egress boundary. Only
 * literal loopback/RFC1918/ULA addresses and two explicit local host aliases
 * are accepted. Link-local and cloud-metadata ranges are intentionally not.
 */
export function validateOllamaBaseUrl(raw: string): ValidatedOllamaEndpoint {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2_048) {
    throw new Error("OLLAMA_BASE_URL is empty or too long.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("OLLAMA_BASE_URL must be an absolute HTTP(S) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OLLAMA_BASE_URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      "OLLAMA_BASE_URL cannot include credentials, query, or hash.",
    );
  }
  if (!["", "/", "/v1", "/v1/"].includes(parsed.pathname)) {
    throw new Error("OLLAMA_BASE_URL path must be empty or /v1.");
  }

  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[/u, "")
    .replace(/\]$/u, "");
  if (!isAllowedOllamaHost(hostname)) {
    throw new Error(
      "OLLAMA_BASE_URL must target localhost, host.docker.internal, or a private IP literal.",
    );
  }

  // Ollama's default port is chosen explicitly instead of allowing an omitted
  // port to silently target a private HTTP(S) service on port 80/443.
  if (!parsed.port) parsed.port = "11434";
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  const origin = parsed.origin;
  return { origin, openAIBaseUrl: new URL("/v1", origin).toString() };
}

function isAllowedOllamaHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "host.docker.internal") {
    return true;
  }
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return isPrivateIPv4(hostname);
  if (ipVersion === 6) {
    const normalized = hostname.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd")
    );
  }
  return false;
}

function isPrivateIPv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [first = -1, second = -1] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function configureOllama(params: {
  baseUrl: string | null | undefined;
}): void {
  const next = params.baseUrl?.trim() || null;
  if (providerState.ollamaBaseUrl !== next) {
    ollamaCatalogGeneration += 1;
    ollamaCatalog.models = [];
    ollamaCatalog.fetchedAt = 0;
    ollamaCatalog.lastAttemptAt = 0;
    ollamaCatalog.reachable = false;
    ollamaCatalog.error = null;
    // A previous endpoint's discovery remains bounded by its request deadlines,
    // but cannot own the new endpoint's refresh or publish into its catalog.
    ollamaRefreshPromise = null;
  }
  providerState.ollamaBaseUrl = next;
  ollamaClient = null;
  ollamaClientBaseUrl = null;
}

export function resolveOllamaEndpoint(): ValidatedOllamaEndpoint | null {
  const raw =
    providerState.ollamaBaseUrl ?? process.env.OLLAMA_BASE_URL?.trim();
  if (!raw) return null;
  return validateOllamaBaseUrl(raw);
}

export function isOllamaConfigured(): boolean {
  try {
    return resolveOllamaEndpoint() !== null;
  } catch {
    return false;
  }
}

export function getOllamaConfigurationError():
  "invalid_private_endpoint" | null {
  const raw =
    providerState.ollamaBaseUrl ?? process.env.OLLAMA_BASE_URL?.trim();
  if (!raw) return null;
  try {
    validateOllamaBaseUrl(raw);
    return null;
  } catch {
    return "invalid_private_endpoint";
  }
}

export function getOllamaClient(): OpenAI {
  const endpoint = resolveOllamaEndpoint();
  if (!endpoint) {
    throw new Error(
      "OLLAMA_BASE_URL must be configured to use local Ollama models.",
    );
  }
  if (!ollamaClient || ollamaClientBaseUrl !== endpoint.openAIBaseUrl) {
    ollamaClient = new OpenAI({
      apiKey: "ollama-local",
      baseURL: endpoint.openAIBaseUrl,
      fetch: (input, init) => globalThis.fetch(input, init),
    });
    ollamaClientBaseUrl = endpoint.openAIBaseUrl;
  }
  return ollamaClient;
}

interface OllamaTagsPayload {
  models?: unknown;
}

interface OllamaTagRow {
  name?: unknown;
  model?: unknown;
  details?: unknown;
}

interface OllamaShowPayload {
  capabilities?: unknown;
  details?: unknown;
}

export interface OllamaCatalogSnapshot {
  models: Array<ModelCatalogEntry & { provider: "ollama" }>;
  fetchedAt: number | null;
  reachable: boolean;
  error: "unreachable" | "invalid_private_endpoint" | null;
}

const ollamaCatalog = {
  models: [] as Array<ModelCatalogEntry & { provider: "ollama" }>,
  fetchedAt: 0,
  lastAttemptAt: 0,
  reachable: false,
  error: null as OllamaCatalogSnapshot["error"],
};

const OLLAMA_CATALOG_TTL_MS = 5 * 60_000;
const OLLAMA_CATALOG_RETRY_MS = 30_000;
const OLLAMA_MAX_MODELS = 100;
let ollamaRefreshPromise: Promise<OllamaCatalogSnapshot> | null = null;
let ollamaCatalogGeneration = 0;

export function getOllamaCatalogSnapshot(): OllamaCatalogSnapshot {
  const configurationError = getOllamaConfigurationError();
  return {
    models: [...ollamaCatalog.models],
    fetchedAt: ollamaCatalog.fetchedAt || null,
    reachable: ollamaCatalog.reachable,
    error: configurationError ?? ollamaCatalog.error,
  };
}

export async function refreshOllamaCatalog(
  force = false,
): Promise<OllamaCatalogSnapshot> {
  const now = Date.now();
  if (!isOllamaConfigured()) {
    ollamaCatalog.reachable = false;
    ollamaCatalog.error = getOllamaConfigurationError();
    return getOllamaCatalogSnapshot();
  }
  if (
    !force &&
    ollamaCatalog.fetchedAt > 0 &&
    now - ollamaCatalog.fetchedAt < OLLAMA_CATALOG_TTL_MS
  ) {
    return getOllamaCatalogSnapshot();
  }
  if (!force && now - ollamaCatalog.lastAttemptAt < OLLAMA_CATALOG_RETRY_MS) {
    return getOllamaCatalogSnapshot();
  }
  if (ollamaRefreshPromise) return ollamaRefreshPromise;

  const refresh = refreshOllamaCatalogFromEndpoint(ollamaCatalogGeneration);
  ollamaRefreshPromise = refresh;
  try {
    return await refresh;
  } finally {
    if (ollamaRefreshPromise === refresh) ollamaRefreshPromise = null;
  }
}

async function refreshOllamaCatalogFromEndpoint(
  generation: number,
): Promise<OllamaCatalogSnapshot> {
  ollamaCatalog.lastAttemptAt = Date.now();
  const endpoint = resolveOllamaEndpoint();
  if (!endpoint) return getOllamaCatalogSnapshot();

  try {
    const tagsUrl = new URL("/api/tags", endpoint.origin);
    const tagsResponse = await fetch(tagsUrl, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!tagsResponse.ok) {
      throw new Error(`Ollama tags endpoint returned ${tagsResponse.status}`);
    }
    const payload = (await tagsResponse.json()) as OllamaTagsPayload;
    if (generation !== ollamaCatalogGeneration)
      return getOllamaCatalogSnapshot();
    if (!Array.isArray(payload.models)) {
      throw new Error("Ollama tags response is invalid.");
    }
    const rows = payload.models
      .slice(0, OLLAMA_MAX_MODELS)
      .filter(isRecord) as OllamaTagRow[];
    const limit = pLimit(4);
    const entries = await Promise.all(
      rows.map((row) => limit(() => normalizeOllamaModel(endpoint, row))),
    );
    if (generation !== ollamaCatalogGeneration)
      return getOllamaCatalogSnapshot();
    ollamaCatalog.models = entries
      .filter(
        (model): model is ModelCatalogEntry & { provider: "ollama" } =>
          model !== null,
      )
      .sort((left, right) => left.label.localeCompare(right.label, "en"));
    ollamaCatalog.fetchedAt = Date.now();
    ollamaCatalog.reachable = true;
    ollamaCatalog.error = null;
  } catch {
    if (generation !== ollamaCatalogGeneration)
      return getOllamaCatalogSnapshot();
    // Preserve the last known-good catalog without exposing upstream response
    // bodies, URLs, or model-provided text through the Settings contract.
    ollamaCatalog.reachable = false;
    ollamaCatalog.error = "unreachable";
  }
  return getOllamaCatalogSnapshot();
}

async function normalizeOllamaModel(
  endpoint: ValidatedOllamaEndpoint,
  row: OllamaTagRow,
): Promise<(ModelCatalogEntry & { provider: "ollama" }) | null> {
  const upstreamId =
    safeOllamaModelId(row.model) ?? safeOllamaModelId(row.name);
  if (!upstreamId) return null;

  let show: OllamaShowPayload | null = null;
  try {
    const showResponse = await fetch(new URL("/api/show", endpoint.origin), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: upstreamId, verbose: false }),
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (showResponse.ok)
      show = (await showResponse.json()) as OllamaShowPayload;
  } catch {
    // Discovery remains useful, but unknown capability is fail-closed below.
  }

  const capabilities = Array.isArray(show?.capabilities)
    ? show.capabilities.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const details = isRecord(show?.details)
    ? show.details
    : isRecord(row.details)
      ? row.details
      : {};
  const parameterSize = sanitizeText(details.parameter_size, 24);
  const quantization = sanitizeText(details.quantization_level, 24);
  const supportsTools = capabilities.includes("tools");

  return {
    id: `${OLLAMA_MODEL_PREFIX}${upstreamId}`,
    provider: "ollama",
    tier: inferOllamaTier(parameterSize, capabilities),
    label: upstreamId,
    supportsTools,
    description: [
      "Yerel Ollama",
      parameterSize,
      quantization,
      supportsTools ? "araç desteği doğrulandı" : "araç desteği raporlanmadı",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function safeOllamaModelId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9._-]+)?$/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function resolveOllamaModelId(modelId: string): string | null {
  if (!modelId.startsWith(OLLAMA_MODEL_PREFIX)) return null;
  return safeOllamaModelId(modelId.slice(OLLAMA_MODEL_PREFIX.length));
}

function inferOllamaTier(
  parameterSize: string,
  capabilities: string[],
): ModelTier {
  if (capabilities.includes("thinking")) return "reasoning";
  const match = /([0-9]+(?:\.[0-9]+)?)\s*B/iu.exec(parameterSize);
  const billions = match ? Number(match[1]) : null;
  if (billions !== null && Number.isFinite(billions)) {
    if (billions <= 14) return "economy";
    if (billions >= 70) return "premium";
  }
  return "standard";
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
