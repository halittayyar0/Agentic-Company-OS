import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import {
  db,
  executionPolicyTable,
  activityEventsTable,
  runtimeControlsTable,
  type CustomExecutionPermissions,
} from "@workspace/db";
import { CAPABILITY_TOOL_NAMES } from "./capabilities/names";

const customSchema = z
  .object({
    files: z.boolean(),
    terminal: z.boolean(),
    browser: z.boolean(),
    delegation: z.boolean(),
    sudo: z.boolean(),
  })
  .strict();
const updateSchema = z
  .object({
    mode: z.enum(["read_only", "approval", "full_access", "custom"]),
    expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    custom: customSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.mode === "custom") !== (value.custom !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "custom permissions are required only for custom mode",
      });
  });
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Policy = typeof executionPolicyTable.$inferSelect;
const scope = new AsyncLocalStorage<{
  tool: string;
  automaticRevision?: number;
}>();
const observe = new Set<string>([
  ...CAPABILITY_TOOL_NAMES,
  "computer_observe",
  "vm_list_files",
  "vm_read_file",
  "browser_snapshot",
  "browser_extract_text",
  "browser_wait",
  "log_note",
  "post_company_message",
  "update_task_progress",
  "complete_task",
  "request_user_input",
  "request_approval",
]);
const classes: Record<string, keyof CustomExecutionPermissions> = {
  vm_write_file: "files",
  browser_save_screenshot: "files",
  vm_run_command: "terminal",
  vm_codex_task: "terminal",
  vm_run_sudo_command: "sudo",
  browser_open: "browser",
  browser_click: "browser",
  browser_type: "browser",
  browser_scroll: "browser",
  create_sub_agent: "delegation",
  delegate_task: "delegation",
};
export class ExecutionPolicyConflict extends Error {
  constructor() {
    super("Execution policy revision changed");
  }
}
export class ExecutionPolicyDenied extends Error {
  readonly code = "EXECUTION_POLICY_DENIED";
  constructor() {
    super("EXECUTION_POLICY_DENIED");
  }
}
export function withToolPolicy<T>(
  tool: string,
  operation: () => Promise<T>,
  automaticRevision?: number,
): Promise<T> {
  return scope.run({ tool, automaticRevision }, operation);
}
export async function readExecutionPolicy(
  connection: Transaction | typeof db = db,
): Promise<Policy> {
  const [policy] = await connection
    .select()
    .from(executionPolicyTable)
    .where(eq(executionPolicyTable.id, 1));
  if (!policy) throw new Error("Execution policy state is missing");
  return policy;
}
export function policyAllowsTool(policy: Policy, tool: string): boolean {
  if (observe.has(tool)) return true;
  if (!Object.hasOwn(classes, tool)) return false;
  if (policy.mode === "read_only") return false;
  if (policy.mode === "custom") return policy.custom?.[classes[tool]] === true;
  return policy.mode === "approval" || policy.mode === "full_access";
}
export async function assertToolPolicy(
  connection: Transaction | typeof db = db,
): Promise<void> {
  const context = scope.getStore();
  if (!context) return;
  const policy = await readExecutionPolicy(connection);
  if (
    !policyAllowsTool(policy, context.tool) ||
    (context.automaticRevision !== undefined &&
      (policy.mode !== "full_access" ||
        policy.revision !== context.automaticRevision))
  )
    throw new ExecutionPolicyDenied();
}
export async function updateExecutionPolicy(input: unknown): Promise<Policy> {
  const selected = updateSchema.parse(input);
  return db.transaction(async (tx) => {
    // Share the runtime-control-first lock order with effect admission.
    await tx.execute(
      sql`SELECT id FROM ${runtimeControlsTable} WHERE ${runtimeControlsTable.id} = 1 FOR UPDATE`,
    );
    const [updated] = await tx
      .update(executionPolicyTable)
      .set({
        mode: selected.mode,
        custom: selected.custom ?? null,
        revision: sql`${executionPolicyTable.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        sql`${executionPolicyTable.id} = 1 AND ${executionPolicyTable.revision} = ${selected.expectedRevision}`,
      )
      .returning();
    if (!updated) throw new ExecutionPolicyConflict();
    await tx.insert(activityEventsTable).values({
      type: "operations_changed",
      summary: "Operator updated execution permissions",
      severity: "info",
      detail: {
        kind: "execution_policy_changed",
        actor: "operator",
        mode: updated.mode,
        revision: updated.revision,
        custom: updated.custom,
      },
    });
    return updated;
  });
}
