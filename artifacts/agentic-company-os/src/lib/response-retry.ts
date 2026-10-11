import { customFetch } from "@workspace/api-client-react";

export type ResponseRetryIntent = { taskId: number; blockedAttemptId: string };
export type ResponseRetryReceipt = ResponseRetryIntent & {
  outcome: "accepted";
  recordedAt: string;
};
export type ResponseRetryScope = {
  taskId: number;
  canRetry: boolean;
  blockedAttemptId: string | null;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key = (taskId: number) => `acos.response-retry.v1.${taskId}`;

export function readResponseRetryIntent(
  taskId: number,
  storage: Pick<Storage, "getItem">,
): ResponseRetryIntent | null {
  const raw = storage.getItem(key(taskId));
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (
    value?.taskId !== taskId ||
    !Number.isSafeInteger(taskId) ||
    taskId <= 0 ||
    typeof value.blockedAttemptId !== "string" ||
    !uuid.test(value.blockedAttemptId)
  )
    throw new Error("Invalid saved response retry scope");
  return { taskId, blockedAttemptId: value.blockedAttemptId };
}
export function saveResponseRetryIntent(
  intent: ResponseRetryIntent,
  storage: Pick<Storage, "getItem" | "setItem">,
) {
  const previous = readResponseRetryIntent(intent.taskId, storage);
  if (previous && previous.blockedAttemptId !== intent.blockedAttemptId)
    throw new Error("An unresolved response retry already exists");
  storage.setItem(key(intent.taskId), JSON.stringify(intent));
  const saved = readResponseRetryIntent(intent.taskId, storage);
  if (saved?.blockedAttemptId !== intent.blockedAttemptId)
    throw new Error("Response retry identity was not saved");
}
export function clearResponseRetryIntent(
  intent: ResponseRetryIntent,
  storage: Pick<Storage, "getItem" | "removeItem">,
) {
  const current = readResponseRetryIntent(intent.taskId, storage);
  if (current?.blockedAttemptId !== intent.blockedAttemptId)
    throw new Error("Saved response retry changed");
  storage.removeItem(key(intent.taskId));
  if (readResponseRetryIntent(intent.taskId, storage))
    throw new Error("Saved response retry could not be cleared");
}
export function validateResponseRetryReceipt(
  value: unknown,
  intent: ResponseRetryIntent,
): ResponseRetryReceipt {
  if (
    !value ||
    typeof value !== "object" ||
    !("taskId" in value) ||
    !("blockedAttemptId" in value) ||
    !("outcome" in value) ||
    !("recordedAt" in value) ||
    value.taskId !== intent.taskId ||
    value.blockedAttemptId !== intent.blockedAttemptId ||
    value.outcome !== "accepted" ||
    typeof value.recordedAt !== "string" ||
    !Number.isFinite(Date.parse(value.recordedAt))
  )
    throw new Error("Invalid response retry receipt");
  return { ...intent, outcome: "accepted", recordedAt: value.recordedAt };
}
export async function getResponseRetryScope(
  taskId: number,
  signal?: AbortSignal,
): Promise<ResponseRetryScope> {
  const value = await customFetch<ResponseRetryScope>(
    `/api/tasks/${taskId}/response-retry`,
    { signal, cache: "no-store" },
  );
  if (
    value.taskId !== taskId ||
    typeof value.canRetry !== "boolean" ||
    (value.canRetry
      ? typeof value.blockedAttemptId !== "string" ||
        !uuid.test(value.blockedAttemptId)
      : value.blockedAttemptId !== null)
  )
    throw new Error("Invalid response retry snapshot");
  return value;
}
export async function sendResponseRetry(intent: ResponseRetryIntent) {
  return validateResponseRetryReceipt(
    await customFetch(`/api/tasks/${intent.taskId}/response-retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blockedAttemptId: intent.blockedAttemptId,
        acknowledge: true,
      }),
      signal: AbortSignal.timeout(30000),
    }),
    intent,
  );
}
export async function inspectResponseRetry(intent: ResponseRetryIntent) {
  return validateResponseRetryReceipt(
    await customFetch(
      `/api/tasks/${intent.taskId}/response-retry/${intent.blockedAttemptId}`,
      {
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      },
    ),
    intent,
  );
}
