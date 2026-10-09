import {
  customFetch,
  type LlmSettings,
  type UpdateLlmSettingsInput,
  type UpdateLlmSettingsResult,
} from "@workspace/api-client-react";
export function revision(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) < Number.MAX_SAFE_INTEGER
  );
}
export const connectionSettingsKey = ["guided-connection-settings"] as const;
export async function readConnectionSettings(
  signal?: AbortSignal,
): Promise<LlmSettings> {
  const result = await customFetch<LlmSettings>("/api/settings/llm", {
    method: "GET",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (
    !result ||
    !revision(result.revision) ||
    !result.ollama ||
    typeof result.ollama.configured !== "boolean" ||
    (result.ollama.baseUrl !== null &&
      typeof result.ollama.baseUrl !== "string") ||
    !result.openai ||
    !result.openrouter ||
    !Array.isArray(result.catalog?.models) ||
    !Array.isArray(result.catalog?.providers)
  )
    throw new Error("Connection state unavailable");
  return result;
}
export const saveConnection = (body: UpdateLlmSettingsInput) =>
  customFetch<UpdateLlmSettingsResult>("/api/settings/llm", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
export function connectionError(error: unknown): number | undefined {
  return error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
    ? error.status
    : undefined;
}
