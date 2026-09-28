import type {
  BuiltinSkill,
  CapabilityLibraryCopy,
} from "@workspace/api-client-react";

export function buildSkillDraft(
  skill: BuiltinSkill,
  copy: CapabilityLibraryCopy,
) {
  return {
    title: skill.title,
    brief: [
      skill.deliverable,
      `${copy.inputs}\n${skill.inputs.map((line) => `- ${line}`).join("\n")}`,
      `${copy.steps}\n${skill.steps.map((line, i) => `${i + 1}. ${line}`).join("\n")}`,
      `${copy.checks}\n${skill.checks.map((line) => `- ${line}`).join("\n")}`,
      copy.boundary,
    ].join("\n\n"),
  };
}

/** A draft is text only; navigation never submits a project or grants permissions. */
export function readSkillDraft(
  state: unknown,
): { title: string; brief: string } | null {
  if (!state || typeof state !== "object" || !("acosSkillDraft" in state))
    return null;
  const value = state.acosSkillDraft;
  if (
    !value ||
    typeof value !== "object" ||
    !("title" in value) ||
    !("brief" in value)
  )
    return null;
  if (
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 300 ||
    typeof value.brief !== "string" ||
    !value.brief.trim() ||
    value.brief.length > 8_000
  )
    return null;
  return { title: value.title, brief: value.brief };
}
