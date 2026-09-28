import { isWorkspaceLocale, type WorkspaceLocale } from "../workspace-locale";
import { CAPABILITY_TOOL_NAMES } from "../capabilities/names";

// Only production tools may carry this bounded presentation field. It is never
// an argument, capability, or operation identity component.
const LOCALIZED_TOOLS = new Set([
  ...CAPABILITY_TOOL_NAMES,
  "computer_observe",
  "vm_run_command",
  "vm_run_sudo_command",
  "vm_list_files",
  "vm_read_file",
  "vm_write_file",
  "browser_open",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_scroll",
  "browser_extract_text",
  "browser_wait",
  "browser_save_screenshot",
  "create_sub_agent",
  "delegate_task",
  "update_task_progress",
  "complete_task",
  "request_approval",
  "request_user_input",
  "log_note",
  "post_company_message",
]);

export function hasLocalizedToolOutput(name: string): boolean {
  return LOCALIZED_TOOLS.has(name);
}

export function toolReceiptLocale(receipt: {
  toolName: string;
  resultData: Record<string, unknown> | null;
}): WorkspaceLocale | null {
  if (!hasLocalizedToolOutput(receipt.toolName)) return null;
  const locale = receipt.resultData?.executionLocale;
  return isWorkspaceLocale(locale) ? locale : null;
}
