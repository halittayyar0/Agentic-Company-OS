export type CompletionRequirement = { kind: "tool_succeeded"; tool: string };
const MAX_REQUIREMENTS = 8;
const NON_OUTPUT_TOOLS = new Set([
  "complete_task",
  "request_approval",
  "request_user_input",
  "delegate_task",
  "create_sub_agent",
  "update_task_progress",
  "load_tools",
  "list_skills",
  "read_skill",
  "list_extensions",
  "log_note",
  "post_company_message",
  "vm_codex_task",
]);
function invalid(): never {
  throw new Error("completion_requirements_invalid");
}
/** Canonical data, not a tool registration, execution permission or proof. */
export function parseCompletionRequirements(
  input: unknown,
): CompletionRequirement[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_REQUIREMENTS)
    return invalid();
  const names = new Set<string>();
  const parsed: CompletionRequirement[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      return invalid();
    const keys = Reflect.ownKeys(item);
    if (keys.length !== 2 || !keys.includes("kind") || !keys.includes("tool"))
      return invalid();
    const fields = Object.getOwnPropertyDescriptors(item);
    const kindField = fields.kind;
    const toolField = fields.tool;
    if (
      !kindField ||
      !toolField ||
      !("value" in kindField) ||
      !("value" in toolField)
    )
      return invalid();
    const kind: unknown = kindField.value;
    const tool: unknown = toolField.value;
    if (
      kind !== "tool_succeeded" ||
      typeof tool !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/u.test(tool) ||
      NON_OUTPUT_TOOLS.has(tool) ||
      names.has(tool)
    )
      return invalid();
    names.add(tool);
    parsed.push({ kind: "tool_succeeded", tool });
  }
  return parsed.sort((a, b) =>
    a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0,
  );
}
