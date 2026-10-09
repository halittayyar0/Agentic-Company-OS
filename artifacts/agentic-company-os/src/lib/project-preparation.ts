import * as z from "zod/v4-mini";
import { hasComposerDraftInput } from "./composer-draft";
import type { ProjectDraft } from "./project-start-request";
import { readSkillDraft } from "./skill-draft";

const projectSource = z.strictObject({
  kind: z.literal("project"),
  id: z.number().check(z.int(), z.minimum(1), z.maximum(2147483647)),
  status: z.string().check(z.minLength(1), z.maxLength(64)),
  updatedAt: z.string().check(z.iso.datetime({ offset: true })),
});
const guideSource = z.strictObject({
  kind: z.literal("guide"),
  id: z.string().check(z.regex(/^user-[a-z0-9][a-z0-9-]{0,59}$/u)),
  revision: z.number().check(z.int(), z.minimum(1), z.maximum(2147483647)),
  enabled: z.boolean(),
});
const sourceSchema = z.union([projectSource, guideSource]);
export type ProjectPreparation = {
  title: string;
  brief: string;
  source?: z.infer<typeof sourceSchema>;
};

/** Attribution is text context only, never a permission or execution input. */
export function readProjectPreparation(
  state: unknown,
): ProjectPreparation | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const draft = readSkillDraft(state);
  if (!draft || !("acosSkillDraft" in state)) return null;
  const value = state.acosSkillDraft;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("source" in value) || value.source === undefined) return draft;
  const source = sourceSchema.safeParse(value.source);
  return source.success ? { ...draft, source: source.data } : null;
}

/** A later navigation seed must never be cleared by an earlier choice. */
export function consumeProjectPreparation(
  expected: ProjectPreparation,
  history: Pick<History, "state" | "replaceState">,
): boolean {
  try {
    const current = readProjectPreparation(history.state);
    const prepared = readProjectPreparation({ acosSkillDraft: expected });
    if (
      !current ||
      !prepared ||
      JSON.stringify(current) !== JSON.stringify(prepared)
    )
      return false;
    const { acosSkillDraft: _seed, ...rest } = history.state;
    history.replaceState(rest, "");
    return readProjectPreparation(history.state) === null;
  } catch {
    return false;
  }
}

export function hasProjectDraftInput(draft: ProjectDraft): boolean {
  return hasComposerDraftInput(draft);
}
