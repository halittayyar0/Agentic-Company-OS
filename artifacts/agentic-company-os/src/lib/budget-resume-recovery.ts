import type { TaskBudgetResumeReceipt } from "@workspace/api-client-react";

export type BudgetResumeIntent = {
  version: 1;
  taskId: number;
  rootTaskId: number;
  requestId: string;
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const budgetResumeKey = (taskId: number) =>
  `acos.task-budget-resume.v1:${taskId}`;
const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const sameIntent = (a: BudgetResumeIntent, b: BudgetResumeIntent) =>
  a.version === b.version &&
  a.taskId === b.taskId &&
  a.rootTaskId === b.rootTaskId &&
  a.requestId === b.requestId;
export function readBudgetResumeIntent(
  taskId: number,
  store: Store,
): { intent: BudgetResumeIntent | null; error: boolean } {
  try {
    const raw = store.getItem(budgetResumeKey(taskId));
    if (!raw) return { intent: null, error: false };
    if (raw.length > 512) throw Error("Invalid intent");
    const v = JSON.parse(raw) as Partial<BudgetResumeIntent>;
    if (
      v?.version !== 1 ||
      v.taskId !== taskId ||
      !positive(v.taskId) ||
      !positive(v.rootTaskId) ||
      !uuid(v.requestId)
    )
      throw Error("Invalid intent");
    return {
      intent: {
        version: 1,
        taskId: v.taskId,
        rootTaskId: v.rootTaskId,
        requestId: v.requestId,
      },
      error: false,
    };
  } catch {
    return { intent: null, error: true };
  }
}
export function saveBudgetResumeIntent(
  intent: BudgetResumeIntent,
  store: Store,
): boolean {
  try {
    if (
      intent.version !== 1 ||
      !positive(intent.taskId) ||
      !positive(intent.rootTaskId) ||
      !uuid(intent.requestId)
    )
      return false;
    const before = readBudgetResumeIntent(intent.taskId, store);
    if (before.error || (before.intent && !sameIntent(before.intent, intent)))
      return false;
    store.setItem(budgetResumeKey(intent.taskId), JSON.stringify(intent));
    const after = readBudgetResumeIntent(intent.taskId, store);
    return !after.error && !!after.intent && sameIntent(after.intent, intent);
  } catch {
    return false;
  }
}
export function clearBudgetResumeIntent(
  intent: BudgetResumeIntent,
  store: Store,
): boolean {
  try {
    const before = readBudgetResumeIntent(intent.taskId, store);
    if (before.error || (before.intent && !sameIntent(before.intent, intent)))
      return false;
    store.removeItem(budgetResumeKey(intent.taskId));
    return store.getItem(budgetResumeKey(intent.taskId)) === null;
  } catch {
    return false;
  }
}
export function validateBudgetResumeReceipt(
  value: unknown,
  intent: BudgetResumeIntent,
): TaskBudgetResumeReceipt {
  if (!value || typeof value !== "object") throw Error("Invalid receipt");
  const r = value as TaskBudgetResumeReceipt;
  const reasons = [
    "emergency_stop",
    "task_changed",
    "family_invalid",
    "family_too_large",
    "allowance_exhausted",
    "nothing_eligible",
  ];
  if (
    r.requestId !== intent.requestId ||
    r.taskId !== intent.taskId ||
    r.rootTaskId !== intent.rootTaskId ||
    typeof r.recordedAt !== "string" ||
    r.recordedAt.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      r.recordedAt,
    ) ||
    !Number.isFinite(Date.parse(r.recordedAt)) ||
    !Array.isArray(r.queuedTaskIds) ||
    !r.queuedTaskIds.every(positive) ||
    new Set(r.queuedTaskIds).size !== r.queuedTaskIds.length ||
    !Number.isInteger(r.queuedCount) ||
    !Number.isInteger(r.stillPausedCount) ||
    r.queuedCount !== r.queuedTaskIds.length ||
    r.queuedCount < 0 ||
    r.stillPausedCount < 0 ||
    r.queuedCount + r.stillPausedCount > 1000 ||
    (r.outcome === "accepted"
      ? r.reason !== null || r.queuedCount === 0
      : r.outcome !== "rejected" ||
        r.reason === null ||
        !reasons.includes(r.reason) ||
        r.queuedCount !== 0)
  )
    throw Error("Receipt mismatch");
  return r;
}
