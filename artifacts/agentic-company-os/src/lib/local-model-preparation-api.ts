import {
  customFetch,
  type LocalModelPreparationReceipt,
  type LocalModelPreparationSnapshot,
  type StartLocalModelPreparationInput,
} from "@workspace/api-client-react";
const root = "/api/settings/ollama/preparations";
const states = [
  "requested",
  "downloading",
  "verifying",
  "stopping",
  "ready",
  "interrupted",
  "failed",
];
export const preparationActive = (
  receipt: LocalModelPreparationReceipt | null | undefined,
) =>
  Boolean(
    receipt &&
    ["requested", "downloading", "verifying", "stopping"].includes(
      receipt.state,
    ),
  );
function receipt(
  value: LocalModelPreparationReceipt,
  expectedId?: string,
): LocalModelPreparationReceipt {
  if (
    !value ||
    !states.includes(value.state) ||
    value.modelId !== "qwen35-2b" ||
    typeof value.requestId !== "string" ||
    !/^[a-f\d-]{36}$/i.test(value.requestId) ||
    (expectedId &&
      value.requestId.toLowerCase() !== expectedId.toLowerCase()) ||
    !Number.isSafeInteger(value.providerRevision) ||
    value.providerRevision < 0 ||
    !["preparing", "downloading", "checking", "downloaded"].includes(
      value.phase,
    ) ||
    !Number.isSafeInteger(value.observedCompletedBytes) ||
    !Number.isSafeInteger(value.observedTotalBytes) ||
    value.observedCompletedBytes < 0 ||
    value.observedCompletedBytes > value.observedTotalBytes ||
    value.observedTotalBytes > 3221225472 ||
    typeof value.progressReset !== "boolean"
  )
    throw new Error("Preparation receipt unavailable");
  return value;
}
const readOptions = (signal?: AbortSignal): RequestInit => ({
  method: "GET",
  cache: "no-store",
  signal: signal
    ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    : AbortSignal.timeout(30_000),
});
export async function readModelPreparation(
  signal?: AbortSignal,
): Promise<LocalModelPreparationSnapshot> {
  const value = await customFetch<LocalModelPreparationSnapshot>(
    root,
    readOptions(signal),
  );
  if (
    !value ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    value.recipe?.id !== "qwen35-2b" ||
    value.recipe.model !== "qwen3.5:2b-q4_K_M" ||
    !value.availability ||
    ![
      "compatible",
      "update_required",
      "unreachable",
      "unverified",
      "unconfigured",
    ].includes(value.availability.server) ||
    typeof value.availability.available !== "boolean"
  )
    throw new Error("Preparation state unavailable");
  if (value.preparation) receipt(value.preparation);
  return value;
}
export async function readModelPreparationReceipt(
  id: string,
  signal?: AbortSignal,
): Promise<LocalModelPreparationReceipt> {
  return receipt(
    await customFetch<LocalModelPreparationReceipt>(
      `${root}/${encodeURIComponent(id)}`,
      readOptions(signal),
    ),
    id,
  );
}
export async function startModelPreparation(
  input: StartLocalModelPreparationInput,
): Promise<LocalModelPreparationReceipt> {
  // The active global receipt can have a different ID when another client won.
  return receipt(
    await customFetch<LocalModelPreparationReceipt>(root, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    }),
  );
}
export async function stopModelPreparation(
  id: string,
): Promise<LocalModelPreparationReceipt> {
  return receipt(
    await customFetch<LocalModelPreparationReceipt>(
      `${root}/${encodeURIComponent(id)}/stop`,
      { method: "POST", signal: AbortSignal.timeout(30_000) },
    ),
    id,
  );
}
