import {
  classifyOllamaModel,
  localOllamaReference,
  ollamaRuntimeCompatibility,
  parseOllamaModelReference,
  validateOllamaBaseUrl,
} from "@workspace/ai-server";
import { starterModelRecipe } from "./ollama-preparation-catalog";

export interface OllamaPreparationAvailability {
  server: "compatible" | "update_required" | "unreachable" | "unverified";
  available: boolean;
  modelId: string | null;
  digest: string | null;
}

export class OllamaPreparationTransportError extends Error {
  constructor(
    readonly code:
      "SERVER_UNAVAILABLE" | "DISPATCH_FAILED" | "MODEL_UNVERIFIED",
  ) {
    super(code);
    this.name = "OllamaPreparationTransportError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body)
    throw new OllamaPreparationTransportError("SERVER_UNAVAILABLE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  let done = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        done = true;
        break;
      }
      bytes += next.value.byteLength;
      if (bytes > 1024 * 1024)
        throw new OllamaPreparationTransportError("SERVER_UNAVAILABLE");
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    try {
      if (!done) await reader.cancel().catch(() => undefined);
    } finally {
      reader.releaseLock();
    }
  }
}

export function createOllamaPreparationTransport(
  fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
) {
  async function inspect(
    address: string,
    signal: AbortSignal,
  ): Promise<OllamaPreparationAvailability> {
    const endpoint = validateOllamaBaseUrl(address);
    const empty = { available: false, modelId: null, digest: null } as const;
    const metadata = async (path: string, body?: unknown): Promise<unknown> =>
      boundedJson(
        await fetcher(new URL(path, endpoint.origin), {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Accept: "application/json",
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
        }),
      );
    try {
      const version = record(await metadata("/api/version"))?.version;
      const compatibility = ollamaRuntimeCompatibility(
        version,
        starterModelRecipe.minimumRuntimeVersion,
      ).runtimeCompatibility;
      if (compatibility !== "compatible")
        return {
          server:
            compatibility === "update_required"
              ? "update_required"
              : "unverified",
          ...empty,
        };
      const tags = record(await metadata("/api/tags"));
      if (!Array.isArray(tags?.models) || tags.models.length > 1_000)
        return { server: "unverified", ...empty };
      const matching = tags.models.filter((item) => {
        const row = record(item);
        if (!row) return false;
        const reference = parseOllamaModelReference(row.model ?? row.name);
        return reference?.canonical === starterModelRecipe.model;
      });
      if (matching.length === 0) return { server: "compatible", ...empty };
      if (matching.length !== 1) return { server: "unverified", ...empty };
      const row = record(matching[0])!;
      for (const field of ["model", "name"]) {
        if (row[field] === undefined) continue;
        const reference = parseOllamaModelReference(row[field]);
        if (
          !reference ||
          reference.explicitSource === "cloud" ||
          reference.canonical !== starterModelRecipe.model
        )
          return { server: "unverified", ...empty };
      }
      const show = record(
        await metadata("/api/show", {
          model: localOllamaReference(starterModelRecipe.model),
          verbose: false,
        }),
      );
      const digest =
        typeof row.digest === "string"
          ? row.digest.replace(/^sha256:/, "")
          : "";
      if (
        !/^[a-f0-9]{64}$/.test(digest) ||
        classifyOllamaModel(starterModelRecipe.model, row, show, true) !==
          "local" ||
        !Array.isArray(show?.capabilities) ||
        !show.capabilities.includes("tools") ||
        ollamaRuntimeCompatibility(version, show.requires)
          .runtimeCompatibility !== "compatible"
      )
        return { server: "compatible", ...empty };
      return {
        server: "compatible",
        available: true,
        modelId: `ollama:${starterModelRecipe.model}`,
        digest: `sha256:${digest}`,
      };
    } catch {
      return { server: "unreachable", ...empty };
    }
  }

  async function pull(
    address: string,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const endpoint = validateOllamaBaseUrl(address);
    try {
      const response = await fetcher(new URL("/api/pull", endpoint.origin), {
        method: "POST",
        headers: {
          Accept: "application/x-ndjson, application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: starterModelRecipe.model,
          stream: true,
          insecure: false,
        }),
        redirect: "error",
        signal,
      });
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (
        !response.ok ||
        !response.body ||
        !["application/x-ndjson", "application/json"].includes(
          contentType ?? "",
        )
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new OllamaPreparationTransportError("DISPATCH_FAILED");
      }
      return response.body;
    } catch {
      throw new OllamaPreparationTransportError("DISPATCH_FAILED");
    }
  }
  return { inspect, pull };
}

export type OllamaPreparationTransport = ReturnType<
  typeof createOllamaPreparationTransport
>;
