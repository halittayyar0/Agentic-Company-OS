import * as z from "zod/v4-mini";

export type OperationStore = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
export const OPERATION_RECOVERY_EVENT = "acos:operation-recovery";
export class OperationRecoveryError extends Error {
  constructor(readonly code: "storage" | "pending" | "invalid") {
    super(code);
  }
}
const id = z.number().check(z.int(), z.minimum(1), z.maximum(2147483647));
const uuid = z
  .string()
  .check(
    z.regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ),
  );
export const operationNoteBytes = (value: string) =>
  new TextEncoder().encode(value).byteLength;
const receiptId = z.string().check(
  z.minLength(1),
  z.maxLength(256),
  z.refine((s) => s === s.trim() && operationNoteBytes(s) <= 256),
);
const decision = z.enum(["confirmed_applied", "confirmed_not_applied"]);
const draftSchema = z.strictObject({
  version: z.literal(1),
  draftId: uuid,
  projectId: id,
  receiptId,
  decision: z.enum(["", "confirmed_applied", "confirmed_not_applied"]),
  note: z.string().check(z.maxLength(2000)),
});
const intentSchema = z.strictObject({
  version: z.literal(1),
  localId: uuid,
  projectId: id,
  receiptId,
  draftId: z.nullable(uuid),
  decision,
  note: z.string().check(
    z.minLength(1),
    z.maxLength(2000),
    z.refine((s) => s === s.trim() && operationNoteBytes(s) <= 2000),
  ),
});
export type OperationIntent = z.infer<typeof intentSchema>;
export type OperationDraft = z.infer<typeof draftSchema>;
export type OperationDraftValues = Pick<OperationDraft, "decision" | "note">;
export const operationIntentKey = (projectId: number) =>
  `acos.operation-intent.v1:${projectId}`;
export const operationDraftKey = (projectId: number, receipt: string) =>
  `acos.operation-draft.v1:${projectId}:${encodeURIComponent(receipt)}`;
