import { isIP } from "node:net";
import OpenAI from "openai";
import pLimit from "p-limit";
import type { ModelCatalogEntry, ModelTier } from "./model-router";
import {
  classifyOllamaModel,
  localOllamaReference,
  ollamaRemoteMetadata,
  OllamaBoundaryError,
  parseOllamaModelReference,
  supportedOllamaVersion,
  type OllamaExecutionLocation,
} from "./ollama-model-boundary";

export type FirstPartyModelProvider = "openai" | "ollama";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_MODEL_PREFIX = "openai:";
export const OLLAMA_MODEL_PREFIX = "ollama:";
export const OLLAMA_CLOUD_MODEL_PREFIX = "ollama-cloud:";

const providerState = {
  openaiApiKey: null as string | null,
  ollamaBaseUrl: null as string | null,
  ollamaCloudOrigin: null as string | null,
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
  cloudOrigin?: string | null;
}): void {
  const next = params.baseUrl?.trim() || null;
  const cloudOrigin = params.cloudOrigin
    ? validateOllamaBaseUrl(params.cloudOrigin).origin
    : null;
  if (
    providerState.ollamaBaseUrl !== next ||
    providerState.ollamaCloudOrigin !== cloudOrigin
  ) {
    invalidateOllamaConfiguration();
  }
  providerState.ollamaBaseUrl = next;
  providerState.ollamaCloudOrigin = cloudOrigin;
  ollamaClient = null;
  ollamaClientBaseUrl = null;
}

