import { isWorkspaceLocale, type WorkspaceLocale } from "../workspace-locale";
import { GROUPS, type BuiltinSkill, type LibraryCopy } from "./catalog-types";
import { catalogLocales } from "./catalog-locales";
import { CAPABILITY_TOOL_NAMES } from "./names";
export { CAPABILITY_TOOL_NAMES } from "./names";

const ids = [
  "source-brief",
  "competitor-map",
  "claim-check",
  "product-comparison",
  "literature-map",
  "interview-plan",
  "code-review",
  "bug-triage",
  "test-plan",
  "api-contract",
  "release-readiness",
  "dependency-review",
  "csv-quality",
  "json-audit",
  "metric-report",
  "data-dictionary",
  "reconciliation",
  "experiment-analysis",
  "document-outline",
  "edit-copy",
  "translation-review",
  "faq-draft",
  "changelog",
  "meeting-actions",
  "project-plan",
  "incident-review",
  "runbook",
  "risk-register",
  "process-map",
  "handoff",
] as const;
const groupTools = {
  research: ["browser_open", "browser_extract_text", "inspect_url", "log_note"],
  engineering: [
    "vm_list_files",
    "vm_read_file",
    "compare_text",
    "inspect_json",
    "log_note",
  ],
  data: [
    "vm_read_file",
    "profile_csv",
    "inspect_json",
    "calculate",
    "hash_text",
  ],
  content: ["vm_read_file", "analyze_text", "compare_text", "log_note"],
  operations: [
    "convert_datetime",
    "calculate",
    "log_note",
    "request_user_input",
  ],
};

export function getCapabilityCatalog(locale: WorkspaceLocale) {
  if (!isWorkspaceLocale(locale))
    throw new TypeError("Invalid capability locale");
  const data = catalogLocales[locale];
  if (
    data.skills.length !== ids.length ||
    data.tools.length !== CAPABILITY_TOOL_NAMES.length
  )
    throw new Error("Incomplete capability catalog");
  const skills: BuiltinSkill[] = ids.map((id, index) => {
    const group = GROUPS[Math.floor(index / 6)];
    const [title, deliverable] = data.skills[index];
    return {
      id,
      version: 1,
      group,
      groupTitle: data.groups[group].title,
      title,
      deliverable,
      inputs: [...data.groups[group].inputs],
      steps: [...data.groups[group].steps, deliverable],
      checks: [...data.checks],
      tools: [...groupTools[group]],
      permissions:
        group === "research"
          ? ["canBrowse"]
          : ["engineering", "data", "content"].includes(group)
            ? ["canUseTerminal"]
            : [],
    };
  });
  return {
    locale,
    version: 1,
    copy: { ...data.copy },
    groups: GROUPS.map((id) => ({ id, title: data.groups[id].title })),
    skills,
    tools: CAPABILITY_TOOL_NAMES.map((name, index) => ({
      name,
      title: data.tools[index][0],
      description: data.tools[index][1],
    })),
  };
}

export function skillProjectDraft(skill: BuiltinSkill, copy: LibraryCopy) {
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
