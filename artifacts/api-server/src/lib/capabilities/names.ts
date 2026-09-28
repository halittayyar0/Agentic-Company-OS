export const CORE_CAPABILITY_TOOL_NAMES = [
  "list_skills",
  "read_skill",
  "calculate",
  "analyze_text",
  "compare_text",
  "inspect_json",
  "profile_csv",
  "convert_datetime",
  "inspect_url",
  "hash_text",
] as const;
export const PACK_TOOL_NAMES = [
  "csv_filter",
  "csv_sort",
  "csv_dedupe",
  "csv_join",
  "csv_to_json",
  "json_to_csv",
  "json_diff",
  "json_format",
  "render_report",
  "fill_template",
  "markdown_outline",
  "compare_page_text",
] as const;
export const EXTENSION_TOOL_NAMES = [
  "list_extensions",
  "run_extension",
] as const;
export const CAPABILITY_TOOL_NAMES = [
  ...CORE_CAPABILITY_TOOL_NAMES,
  ...PACK_TOOL_NAMES,
  ...EXTENSION_TOOL_NAMES,
] as const;
export function isCapabilityTool(name: string): boolean {
  return CAPABILITY_TOOL_NAMES.some((candidate) => candidate === name);
}
