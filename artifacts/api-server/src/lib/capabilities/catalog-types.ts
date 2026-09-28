export const GROUPS = [
  "research",
  "engineering",
  "data",
  "content",
  "operations",
] as const;
export type SkillGroup = (typeof GROUPS)[number];
export interface LibraryCopy {
  title: string;
  intro: string;
  search: string;
  all: string;
  empty: string;
  skills: string;
  tools: string;
  inputs: string;
  steps: string;
  checks: string;
  deliverable: string;
  use: string;
  requirements: string;
  browser: string;
  files: string;
  boundary: string;
  toolBoundary: string;
  error: string;
  retry: string;
  loading: string;
  invalid: string;
  completed: string;
  skillMissing: string;
}
export interface CatalogLocale {
  copy: LibraryCopy;
  groups: Record<
    SkillGroup,
    { title: string; inputs: string[]; steps: string[] }
  >;
  checks: string[];
  /** Ordered alongside stable metadata. Each tuple is a title and a concrete acceptance target. */
  skills: readonly (readonly [string, string])[];
  tools: readonly (readonly [string, string])[];
}
export interface BuiltinSkill {
  id: string;
  version: number;
  group: SkillGroup;
  groupTitle: string;
  title: string;
  deliverable: string;
  inputs: string[];
  steps: string[];
  checks: string[];
  tools: string[];
  permissions: ("canBrowse" | "canUseTerminal")[];
}
