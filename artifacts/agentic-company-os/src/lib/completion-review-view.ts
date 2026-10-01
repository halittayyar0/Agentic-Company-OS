// This projection accepts only the bounded, typed review snapshot. It never
// copies arbitrary activity detail or raw tool results into display/export data.
export const REVIEW_RECEIPT_STATES = [
  "reserved",
  "running",
  "succeeded",
  "failed",
  "unknown",
] as const;
export const REVIEW_TASK_STATES = [
  "pending",
  "planning",
  "in_progress",
  "awaiting_approval",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ReviewReceiptState = (typeof REVIEW_RECEIPT_STATES)[number];
export type ReviewTaskState = (typeof REVIEW_TASK_STATES)[number];
type Reconciliation = "confirmed_applied" | "confirmed_not_applied" | null;
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function reconciliation(value: unknown): value is Reconciliation {
  return (
    value === null ||
    value === "confirmed_applied" ||
    value === "confirmed_not_applied"
  );
}
function member<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && values.includes(value as T);
}
export interface ReviewReceipt {
  id: string;
  tool: string;
  state: ReviewReceiptState;
  executionKind: "task_step" | "approved_action";
  reconciliationDecision: Reconciliation;
  ok?: boolean;
  exitCode?: number;
}
export interface CompletionReviewView {
  taskId: number;
  cycleNumber: number;
  receiptTotal: number;
  receiptCounts: {
    state: ReviewReceiptState;
    reconciliationDecision: Reconciliation;
    count: number;
  }[];
  receiptsTruncated: boolean;
  receipts: ReviewReceipt[];
  childTotal: number;
  childCounts: { status: ReviewTaskState; count: number }[];
  childrenTruncated: boolean;
  children: { id: number; status: ReviewTaskState }[];
}
export function completionReviewView(
  value: unknown,
  taskId: number | null,
): CompletionReviewView | null {
  const source = record(value);
  if (
    !source ||
    source.source !== "persisted_runtime_metadata" ||
    taskId === null ||
    source.taskId !== taskId ||
    !count(source.cycleNumber) ||
    !count(source.receiptTotal) ||
    !count(source.childTotal) ||
    typeof source.receiptsTruncated !== "boolean" ||
    typeof source.childrenTruncated !== "boolean" ||
    !Array.isArray(source.receiptCounts) ||
    source.receiptCounts.length > 15 ||
    !Array.isArray(source.childCounts) ||
    source.childCounts.length > 8 ||
    !Array.isArray(source.receipts) ||
    !Array.isArray(source.children)
  )
    return null;
  const receiptCounts: CompletionReviewView["receiptCounts"] = [];
  const groups = new Set<string>();
  for (const value of source.receiptCounts) {
    const row = record(value);
    if (
      !row ||
      !member(REVIEW_RECEIPT_STATES, row.state) ||
      !reconciliation(row.reconciliationDecision) ||
      !count(row.count)
    )
      return null;
    const key = `${row.state}:${row.reconciliationDecision}`;
    if (groups.has(key)) return null;
    groups.add(key);
    receiptCounts.push({
      state: row.state,
      reconciliationDecision: row.reconciliationDecision,
      count: row.count,
    });
  }
  const childCounts: CompletionReviewView["childCounts"] = [];
  const statuses = new Set<string>();
  for (const value of source.childCounts) {
    const row = record(value);
    if (
      !row ||
      !member(REVIEW_TASK_STATES, row.status) ||
      !count(row.count) ||
      statuses.has(row.status)
    )
      return null;
    statuses.add(row.status);
    childCounts.push({ status: row.status, count: row.count });
  }
  if (
    receiptCounts.reduce((sum, row) => sum + row.count, 0) !==
      source.receiptTotal ||
    childCounts.reduce((sum, row) => sum + row.count, 0) !== source.childTotal
  )
    return null;
  const receipts: ReviewReceipt[] = [];
  const receiptIds = new Set<string>();
  for (const value of source.receipts.slice(0, 12)) {
    const row = record(value);
    if (
      !row ||
      typeof row.id !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,119}$/iu.test(row.id) ||
      receiptIds.has(row.id) ||
      typeof row.tool !== "string" ||
      !/^[a-z][a-z0-9_]{0,79}$/iu.test(row.tool) ||
      !member(REVIEW_RECEIPT_STATES, row.state) ||
      !reconciliation(row.reconciliationDecision) ||
      !member(["task_step", "approved_action"] as const, row.executionKind)
    )
      continue;
    receiptIds.add(row.id);
    receipts.push({
      id: row.id,
      tool: row.tool,
      state: row.state,
      executionKind: row.executionKind,
      reconciliationDecision: row.reconciliationDecision,
      ...(typeof row.ok === "boolean" ? { ok: row.ok } : {}),
      ...(typeof row.exitCode === "number" && Number.isSafeInteger(row.exitCode)
        ? { exitCode: row.exitCode }
        : {}),
    });
  }
  const children: CompletionReviewView["children"] = [];
  const childIds = new Set<number>();
  for (const value of source.children.slice(0, 8)) {
    const row = record(value);
    if (
      !row ||
      !count(row.id) ||
      row.id === 0 ||
      childIds.has(row.id) ||
      !member(REVIEW_TASK_STATES, row.status)
    )
      continue;
    childIds.add(row.id);
    children.push({ id: row.id, status: row.status });
  }
  if (
    receipts.length > source.receiptTotal ||
    children.length > source.childTotal
  )
    return null;
  const remainingReceipts = new Map(
    receiptCounts.map((row) => [
      `${row.state}:${row.reconciliationDecision}`,
      row.count,
    ]),
  );
  for (const receipt of receipts) {
    const key = `${receipt.state}:${receipt.reconciliationDecision}`;
    const remaining = remainingReceipts.get(key) ?? 0;
    if (remaining === 0) return null;
    remainingReceipts.set(key, remaining - 1);
  }
  const remainingChildren = new Map(
    childCounts.map((row) => [row.status, row.count]),
  );
  for (const child of children) {
    const remaining = remainingChildren.get(child.status) ?? 0;
    if (remaining === 0) return null;
    remainingChildren.set(child.status, remaining - 1);
  }
  return {
    taskId,
    cycleNumber: source.cycleNumber,
    receiptTotal: source.receiptTotal,
    receiptCounts,
    receipts,
    receiptsTruncated:
      source.receiptsTruncated || source.receiptTotal > receipts.length,
    childTotal: source.childTotal,
    childCounts,
    children,
    childrenTruncated:
      source.childrenTruncated || source.childTotal > children.length,
  };
}
