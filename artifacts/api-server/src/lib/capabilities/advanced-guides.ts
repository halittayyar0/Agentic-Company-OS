import type { WorkspaceLocale } from "../workspace-locale";
import type { BuiltinSkill, SkillGroup } from "./catalog-types";
import { advancedGuideLocales } from "./advanced-guide-locales";

// IDs and tool requirements are independent of translation order.
export const ADVANCED_GUIDES = {
  "procurement-scorecard": [
    "research",
    ["browser_open", "browser_extract_text", "calculate", "markdown_table"],
  ],
  "research-watch-brief": [
    "research",
    [
      "browser_open",
      "browser_extract_text",
      "compare_page_text",
      "inspect_url",
    ],
  ],
  "feedback-synthesis": [
    "research",
    ["analyze_text", "csv_group", "markdown_table"],
  ],
  "source-change-review": [
    "research",
    ["compare_page_text", "compare_text", "hash_text"],
  ],
  "debugging-case": [
    "engineering",
    ["vm_read_file", "text_find", "compare_text"],
  ],
  "performance-investigation": [
    "engineering",
    ["vm_read_file", "csv_group", "calculate"],
  ],
  "security-threat-review": [
    "engineering",
    ["vm_read_file", "text_find", "markdown_table"],
  ],
  "migration-rehearsal": [
    "engineering",
    ["vm_read_file", "json_diff", "compare_lists"],
  ],
  "sales-pipeline-audit": [
    "data",
    ["profile_csv", "csv_group", "date_interval"],
  ],
  "cohort-retention-review": [
    "data",
    ["profile_csv", "csv_dedupe", "calculate"],
  ],
  "funnel-dropoff-review": ["data", ["profile_csv", "csv_filter", "calculate"]],
  "inventory-reorder-plan": ["data", ["csv_join", "csv_group", "calculate"]],
  "client-proposal": [
    "content",
    ["fill_template", "analyze_text", "markdown_table"],
  ],
  "help-center-article": [
    "content",
    ["markdown_outline", "analyze_text", "text_find"],
  ],
  "onboarding-sequence": [
    "content",
    ["fill_template", "analyze_text", "compare_lists"],
  ],
  "editorial-calendar": [
    "content",
    ["convert_datetime", "markdown_table", "compare_lists"],
  ],
  "recurring-operations-review": [
    "operations",
    ["date_interval", "markdown_table", "compare_lists"],
  ],
  "launch-coordination-plan": [
    "operations",
    ["date_interval", "markdown_table", "calculate"],
  ],
  "vendor-handoff-packet": [
    "operations",
    ["compare_lists", "hash_text", "markdown_table"],
  ],
  "standard-operating-procedure": [
    "operations",
    ["markdown_outline", "fill_template", "compare_lists"],
  ],
} as const satisfies Record<string, readonly [SkillGroup, readonly string[]]>;

export type AdvancedGuideId = keyof typeof ADVANCED_GUIDES;
export function advancedGuides(
  locale: WorkspaceLocale,
  groupTitles: Record<SkillGroup, { title: string }>,
): BuiltinSkill[] {
  return (Object.keys(ADVANCED_GUIDES) as AdvancedGuideId[]).map((id) => {
    const [group, toolNames] = ADVANCED_GUIDES[id];
    const text = advancedGuideLocales[locale][id];
    return {
      id,
      version: 1,
      group,
      groupTitle: groupTitles[group].title,
      ...text,
      inputs: [...text.inputs],
      steps: [...text.steps],
      checks: [...text.checks],
      tools: [...toolNames],
      permissions: toolNames.some((tool) => tool === "browser_extract_text")
        ? ["canBrowse"]
        : toolNames.some((tool) => tool === "vm_read_file")
          ? ["canUseTerminal"]
          : [],
    };
  });
}
