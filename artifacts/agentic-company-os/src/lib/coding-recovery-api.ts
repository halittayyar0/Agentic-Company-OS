import {
  customFetch,
  type CodexSessionRecoveryStatus,
  type CodexSessionRecoveryReceipt,
  type CodexSessionRecoveryInput,
} from "@workspace/api-client-react";
type Options = Parameters<typeof customFetch>[1];
// Keep optional recovery requests in the conditional feature chunk. Reuse the
// shared authenticated transport and generated wire types; no private fetch.
const path = (taskId: number) => `/api/tasks/${taskId}/coding-session`;
export const getCodexSessionRecovery = (taskId: number, options?: Options) =>
  customFetch<CodexSessionRecoveryStatus>(path(taskId), {
    ...options,
    method: "GET",
  });
export const getCodexSessionRecoveryReceipt = (
  taskId: number,
  requestId: string,
  options?: Options,
) =>
  customFetch<CodexSessionRecoveryReceipt>(
    `${path(taskId)}/recover/${encodeURIComponent(requestId)}`,
    { ...options, method: "GET" },
  );
export const recoverCodexSession = (
  taskId: number,
  input: CodexSessionRecoveryInput,
  options?: Options,
) =>
  customFetch<CodexSessionRecoveryReceipt>(`${path(taskId)}/recover`, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(input),
  });
