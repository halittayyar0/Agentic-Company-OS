import {
  readProjectPreparation,
  type ProjectPreparation,
} from "./project-preparation";
import {
  prepareExtensionSave,
  type EditableManifest,
} from "./extension-editor-draft";
type TextGuide = Extract<EditableManifest, { kind: "skill" }>;
export type PersonalGuidePreparation = {
  manifest: TextGuide;
  source: Extract<
    NonNullable<ProjectPreparation["source"]>,
    { kind: "project" }
  >;
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function prepareProjectText(
  project: unknown,
): ProjectPreparation | null {
  if (!object(project) || project.parentTaskId !== null) return null;
  return readProjectPreparation({
    acosSkillDraft: {
      title: project.title,
      brief: project.brief,
      source: {
        kind: "project",
        id: project.id,
        status: project.status,
        updatedAt: project.updatedAt,
      },
    },
  });
}
export function preparePersonalGuide(
  project: unknown,
  id: string,
  description: string,
): TextGuide | null {
  const text = prepareProjectText(project);
  if (
    !text ||
    !/^user-[a-z0-9][a-z0-9-]{0,59}$/u.test(id) ||
    !description.trim() ||
    description.length > 2000
  )
    return null;
  return {
    schemaVersion: 1,
    id,
    kind: "skill",
    title: text.title,
    description,
    instructions: text.brief,
  };
}
export function readPersonalGuidePreparation(
  state: unknown,
): PersonalGuidePreparation | null {
  if (!object(state) || !object(state.acosGuideDraft)) return null;
  const seed = state.acosGuideDraft,
    guide = seed.manifest;
  if (
    Object.keys(seed).length !== 2 ||
    !Object.keys(seed).every((key) => ["manifest", "source"].includes(key)) ||
    !object(guide) ||
    Object.keys(guide).length !== 6 ||
    !Object.keys(guide).every((key) =>
      [
        "schemaVersion",
        "id",
        "kind",
        "title",
        "description",
        "instructions",
      ].includes(key),
    ) ||
    guide.schemaVersion !== 1 ||
    guide.kind !== "skill" ||
    typeof guide.id !== "string" ||
    !/^user-[a-z0-9][a-z0-9-]{0,59}$/u.test(guide.id) ||
    typeof guide.description !== "string" ||
    !guide.description.trim() ||
    guide.description.length > 2000
  )
    return null;
  const text = readProjectPreparation({
    acosSkillDraft: {
      title: guide.title,
      brief: guide.instructions,
      source: seed.source,
    },
  });
  if (!text || text.source?.kind !== "project") return null;
  return {
    manifest: {
      schemaVersion: 1,
      id: guide.id,
      kind: "skill",
      title: text.title,
      description: guide.description,
      instructions: text.brief,
    },
    source: text.source,
  };
}
export function consumePersonalGuidePreparation(
  expected: PersonalGuidePreparation,
  history: Pick<History, "state" | "replaceState">,
): boolean {
  try {
    const current = readPersonalGuidePreparation(history.state);
    if (!current || JSON.stringify(current) !== JSON.stringify(expected))
      return false;
    const { acosGuideDraft: _seed, ...rest } = history.state;
    history.replaceState(rest, "");
    return !Object.hasOwn(history.state, "acosGuideDraft");
  } catch {
    return false;
  }
}
export function preparePersonalGuideProject(
  row: unknown,
): ProjectPreparation | null {
  if (
    !object(row) ||
    !object(row.manifest) ||
    row.manifest.kind !== "skill" ||
    row.id !== row.manifest.id ||
    !Number.isInteger(row.revision) ||
    (row.revision as number) < 1 ||
    (row.revision as number) > 2147483647 ||
    typeof row.enabled !== "boolean"
  )
    return null;
  const saved = prepareExtensionSave({
    version: 1,
    manifest: row.manifest as TextGuide,
    revision: 0,
    defaults: "{}",
    enabled: row.enabled,
  });
  if (!saved || saved.manifest.kind !== "skill") return null;
  return readProjectPreparation({
    acosSkillDraft: {
      title: saved.manifest.title,
      brief: saved.manifest.instructions,
      source: {
        kind: "guide",
        id: row.id,
        revision: row.revision,
        enabled: row.enabled,
      },
    },
  });
}
