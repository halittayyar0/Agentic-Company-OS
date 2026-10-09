import * as z from "zod/v4-mini";
import type { CodexSessionRecoveryReceipt } from "@workspace/api-client-react";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const revision = z
  .number()
  .check(z.int(), z.minimum(1), z.maximum(Number.MAX_SAFE_INTEGER));
const uuid = z
  .string()
  .check(
    z.regex(
      /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    ),
  );
const intentSchema = z.strictObject({
  version: z.literal(1),
  taskId: z.number().check(z.int(), z.minimum(1), z.maximum(2147483647)),
  requestId: uuid,
  expectedRevision: revision,
});
export type CodingRecoveryIntent = z.infer<typeof intentSchema>;
export const codingRecoveryKey = (taskId: number) =>
  `acos.coding-recovery.v1:${taskId}`;
const same = (a: CodingRecoveryIntent, b: CodingRecoveryIntent) =>
  a.version === b.version &&
  a.taskId === b.taskId &&
  a.requestId === b.requestId &&
  a.expectedRevision === b.expectedRevision;
export function readCodingRecoveryIntent(
  taskId: number,
  store: Store,
): { intent: CodingRecoveryIntent | null; error: boolean } {
  try {
    const raw = store.getItem(codingRecoveryKey(taskId));
    if (raw === null) return { intent: null, error: false };
    if (raw.length > 512) throw Error("invalid");
    const intent = intentSchema.parse(JSON.parse(raw));
    if (intent.taskId !== taskId) throw Error("scope");
    return { intent, error: false };
  } catch {
    return { intent: null, error: true };
  }
}
export function saveCodingRecoveryIntent(
  intent: CodingRecoveryIntent,
  store: Store,
) {
  try {
    intent = intentSchema.parse(intent);
    const prior = readCodingRecoveryIntent(intent.taskId, store);
    if (prior.error || (prior.intent && !same(prior.intent, intent)))
      return false;
    store.setItem(codingRecoveryKey(intent.taskId), JSON.stringify(intent));
    const after = readCodingRecoveryIntent(intent.taskId, store);
    return !after.error && !!after.intent && same(after.intent, intent);
  } catch {
    return false;
  }
}
export function clearCodingRecoveryIntent(
  intent: CodingRecoveryIntent,
  store: Store,
) {
  try {
    const prior = readCodingRecoveryIntent(intent.taskId, store);
    if (prior.error || (prior.intent && !same(prior.intent, intent)))
      return false;
    store.removeItem(codingRecoveryKey(intent.taskId));
    return store.getItem(codingRecoveryKey(intent.taskId)) === null;
  } catch {
    return false;
  }
}
const receiptSchema = z.strictObject({
  requestId: uuid,
  taskId: z.number().check(z.int(), z.minimum(1), z.maximum(2147483647)),
  expectedRevision: revision,
  outcome: z.enum(["accepted", "rejected"]),
  reason: z.nullable(
    z.enum([
      "task_missing",
      "session_missing",
      "revision_changed",
      "revision_exhausted",
      "task_active",
      "session_running",
      "cleanup_unknown",
      "native_pending",
      "already_reset",
    ]),
  ),
  revision: z.nullable(revision),
  recordedAt: z
    .number()
    .check(z.int(), z.minimum(0), z.maximum(Number.MAX_SAFE_INTEGER)),
  taskResumed: z.literal(false),
  effectsReconciled: z.literal(false),
});
export function validateCodingRecoveryReceipt(
  value: unknown,
  intent: CodingRecoveryIntent,
): CodexSessionRecoveryReceipt {
  const r = receiptSchema.parse(value);
  if (
    r.requestId !== intent.requestId ||
    r.taskId !== intent.taskId ||
    r.expectedRevision !== intent.expectedRevision ||
    (r.outcome === "accepted"
      ? r.reason !== null || r.revision !== intent.expectedRevision + 1
      : r.reason === null)
  )
    throw Error("receipt_scope_mismatch");
  return r;
}
/** getRandomValues also works on a private LAN HTTP origin. No weak RNG fallback. */
export function codingRecoveryRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