function notify() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(OPERATION_RECOVERY_EVENT));
}
function storage(store?: OperationStore) {
  try {
    return store ?? sessionStorage;
  } catch {
    throw new OperationRecoveryError("storage");
  }
}
function get(key: string, store?: OperationStore) {
  try {
    return storage(store).getItem(key);
  } catch {
    throw new OperationRecoveryError("storage");
  }
}
function write(key: string, value: object, s: OperationStore) {
  try {
    const raw = JSON.stringify(value);
    s.setItem(key, raw);
    if (s.getItem(key) !== raw) throw Error();
  } catch {
    throw new OperationRecoveryError("storage");
  } finally {
    notify();
  }
}
function remove(key: string, s: OperationStore) {
  try {
    s.removeItem(key);
    if (s.getItem(key) !== null) throw Error();
  } catch {
    throw new OperationRecoveryError("storage");
  } finally {
    notify();
  }
}
function parseIntent(raw: string, projectId: number): OperationIntent {
  try {
    if (raw.length > 16000) throw Error();
    const value = intentSchema.parse(JSON.parse(raw));
    if (value.projectId !== projectId) throw Error();
    return value;
  } catch {
    throw new OperationRecoveryError("invalid");
  }
}
function parseDraft(
  raw: string,
  projectId: number,
  receipt: string,
): OperationDraft {
  try {
    if (raw.length > 16000) throw Error();
    const value = draftSchema.parse(JSON.parse(raw));
    if (value.projectId !== projectId || value.receiptId !== receipt)
      throw Error();
    return value;
  } catch {
    throw new OperationRecoveryError("invalid");
  }
}
export function readOperationIntentRaw(
  projectId: number,
  store?: OperationStore,
) {
  if (!id.safeParse(projectId).success)
    throw new OperationRecoveryError("invalid");
  return get(operationIntentKey(projectId), store);
}
export function readOperationIntent(projectId: number, store?: OperationStore) {
  const raw = readOperationIntentRaw(projectId, store);
  return raw === null ? null : parseIntent(raw, projectId);
}
export function readOperationDraftRaw(
  projectId: number,
  receipt: string,
  store?: OperationStore,
) {
  if (!id.safeParse(projectId).success || !receiptId.safeParse(receipt).success)
    throw new OperationRecoveryError("invalid");
  return get(operationDraftKey(projectId, receipt), store);
}
export function readOperationDraft(
  projectId: number,
  receipt: string,
  store?: OperationStore,
) {
  const raw = readOperationDraftRaw(projectId, receipt, store);
  return raw === null ? null : parseDraft(raw, projectId, receipt);
}
export function saveOperationDraft(
  projectId: number,
  receipt: string,
  values: OperationDraftValues,
  store?: OperationStore,
): OperationDraft {
  const s = storage(store);
  // Existing damaged drafts are retained until explicitly reviewed and cleared.
  readOperationDraft(projectId, receipt, s);
  const draft = parseDraft(
    JSON.stringify({
      ...values,
      version: 1,
      draftId: crypto.randomUUID(),
      projectId,
      receiptId: receipt,
    }),
    projectId,
    receipt,
  );
  write(operationDraftKey(projectId, receipt), draft, s);
  return draft;
}
export function prepareOperationIntent(
  input: Pick<OperationIntent, "projectId" | "receiptId" | "decision" | "note">,
  store?: OperationStore,
): OperationIntent {
  const s = storage(store);
  if (readOperationIntent(input.projectId, s))
    throw new OperationRecoveryError("pending");
  const draft = readOperationDraft(input.projectId, input.receiptId, s);
  const intent = parseIntent(
    JSON.stringify({
      ...input,
      note: input.note.trim(),
      version: 1,
      localId: crypto.randomUUID(),
      draftId:
        draft?.decision === input.decision &&
        draft.note.trim() === input.note.trim()
          ? draft.draftId
          : null,
    }),
    input.projectId,
  );
  write(operationIntentKey(input.projectId), intent, s);
  return intent;
}
export function acknowledgeOperationIntent(
  intent: OperationIntent,
  store?: OperationStore,
): boolean {
  const s = storage(store);
  const saved = readOperationIntent(intent.projectId, s);
  if (!saved || saved.localId !== intent.localId) return false;
  if (
    JSON.stringify(saved) !==
    JSON.stringify(parseIntent(JSON.stringify(intent), intent.projectId))
  )
    throw new OperationRecoveryError("invalid");
  // Clear only the exact submitted draft revision. Newer edits stay untouched.
  let draft: OperationDraft | null = null;
  try {
    draft = readOperationDraft(intent.projectId, intent.receiptId, s);
  } catch (error) {
    // A damaged companion must remain available for explicit review, but it
    // cannot trap an independently valid intent in permanent recovery.
    if (!(error instanceof OperationRecoveryError) || error.code !== "invalid")
      throw error;
  }
  if (draft && draft.draftId === saved.draftId)
    remove(operationDraftKey(intent.projectId, intent.receiptId), s);
  remove(operationIntentKey(intent.projectId), s);
  return true;
}
export function clearDamagedOperationIntent(
  projectId: number,
  reviewedRaw: string,
  store?: OperationStore,
) {
  const s = storage(store);
  if (readOperationIntentRaw(projectId, s) !== reviewedRaw)
    throw new OperationRecoveryError("pending");
  let damaged = false;
  try {
    parseIntent(reviewedRaw, projectId);
  } catch {
    damaged = true;
  }
  if (!damaged) throw new OperationRecoveryError("pending");
  remove(operationIntentKey(projectId), s);
}
export function discardOperationDraft(
  projectId: number,
  receipt: string,
  reviewedRaw: string,
  store?: OperationStore,
) {
  const s = storage(store);
  if (readOperationDraftRaw(projectId, receipt, s) !== reviewedRaw)
    throw new OperationRecoveryError("pending");
  remove(operationDraftKey(projectId, receipt), s);
}
