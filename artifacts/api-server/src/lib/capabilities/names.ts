export const CAPABILITY_TOOL_NAMES = [
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
export function isCapabilityTool(name: string): boolean {
  return CAPABILITY_TOOL_NAMES.some((candidate) => candidate === name);
}
