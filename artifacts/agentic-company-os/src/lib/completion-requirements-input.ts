import * as z from "zod/v4-mini";

// A local data boundary, never authority to register or execute a tool. The
// server separately validates current permissions and persisted success.
const excluded = new Set([
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
export const completionRequirementsSchema = z
  .array(
    z.strictObject({
      kind: z.literal("tool_succeeded"),
      tool: z.string().check(
        z.regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/u),
        z.refine((name) => !excluded.has(name)),
      ),
    }),
  )
  .check(
    z.maxLength(8),
    z.refine(
      (items) => new Set(items.map((item) => item.tool)).size === items.length,
    ),
  );
export type CompletionRequirement = z.infer<
  typeof completionRequirementsSchema
>[number];
export function canonicalCompletionRequirements(
  value: unknown,
): CompletionRequirement[] {
  return completionRequirementsSchema
    .parse(value)
    .sort((a, b) => (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0));
}
