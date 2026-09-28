import { isWorkspaceLocale, type WorkspaceLocale } from "../workspace-locale";
import { toolTr, type ToolCopy, type ToolMessageKey } from "./tool-copy";
import { toolEn } from "./tool-locales/en";
import { toolDe } from "./tool-locales/de";
import { toolRu } from "./tool-locales/ru";
import { toolZhCN } from "./tool-locales/zh-CN";
import { toolZhTW } from "./tool-locales/zh-TW";
import { toolAr } from "./tool-locales/ar";
import { getTerminalCopy } from "../vm/terminal-localization";
import type { ModelAttemptFailure, ModelFailureKind } from "./model-fallback";

const catalogs: Record<WorkspaceLocale, ToolCopy> = {
  tr: toolTr,
  en: toolEn,
  de: toolDe,
  ru: toolRu,
  "zh-CN": toolZhCN,
  "zh-TW": toolZhTW,
  ar: toolAr,
};

export function getToolCopy(locale: WorkspaceLocale): Readonly<ToolCopy> {
  if (!isWorkspaceLocale(locale))
    throw new TypeError("Invalid tool execution locale");
  return Object.freeze(catalogs[locale]);
}

export function toolMessage(
  locale: WorkspaceLocale,
  key: ToolMessageKey,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const copy = getToolCopy(locale);
  if (!Object.hasOwn(copy, key))
    throw new TypeError("Invalid tool message key");
  // Never rescan substitution values: operator/source text can contain braces.
  return copy[key].replace(
    /\{([A-Za-z][A-Za-z0-9]*)\}/g,
    (_match, name: string) => {
      if (!Object.hasOwn(params, name))
        throw new TypeError(`Missing tool parameter: ${name}`);
      return String(params[name]);
    },
  );
}

const dispatchKeys: Readonly<Record<string, ToolMessageKey>> = Object.freeze({
  create_sub_agent: "teamCreateDispatch",
  delegate_task: "teamDelegateDispatch",
  update_task_progress: "teamProgressDispatch",
  complete_task: "teamCompleteDispatch",
  request_approval: "teamApprovalDispatch",
  request_user_input: "teamQuestionDispatch",
  log_note: "teamNoteDispatch",
  post_company_message: "teamMessageDispatch",
  computer_observe: "computerDispatch",
  vm_list_files: "listDispatch",
  vm_read_file: "readDispatch",
  vm_write_file: "writeDispatch",
  browser_open: "browserOpenDispatch",
  browser_snapshot: "browserSnapshotDispatch",
  browser_click: "browserClickDispatch",
  browser_type: "browserTypeDispatch",
  browser_scroll: "browserScrollDispatch",
  browser_extract_text: "browserExtractDispatch",
  browser_wait: "browserWaitDispatch",
  browser_save_screenshot: "browserScreenshotDispatch",
});

/** Running-state prose must not claim that the proposed effect already succeeded. */
export function toolDispatchText(
  locale: WorkspaceLocale,
  toolName: string,
): string {
  if (toolName === "vm_run_command")
    return getTerminalCopy(locale).terminalDispatch;
  if (toolName === "vm_run_sudo_command")
    return getTerminalCopy(locale).sudoDispatch;
  return Object.hasOwn(dispatchKeys, toolName)
    ? getToolCopy(locale)[dispatchKeys[toolName]]
    : toolMessage(locale, "toolDispatch", { tool: toolName });
}

const failureKeys = {
  rate_limit: "failureRateLimit",
  timeout: "failureTimeout",
  authentication: "failureAuthentication",
  payment_required: "failurePayment",
  model_unavailable: "failureModelUnavailable",
  tool_compatibility: "failureToolCompatibility",
  provider_unavailable: "failureProviderUnavailable",
} as const satisfies Record<ModelFailureKind, ToolMessageKey>;

/** The bounded failure code/model identity remains literal diagnostic evidence. */
export function toolModelFailureText(
  locale: WorkspaceLocale,
  failure: ModelAttemptFailure,
): string {
  return toolMessage(locale, "modelFailure", {
    reason: getToolCopy(locale)[failureKeys[failure.kind]],
    source: failure.safeMessage,
  });
}
