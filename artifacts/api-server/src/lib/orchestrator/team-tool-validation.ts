import { getToolCopy, toolMessage } from "./tool-localization";
import type { WorkspaceLocale } from "../workspace-locale";

export const TEAM_TOOL_NAMES = new Set([
  "create_sub_agent",
  "delegate_task",
  "update_task_progress",
  "complete_task",
  "request_approval",
  "request_user_input",
  "log_note",
  "post_company_message",
]);

/** Validate the original JSON before identity normalization can coerce it. */
export function validateTeamToolArgs(
  name: string,
  args: Record<string, unknown>,
  locale: WorkspaceLocale,
): string | null {
  if (!TEAM_TOOL_NAMES.has(name)) return null;
  const copy = getToolCopy(locale);
  const required: Record<string, readonly string[]> = {
    create_sub_agent: ["name", "role", "systemPrompt"],
    delegate_task: ["title", "brief"],
    complete_task: ["resultSummary"],
    request_user_input: ["question"],
    log_note: ["summary"],
    post_company_message: ["content"],
    request_approval:
      args.toolName === "vm_run_sudo_command" ? [] : ["title", "description"],
  };
  for (const field of required[name] ?? []) {
    if (typeof args[field] !== "string" || !(args[field] as string).trim())
      return toolMessage(locale, "teamStringRequired", { field });
  }
  const optional =
    name === "update_task_progress"
      ? ["note"]
      : name === "request_approval"
        ? ["title", "description", "toolName", "target"]
        : [];
  for (const field of optional) {
    if (args[field] !== undefined && typeof args[field] !== "string")
      return toolMessage(locale, "teamStringInvalid", { field });
  }
  if (
    name === "request_approval" &&
    typeof args.toolName === "string" &&
    args.toolName !== args.toolName.trim()
  )
    return copy.teamToolNameInvalid;
  const positiveId = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  if (name === "delegate_task") {
    if (!positiveId(args.agentId))
      return toolMessage(locale, "teamNumberInvalid", { field: "agentId" });
    if (
      args.priority !== undefined &&
      !["low", "normal", "high", "urgent"].includes(args.priority as string)
    )
      return toolMessage(locale, "teamChoiceInvalid", {
        field: "priority",
        choices: "low/normal/high/urgent",
      });
    if (
      args.autonomyMode !== undefined &&
      args.autonomyMode !== "finite" &&
      args.autonomyMode !== "continuous"
    )
      return copy.teamCadenceInvalid;
    if (
      args.cadenceSeconds !== undefined &&
      args.cadenceSeconds !== null &&
      (args.autonomyMode !== "continuous" ||
        typeof args.cadenceSeconds !== "number" ||
        !Number.isSafeInteger(args.cadenceSeconds) ||
        args.cadenceSeconds < 60 ||
        args.cadenceSeconds > 604_800)
    )
      return copy.teamCadenceInvalid;
  }
  if (
    name === "update_task_progress" &&
    (typeof args.progressPercent !== "number" ||
      !Number.isFinite(args.progressPercent) ||
      args.progressPercent < 0 ||
      args.progressPercent > 100)
  )
    return toolMessage(locale, "teamNumberInvalid", {
      field: "progressPercent",
    });
  if (
    name === "post_company_message" &&
    args.replyToMessageId !== undefined &&
    args.replyToMessageId !== null &&
    !positiveId(args.replyToMessageId)
  )
    return toolMessage(locale, "teamNumberInvalid", {
      field: "replyToMessageId",
    });
  if (name === "request_approval") {
    if (
      args.category !== undefined &&
      !["spend", "delete", "publish", "external_contact", "other"].includes(
        args.category as string,
      )
    )
      return toolMessage(locale, "teamChoiceInvalid", {
        field: "category",
        choices: "spend/delete/publish/external_contact/other",
      });
    if (
      args.amountUsd !== undefined &&
      (typeof args.amountUsd !== "number" ||
        !Number.isFinite(args.amountUsd) ||
        args.amountUsd < 0)
    )
      return toolMessage(locale, "teamNumberInvalid", { field: "amountUsd" });
    if (
      args.toolArgs !== undefined &&
      (!args.toolArgs ||
        typeof args.toolArgs !== "object" ||
        Array.isArray(args.toolArgs))
    )
      return copy.teamApprovalArgsInvalid;
    const scoped = args.toolArgs as Record<string, unknown> | undefined;
    if (
      scoped &&
      (args.toolName === "vm_run_command" ||
        args.toolName === "vm_run_sudo_command") &&
      (typeof scoped.command !== "string" || !scoped.command.trim())
    )
      return toolMessage(locale, "teamStringRequired", {
        field: "toolArgs.command",
      });
    if (
      scoped &&
      (args.toolName === "browser_click" || args.toolName === "browser_type")
    ) {
      if (!positiveId(scoped.ref)) return copy.browserRefRequired;
      if (args.toolName === "browser_type") {
        if (typeof scoped.text !== "string") return copy.browserTextRequired;
        if (scoped.submit !== undefined && typeof scoped.submit !== "boolean")
          return copy.browserSubmitInvalid;
        if (scoped.submit === true) return copy.browserSeparateSubmit;
      }
    }
  }
  return null;
}
