import type { WorkspaceLocale } from "../workspace-locale";
import type { ToolMessage } from "../orchestrator/tool-copy";
import { toolMessage } from "../orchestrator/tool-localization";

/** Authored diagnostics carry a typed presentation key; native errors stay source. */
export class BrowserDiagnosticError extends Error {
  constructor(
    message: string,
    readonly toolMessage?: ToolMessage,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function localizedBrowserDiagnostic(
  error: BrowserDiagnosticError,
  locale: WorkspaceLocale,
): string {
  return error.toolMessage
    ? toolMessage(locale, error.toolMessage.key, error.toolMessage.params)
    : error.message;
}
