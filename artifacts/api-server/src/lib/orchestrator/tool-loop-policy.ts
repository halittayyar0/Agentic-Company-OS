import { hasLocalizedToolOutput } from "./tool-presentation";
import type { WorkspaceLocale } from "../workspace-locale";
import { terminalMessage } from "../vm/terminal-localization";

export type AgentLoopMode = "chat" | "task";

export function isTerminalTool(name: string): boolean {
  return name === "vm_run_command" || name === "vm_run_sudo_command";
}

const COMPUTER_TOOL_PREFIXES = ["browser_", "vm_"] as const;

export function isComputerTool(toolName: string): boolean {
  return (
    toolName === "computer_observe" ||
    COMPUTER_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix))
  );
}

export function computerSurfaceForTool(
  toolName: string,
): "computer" | "browser" | "terminal" | "files" {
  if (toolName === "computer_observe") return "computer";
  if (toolName.startsWith("browser_")) return "browser";
  if (
    toolName === "vm_list_files" ||
    toolName === "vm_read_file" ||
    toolName === "vm_write_file"
  ) {
    return "files";
  }
  return "terminal";
}

/**
 * Computer operations are stateful. A model batch is planned against one
 * observation, so only its first computer call may execute; later calls must
 * be reconsidered after the first result is visible to the model.
 */
export function shouldDeferComputerTool(
  toolName: string,
  computerToolAlreadyExecuted: boolean,
): boolean {
  return computerToolAlreadyExecuted && isComputerTool(toolName);
}

export function deferredComputerToolMessage(
  toolName: string,
  locale?: WorkspaceLocale,
): string {
  if (locale && hasLocalizedToolOutput(toolName))
    return terminalMessage(locale, "computerDeferred", { tool: toolName });
  return [
    `ERTELENDI: ${toolName} ayni model batch'indeki onceki bilgisayar adimina dayanarak guvenle calistirilamaz.`,
    "Onceki arac sonucunu incele; gerekirse computer_observe ile guncel durumu gor ve sonraki turda bu eylemi yeniden oner.",
  ].join(" ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Gives cross-surface workflows enough room without opening an unbounded
 * autonomous loop. Operators can set a lower or higher cap (4..16).
 */
export function resolveMaxToolRounds(
  mode: AgentLoopMode,
  toolNames: string[],
  configuredValue = process.env.MAX_AGENT_TOOL_ROUNDS,
): number {
  const configured = Number(configuredValue);
  if (Number.isFinite(configured) && configured > 0) {
    return clamp(configured, 4, 16);
  }

  const hasBrowser = toolNames.some((name) => name.startsWith("browser_"));
  const hasTerminal = toolNames.some((name) => name.startsWith("vm_"));
  const base = mode === "chat" ? 6 : 5;
  return clamp(base + (hasBrowser ? 2 : 0) + (hasTerminal ? 2 : 0), 4, 12);
}

/**
 * A round cap alone is insufficient because one model response may contain an
 * arbitrarily large tool-call array. Reject the whole oversized batch before
 * executing its first side effect.
 */
export function resolveMaxToolCallsPerRound(
  configuredValue = process.env.MAX_AGENT_TOOL_CALLS_PER_ROUND,
): number {
  const configured = Number(configuredValue);
  if (!Number.isFinite(configured) || configured <= 0) return 8;
  return clamp(configured, 1, 32);
}
