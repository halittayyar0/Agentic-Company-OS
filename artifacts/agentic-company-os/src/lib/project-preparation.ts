import { hasComposerDraftInput } from "./composer-draft";
import type { ProjectDraft } from "./project-start-request";
import { readSkillDraft } from "./skill-draft";

export type ProjectPreparation = {
  title: string;
  brief: string;
  source?:
    | { kind: "project"; id: number; status: string; updatedAt: string }
    | { kind: "guide"; id: string; revision: number; enabled: boolean };
};

const positiveInt = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 2147483647;
function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const parts = value.match(
    /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u,
  );
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(parts[1]),
    month = Number(parts[2]),
    day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}
function readSource(value: unknown): ProjectPreparation["source"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (
    "kind" in value &&
    value.kind === "project" &&
    keys.length === 4 &&
    keys.every((key) => ["kind", "id", "status", "updatedAt"].includes(key)) &&
    "id" in value &&
    positiveInt(value.id) &&
    "status" in value &&
    typeof value.status === "string" &&
    value.status.length >= 1 &&
    value.status.length <= 64 &&
    "updatedAt" in value &&
    timestamp(value.updatedAt)
  )
    return {
      kind: "project",
      id: value.id,
      status: value.status,
      updatedAt: value.updatedAt,
    };
  if (
    "kind" in value &&
    value.kind === "guide" &&
    keys.length === 4 &&
    keys.every((key) => ["kind", "id", "revision", "enabled"].includes(key)) &&
    "id" in value &&
    typeof value.id === "string" &&
    /^user-[a-z0-9][a-z0-9-]{0,59}$/u.test(value.id) &&
    "revision" in value &&
    positiveInt(value.revision) &&
    "enabled" in value &&
    typeof value.enabled === "boolean"
  )
    return {
      kind: "guide",
      id: value.id,
      revision: value.revision,
      enabled: value.enabled,
    };
  return null;
}

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
  const source = readSource(value.source);
  return source ? { ...draft, source } : null;
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
