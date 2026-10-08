import * as z from "zod/v4-mini";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const homeSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("home"),
  prompt: z.string().check(z.maxLength(7000)),
  mode: z.enum(["team", "engineer", "research", "compare"]),
});
const projectSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("project"),
  title: z.string().check(z.maxLength(300)),
  brief: z.string().check(z.maxLength(8000)),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  autonomyMode: z.enum(["finite", "continuous"]),
  cadenceSeconds: z.literal([900, 3600, 21600, 86400, 604800]),
});
export type ComposerDraft =
  z.infer<typeof homeSchema> | z.infer<typeof projectSchema>;
function parseDraft(value: unknown): ComposerDraft {
  return (
    value !== null &&
    typeof value === "object" &&
    "kind" in value &&
    value.kind === "home"
      ? homeSchema
      : projectSchema
  ).parse(value);
}
export type ComposerDraftKind = ComposerDraft["kind"];
export const composerDraftKey = (kind: ComposerDraftKind) =>
  `acos.composer-draft.v1:${kind}`;
const same = (a: ComposerDraft, b: ComposerDraft) =>
  JSON.stringify(a) === JSON.stringify(b);
export function readComposerDraft(
  kind: ComposerDraftKind,
  store: Store,
): { draft: ComposerDraft | null; error: boolean } {
  try {
    const raw = store.getItem(composerDraftKey(kind));
    if (raw === null) return { draft: null, error: false };
    if (raw.length > 32768) throw Error("oversized");
    const draft = parseDraft(JSON.parse(raw));
    if (draft.kind !== kind) throw Error("wrong_scope");
    return { draft, error: false };
  } catch {
    return { draft: null, error: true };
  }
}
export function writeComposerDraft(value: unknown, store: Store): boolean {
  try {
    const draft = parseDraft(value);
    if (readComposerDraft(draft.kind, store).error) return false;
    const raw = JSON.stringify(draft);
    if (raw.length > 32768) return false;
    store.setItem(composerDraftKey(draft.kind), raw);
    const after = readComposerDraft(draft.kind, store);
    return !after.error && !!after.draft && same(after.draft, draft);
  } catch {
    return false;
  }
}
/** Clear only the exact acknowledged submission's draft, never a later edit. */
export function clearComposerDraft(value: unknown, store: Store): boolean {
  try {
    const draft = parseDraft(value),
      prior = readComposerDraft(draft.kind, store);
    if (prior.error || (prior.draft && !same(prior.draft, draft))) return false;
    store.removeItem(composerDraftKey(draft.kind));
    return store.getItem(composerDraftKey(draft.kind)) === null;
  } catch {
    return false;
  }
}
