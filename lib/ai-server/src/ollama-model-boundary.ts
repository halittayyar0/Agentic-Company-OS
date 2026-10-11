export type OllamaExecutionLocation = "local" | "cloud" | "unknown";
export type OllamaBoundaryErrorCode =
  | "setup_required"
  | "unsupported_version"
  | "model_update_required"
  | "model_runtime_unverified"
  | "unknown_locality"
  | "cloud_consent_required"
  | "server_changed"
  | "invalid_model_reference"
  | "invalid_request_boundary";

const messages: Record<OllamaBoundaryErrorCode, string> = {
  setup_required: "Configure a private Ollama server before using this model.",
  unsupported_version:
    "Local execution requires a verified stable Ollama 0.18.0 or later server.",
  model_update_required:
    "This local model requires a newer Ollama server. Update the server and check the connection again.",
  model_runtime_unverified:
    "This local model's required Ollama version could not be verified. Check the connection before using it.",
  unknown_locality: "This model's execution location could not be verified.",
  cloud_consent_required:
    "Allow cloud models explicitly for this Ollama server before using this model.",
  server_changed:
    "The Ollama server or its permission changed before dispatch. Review the current connection.",
  invalid_model_reference:
    "The model reference conflicts with the selected execution location.",
  invalid_request_boundary:
    "The Ollama request does not match its admitted destination and execution location.",
};

export class OllamaBoundaryError extends Error {
  constructor(public readonly code: OllamaBoundaryErrorCode) {
    super(messages[code]);
    this.name = "OllamaBoundaryError";
  }
}

function stableOllamaVersion(value: unknown): number[] | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return parts;
}

export function supportedOllamaVersion(value: unknown): string | null {
  const parts = stableOllamaVersion(value);
  return parts && (parts[0]! > 0 || parts[1]! >= 18) ? (value as string) : null;
}

/** Model requirements describe the local runner, not an explicitly allowed
 * remote runner. Missing/empty requirements are the legacy Ollama contract;
 * any declared malformed requirement is unverified, never silently ignored. */
export function ollamaRuntimeCompatibility(
  serverVersion: unknown,
  requiredVersion: unknown,
): {
  runtimeCompatibility: "compatible" | "update_required" | "unverified";
  requiredOllamaVersion?: string;
} {
  const server = stableOllamaVersion(supportedOllamaVersion(serverVersion));
  if (!server) return { runtimeCompatibility: "unverified" };
  if (requiredVersion === undefined || requiredVersion === "")
    return { runtimeCompatibility: "compatible" };
  const required = stableOllamaVersion(requiredVersion);
  if (!required) return { runtimeCompatibility: "unverified" };
  let compatible = true;
  for (let index = 0; index < 3; index++) {
    if (server[index] === required[index]) continue;
    compatible = server[index]! > required[index]!;
    break;
  }
  return {
    runtimeCompatibility: compatible ? "compatible" : "update_required",
    requiredOllamaVersion: requiredVersion as string,
  };
}

export interface OllamaModelReference {
  original: string;
  canonical: string;
  explicitSource: "local" | "cloud" | null;
}

export function parseOllamaModelReference(
  value: unknown,
): OllamaModelReference | null {
  if (typeof value !== "string" || value.length > 200 || value.trim() !== value)
    return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9._-]+){0,2}$/u.test(value))
    return null;
  const parts = value.split(":");
  if (
    parts[0]!
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  )
    return null;
  let source: "local" | "cloud" | null = null;
  const tail = parts.at(-1);
  if (parts.length > 1 && (tail === "local" || tail === "cloud")) {
    source = tail;
    parts.pop();
  } else if (parts.length > 1 && tail?.endsWith("-cloud")) {
    source = "cloud";
    parts[parts.length - 1] = tail.slice(0, -6);
  }
  if (
    parts.length > 2 ||
    parts.some((part) => !part) ||
    (parts.length > 1 &&
      (parts.at(-1) === "local" ||
        parts.at(-1) === "cloud" ||
        parts.at(-1)?.endsWith("-cloud")))
  )
    return null;
  return {
    original: value,
    canonical: parts.length === 1 ? `${parts[0]}:latest` : parts.join(":"),
    explicitSource: source,
  };
}

export function localOllamaReference(value: string): string {
  const reference = parseOllamaModelReference(value);
  if (!reference || reference.explicitSource === "cloud")
    throw new OllamaBoundaryError("invalid_model_reference");
  return `${reference.canonical}:local`;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function ollamaRemoteMetadata(
  value: unknown,
): "none" | "cloud" | "invalid" {
  const data = record(value);
  if (!data) return "invalid";
  const host = data.remote_host,
    model = data.remote_model;
  const missing = (item: unknown) => item === undefined || item === "";
  if (missing(host) && missing(model)) return "none";
  if (
    typeof host !== "string" ||
    typeof model !== "string" ||
    !host ||
    !parseOllamaModelReference(model) ||
    host.length > 2048
  )
    return "invalid";
  try {
    const url = new URL(host);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return "invalid";
  } catch {
    return "invalid";
  }
  return "cloud";
}

export function classifyOllamaModel(
  upstream: string,
  tags: unknown,
  show: unknown,
  localEnforcementSupported: boolean,
): OllamaExecutionLocation {
  const reference = parseOllamaModelReference(upstream);
  if (!reference) return "unknown";
  const tagged = ollamaRemoteMetadata(tags);
  if (tagged === "invalid") return "unknown";
  const shown = show == null ? "none" : ollamaRemoteMetadata(show);
  if (shown === "invalid") return "unknown";
  if (
    tagged === "cloud" ||
    shown === "cloud" ||
    reference.explicitSource === "cloud"
  )
    return "cloud";
  const details = record(show);
  const capabilities = details?.capabilities;
  return localEnforcementSupported &&
    Array.isArray(capabilities) &&
    capabilities.length <= 100 &&
    capabilities.every(
      (value) => typeof value === "string" && value.length <= 64,
    )
    ? "local"
    : "unknown";
}

export function findOllamaBoundaryError(
  error: unknown,
): OllamaBoundaryError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth++) {
    if (current instanceof OllamaBoundaryError) return current;
    if (!record(current)) return null;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