export function resolveOllamaEndpoint(): ValidatedOllamaEndpoint | null {
  const raw =
    providerState.ollamaBaseUrl ?? process.env.OLLAMA_BASE_URL?.trim();
  const endpoint = raw ? validateOllamaBaseUrl(raw) : null;
  if ((endpoint?.origin ?? null) !== ollamaEffectiveOrigin) {
    invalidateOllamaConfiguration();
    ollamaEffectiveOrigin = endpoint?.origin ?? null;
  }
  return endpoint;
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
    throw new OllamaBoundaryError("setup_required");
  }
  if (!ollamaCatalog.localEnforcementSupported)
    throw new OllamaBoundaryError("unsupported_version");
  if (!ollamaClient || ollamaClientBaseUrl !== endpoint.openAIBaseUrl) {
    ollamaClient = guardedOllamaClient({
      origin: endpoint.origin,
      generation: ollamaCatalogGeneration,
      boundary: "local",
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
  remote_host?: unknown;
  remote_model?: unknown;
}

interface OllamaShowPayload {
  capabilities?: unknown;
  details?: unknown;
  remote_host?: unknown;
  remote_model?: unknown;
}

export interface OllamaCatalogSnapshot {
  models: Array<ModelCatalogEntry & { provider: "ollama" }>;
  fetchedAt: number | null;
  reachable: boolean;
  error: "unreachable" | "invalid_private_endpoint" | null;
  serverVersion: string | null;
  localEnforcementSupported: boolean;
  cloudEnabled: boolean;
}

const ollamaCatalog = {
  models: [] as Array<ModelCatalogEntry & { provider: "ollama" }>,
  fetchedAt: 0,
  lastAttemptAt: 0,
  reachable: false,
  error: null as OllamaCatalogSnapshot["error"],
  serverVersion: null as string | null,
  localEnforcementSupported: false,
};

const OLLAMA_CATALOG_TTL_MS = 5 * 60_000;
const OLLAMA_CATALOG_RETRY_MS = 30_000;
const OLLAMA_MAX_MODELS = 100;
let ollamaRefreshPromise: Promise<OllamaCatalogSnapshot> | null = null;
let ollamaCatalogGeneration = 0;
let ollamaEffectiveOrigin: string | null = null;

function invalidateOllamaConfiguration(): void {
  ollamaCatalogGeneration++;
  ollamaCatalog.models = [];
  ollamaCatalog.fetchedAt = 0;
  ollamaCatalog.lastAttemptAt = 0;
  ollamaCatalog.reachable = false;
  ollamaCatalog.error = null;
  ollamaCatalog.serverVersion = null;
  ollamaCatalog.localEnforcementSupported = false;
  ollamaRefreshPromise = null;
  ollamaClient = null;
  ollamaClientBaseUrl = null;
}

export function getOllamaCatalogSnapshot(): OllamaCatalogSnapshot {
  const configurationError = getOllamaConfigurationError();
  const endpoint = configurationError ? null : resolveOllamaEndpoint();
  return {
    models: [...ollamaCatalog.models],
    fetchedAt: ollamaCatalog.fetchedAt || null,
    reachable: ollamaCatalog.reachable,
    error: configurationError ?? ollamaCatalog.error,
    serverVersion: ollamaCatalog.serverVersion,
    localEnforcementSupported: ollamaCatalog.localEnforcementSupported,
    cloudEnabled:
      endpoint !== null && providerState.ollamaCloudOrigin === endpoint.origin,
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
    let serverVersion: string | null = null;
    try {
      const response = await fetch(new URL("/api/version", endpoint.origin), {
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        const version = (await response.json()) as { version?: unknown };
        if (
          typeof version.version === "string" &&
          /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u.test(
            version.version,
          ) &&
          version.version.length <= 64
        )
          serverVersion = version.version;
      }
    } catch {
      /* Reachable tags do not prove an unreadable version's local enforcement. */
    }
    const localEnforcementSupported =
      supportedOllamaVersion(serverVersion) !== null;
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
      rows.map((row) =>
        limit(() =>
          normalizeOllamaModel(endpoint, row, localEnforcementSupported),
        ),
      ),
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
    ollamaCatalog.serverVersion = serverVersion;
    ollamaCatalog.localEnforcementSupported = localEnforcementSupported;
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
  localEnforcementSupported: boolean,
): Promise<(ModelCatalogEntry & { provider: "ollama" }) | null> {
  const upstreamId =
    safeOllamaModelId(row.model) ?? safeOllamaModelId(row.name);
  if (!upstreamId) return null;
  const rowName = safeOllamaModelId(row.name),
    rowModel = safeOllamaModelId(row.model);
  const nameReference = rowName ? parseOllamaModelReference(rowName) : null;
  const modelReference = rowModel ? parseOllamaModelReference(rowModel) : null;
  const conflictingIds =
    (row.name !== undefined && !rowName) ||
    (row.model !== undefined && !rowModel) ||
    Boolean(
      nameReference &&
      modelReference &&
      (nameReference.canonical !== modelReference.canonical ||
        (nameReference.explicitSource === "cloud") !==
          (modelReference.explicitSource === "cloud")),
    );

  let show: OllamaShowPayload | null = null;
  const taggedLocation = classifyOllamaModel(
    upstreamId,
    row,
    null,
    localEnforcementSupported,
  );
  const canInspect =
    !conflictingIds &&
    ollamaRemoteMetadata(row) !== "invalid" &&
    ((taggedLocation === "cloud" &&
      providerState.ollamaCloudOrigin === endpoint.origin) ||
      (taggedLocation !== "cloud" && localEnforcementSupported));
  if (canInspect) {
    try {
      const showResponse = await fetch(new URL("/api/show", endpoint.origin), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model:
            taggedLocation === "cloud"
              ? upstreamId
              : localOllamaReference(upstreamId),
          verbose: false,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (showResponse.ok)
        show = (await showResponse.json()) as OllamaShowPayload;
    } catch {
      // Discovery remains useful, but unknown capability is fail-closed below.
    }
  }
  let executionLocation = classifyOllamaModel(
    upstreamId,
    row,
    show,
    localEnforcementSupported,
  );
  if (conflictingIds) executionLocation = "unknown";

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
    id: `${executionLocation === "cloud" ? OLLAMA_CLOUD_MODEL_PREFIX : OLLAMA_MODEL_PREFIX}${upstreamId}`,
    provider: "ollama",
    tier: inferOllamaTier(parameterSize, capabilities),
    label: upstreamId,
    supportsTools,
    executionLocation,
    description: [
      executionLocation === "local"
        ? "Yerel Ollama"
        : executionLocation === "cloud"
          ? "Ollama bulut"
          : "Ollama · çalışma yeri doğrulanmadı",
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
  return parseOllamaModelReference(normalized) ? normalized : null;
}

export function resolveOllamaModelId(modelId: string): string | null {
  if (!modelId.startsWith(OLLAMA_MODEL_PREFIX)) return null;
  return safeOllamaModelId(modelId.slice(OLLAMA_MODEL_PREFIX.length));
}

export function resolveOllamaCloudModelId(modelId: string): string | null {
  return modelId.startsWith(OLLAMA_CLOUD_MODEL_PREFIX)
    ? safeOllamaModelId(modelId.slice(OLLAMA_CLOUD_MODEL_PREFIX.length))
    : null;
}

export interface OllamaInferenceRequest {
  readonly origin: string;
  readonly generation: number;
  readonly boundary: Exclude<OllamaExecutionLocation, "unknown">;
  readonly upstreamModel: string;
  readonly client: OpenAI;
}

type OllamaRequestAuthority = Pick<
  OllamaInferenceRequest,
  "origin" | "generation" | "boundary"
>;

export function assertOllamaRequestCurrent(
  request: OllamaRequestAuthority,
): void {
  let endpoint: ValidatedOllamaEndpoint | null;
  try {
    endpoint = resolveOllamaEndpoint();
  } catch {
    throw new OllamaBoundaryError("server_changed");
  }
  if (
    !endpoint ||
    endpoint.origin !== request.origin ||
    request.generation !== ollamaCatalogGeneration
  )
    throw new OllamaBoundaryError("server_changed");
  if (
    request.boundary === "cloud" &&
    providerState.ollamaCloudOrigin !== request.origin
  )
    throw new OllamaBoundaryError("cloud_consent_required");
}

function guardedOllamaClient(
  authority: OllamaRequestAuthority,
  upstreamModel?: string,
  beforeFetch?: () => Promise<void>,
): OpenAI {
  const captured = Object.freeze({ ...authority });
  return new OpenAI({
    apiKey: "ollama-local",
    baseURL: new URL("/v1", captured.origin).toString(),
    fetch: async (input, init) => {
      // Apply durable API changes during admission and before every SDK retry.
      await beforeFetch?.();
      assertOllamaRequestCurrent(captured);
      const url = new URL(String(input));
      if (
        url.origin !== captured.origin ||
        url.pathname !== "/v1/chat/completions" ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        typeof init?.body !== "string"
      )
        throw new OllamaBoundaryError("invalid_request_boundary");
      let body: { model?: unknown };
      try {
        body = JSON.parse(init.body) as { model?: unknown };
      } catch {
        throw new OllamaBoundaryError("invalid_request_boundary");
      }
      if (
        typeof body.model !== "string" ||
        (upstreamModel && body.model !== upstreamModel)
      )
        throw new OllamaBoundaryError("invalid_request_boundary");
      if (
        captured.boundary === "local" &&
        localOllamaReference(body.model) !== body.model
      )
        throw new OllamaBoundaryError("invalid_request_boundary");
      return globalThis.fetch(input, { ...init, redirect: "error" });
    },
  });
}

export async function prepareOllamaInferenceRequest(
  modelId: string,
  signal?: AbortSignal,
  beforeFetch?: () => Promise<void>,
): Promise<OllamaInferenceRequest> {
  signal?.throwIfAborted();
  const cloudModel = resolveOllamaCloudModelId(modelId);
  const localModel = resolveOllamaModelId(modelId);
  const upstream = cloudModel ?? localModel;
  if (!upstream) throw new OllamaBoundaryError("invalid_model_reference");
  const reference = parseOllamaModelReference(upstream);
  if (
    !reference ||
    (!cloudModel && reference.explicitSource === "cloud") ||
    (cloudModel && reference.explicitSource === "local")
  )
    throw new OllamaBoundaryError("invalid_model_reference");
  let endpoint: ValidatedOllamaEndpoint | null;
  try {
    endpoint = resolveOllamaEndpoint();
  } catch {
    throw new OllamaBoundaryError("setup_required");
  }
  if (!endpoint) throw new OllamaBoundaryError("setup_required");
  const authority = Object.freeze({
    origin: endpoint.origin,
    generation: ollamaCatalogGeneration,
    boundary: cloudModel ? ("cloud" as const) : ("local" as const),
  });
  assertOllamaRequestCurrent(authority);
  const catalog = await refreshOllamaCatalog();
  signal?.throwIfAborted();
  assertOllamaRequestCurrent(authority);
  if (!catalog.reachable) throw new OllamaBoundaryError("setup_required");
  if (!cloudModel && !catalog.localEnforcementSupported)
    throw new OllamaBoundaryError("unsupported_version");
  const found = catalog.models.find((row) => {
    const selected = cloudModel
      ? resolveOllamaCloudModelId(row.id)
      : resolveOllamaModelId(row.id);
    return (
      selected &&
      parseOllamaModelReference(selected)?.canonical === reference.canonical
    );
  });
  if (!found || found.executionLocation !== authority.boundary)
    throw new OllamaBoundaryError("unknown_locality");
  const upstreamModel = cloudModel ? upstream : localOllamaReference(upstream);
  return Object.freeze({
    ...authority,
    upstreamModel,
    client: guardedOllamaClient(authority, upstreamModel, beforeFetch),
  });
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
