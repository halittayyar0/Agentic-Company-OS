import type OpenAI from "openai";
import type { WorkspaceLocale } from "../workspace-locale";
import { getToolCopy, toolMessage } from "./tool-localization";
import { terminalMessage } from "../vm/terminal-localization";

type ToolDef = OpenAI.Chat.Completions.ChatCompletionTool;

export type ExclusiveToolFamily =
  "browser" | "terminal" | "files" | "sudo_approval";

export interface ExclusiveTurnPolicy {
  readonly source: "explicit_user_exclusivity";
  readonly families: readonly ExclusiveToolFamily[];
  readonly allowedTools: readonly string[];
  /** Present only when the user supplied an unambiguous single sudo command. */
  readonly exactSudoCommand?: string;
}

export interface ExclusiveToolDecision {
  allowed: boolean;
  explanation: string;
  reason?:
    | "tool_not_allowed"
    | "invalid_arguments"
    | "sudo_command_mismatch"
    | "approval_target_not_allowed"
    | "approval_command_mismatch";
}

const BROWSER_TOOLS = [
  "browser_open",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_scroll",
  "browser_extract_text",
  "browser_wait",
  "browser_save_screenshot",
] as const;

const TERMINAL_TOOLS = ["vm_run_command"] as const;

const FAMILY_LABELS: Record<ExclusiveToolFamily, string> = {
  browser: "tarayıcı",
  terminal: "terminal",
  files: "dosya",
  sudo_approval: "CEO Host Shell onayı",
};

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/ı/gu, "i")
    .replace(/[’‘]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function hasExplicitExclusivity(normalized: string): boolean {
  const withoutReadOnly = normalized
    .replace(/https?:\/\/\S+/gu, " urltarget ")
    .replace(/\bread[ -]?only\b/gu, "")
    .replace(/\bnot only\b/gu, "")
    .replace(/\bonly\s+(?:if|when)\b/gu, "");

  return (
    /\b(?:sadece|yalniz|yalnizca)\s+(?:bunu|sunu|urltarget|bu\s+(?:(?:iki|tek)\s+)?(?:adim|islem|eylem)\w*|(?:tarayici|terminal|dosya)\w*|(?:kullan|yap|ac|dogrula|calistir|oku|yaz|kaydet|iste)\w*)\b/u.test(
      withoutReadOnly,
    ) ||
    /\b(?:sadece|yalniz|yalnizca)\b.{0,80}\bkomut(?:u|unu)?\b/u.test(
      withoutReadOnly,
    ) ||
    /\btarayici\w*\b.{0,80}\b(?:sadece|yalniz|yalnizca)\b.{0,100}\b(?:ac|dogrula|incele|kontrol et)\w*\b/u.test(
      withoutReadOnly,
    ) ||
    /\bonly\s+(?:do|use|run|execute|open|verify|check|inspect|browse|read|write|save|request|ask)\b/u.test(
      withoutReadOnly,
    ) ||
    /\bonly\s+(?:the\s+)?(?:browser|terminal|shell|file|command|action|tool)s?\b/u.test(
      withoutReadOnly,
    ) ||
    /\b(?:browser|terminal|shell|file|command|action|tool)s?\s+only\b/u.test(
      withoutReadOnly,
    ) ||
    /\b(?:exclusively|solely)\b/u.test(withoutReadOnly) ||
    /\b(?:and\s+)?nothing else\b/u.test(withoutReadOnly) ||
    /\b(?:baska|diger)\s+(?:(?:bir|hicbir)\s+)?(?:komut|arac|islem|eylem|sey)\b.{0,60}\b(?:kullanma|calistirma|cagirma|yapma)\b/u.test(
      withoutReadOnly,
    ) ||
    /\bno other\s+(?:tool|command|action|operation)s?\b/u.test(
      withoutReadOnly,
    ) ||
    /\bdo not\s+(?:use|run|call|perform)\s+(?:any\s+)?(?:other|another)\s+(?:tool|command|action|operation)s?\b/u.test(
      withoutReadOnly,
    ) ||
    /\bdon't\s+(?:use|run|call|perform)\s+(?:any\s+)?(?:other|another)\s+(?:tool|command|action|operation)s?\b/u.test(
      withoutReadOnly,
    ) ||
    /\bavoid\s+(?:all\s+)?other\s+(?:tool|command|action|operation)s?\b/u.test(
      withoutReadOnly,
    )
  );
}

function mentionsBrowser(normalized: string): boolean {
  return /(?:https?:\/\/|\b(?:browser|tarayici\w*|chrome|web ?site|web ?page|sayfa\w*|sekme\w*|url)\b)/u.test(
    normalized,
  );
}

function withoutUrls(normalized: string): string {
  return normalized.replace(/https?:\/\/\S+/gu, " ");
}

type DeniedFamily = "browser" | "terminal" | "files" | "sudo_approval";

function explicitlyDeniesFamily(
  normalized: string,
  family: DeniedFamily,
): boolean {
  const intent = withoutUrls(normalized);
  const target: Record<DeniedFamily, string> = {
    browser: "(?:browser|tarayici\\w*|chrome)",
    terminal: "(?:terminal\\w*|powershell|bash|cmd|shell)",
    files:
      "(?:dosya\\w*|file(?:s)?|folder(?:s)?|workspace file|local file|markdown)",
    sudo_approval:
      "(?:ceo host(?: shell)?|host shell|(?:root|administrator|admin) shell)",
  };
  const named = target[family];
  const english = new RegExp(
    `\\b(?:do not|don't|never)\\b[^.;\\n]{0,100}\\b${named}\\b`,
    "u",
  );
  const shortEnglish = new RegExp(
    `\\b(?:(?:no|not|without)\\s+(?:the\\s+)?${named}|avoid(?:\\s+using)?\\s+(?:the\\s+)?${named})\\b`,
    "u",
  );
  const turkish = new RegExp(
    `\\b${named}\\b[^.;\\n]{0,80}\\b(?:kullanma(?:yin|yiniz)?|calistirma(?:yin|yiniz)?|yapma(?:yin|yiniz)?|acma(?:yin|yiniz)?|yazma(?:yin|yiniz)?|kaydetme(?:yin|yiniz)?|okuma(?:yin|yiniz)?|isteme(?:yin|yiniz)?)\\b`,
    "u",
  );
  return (
    english.test(intent) || shortEnglish.test(intent) || turkish.test(intent)
  );
}

function mentionsSudo(normalized: string): boolean {
  const intent = withoutUrls(normalized);
  const namesPrivilegedSurface =
    /\b(?:host shell|ceo host(?: shell)?)\b/u.test(intent) ||
    /\b(?:root|administrator|admin)\s+(?:shell|yetki(?:si)?|privilege|permission)s?\b/u.test(
      intent,
    );
  const requestsCommandOrApproval =
    /\b(?:onay|approval|approve|komut(?:u|unu)?|command|calistir\w*|run|execute|whoami|hostname|pwd)\b/u.test(
      intent,
    );
  return namesPrivilegedSurface && requestsCommandOrApproval;
}

function explicitlyRestrictsToBrowser(normalized: string): boolean {
  const intent = withoutUrls(normalized);
  return (
    /\bonly\s+use\s+(?:the\s+)?browser\b/u.test(intent) ||
    /\buse\s+(?:the\s+)?browser\s+(?:only|exclusively|solely)\b/u.test(
      intent,
    ) ||
    /\b(?:sadece|yalniz|yalnizca)\s+tarayici\w*\s+kullan\w*\b/u.test(intent)
  );
}

function mentionsTerminal(
  normalized: string,
  browserAlsoRequested: boolean,
): boolean {
  const intent = withoutUrls(normalized);
  if (/\b(?:terminal(?:de|den)?|powershell|bash|cmd)\b/u.test(intent)) {
    return true;
  }

  const requestsExecution = /\b(?:calistir\w*|run|execute)\b/u.test(intent);
  const namesConcreteCommand = /\b(?:pwd|whoami|hostname)\b/u.test(intent);
  if (browserAlsoRequested) {
    if (explicitlyRestrictsToBrowser(normalized)) return false;
    // Browser labels and page titles often contain words such as "Run
    // Whoami". A second terminal surface needs either an explicit terminal
    // noun (handled above), a concrete command followed by an execution verb,
    // or an execution clause introduced by an exclusivity/conjunction marker.
    const concreteThenExecute =
      /\b(?:pwd|whoami|hostname)\b.{0,40}\b(?:calistir\w*|run|execute)\b/u.test(
        intent,
      );
    const markedExecute =
      /\b(?:only|sadece|yalniz|yalnizca|and|then|ve|sonra|ardindan)\s+(?:run|execute|calistir\w*)\s+(?:pwd|whoami|hostname|git\b|npm\b|pnpm\b|node\b|python\b)/u.test(
        intent,
      );
    return concreteThenExecute || markedExecute;
  }
  if (requestsExecution && namesConcreteCommand) return true;
  const namesCommand = /\b(?:komut(?:u|unu)?|command)\b/u.test(intent);
  return requestsExecution && namesCommand;
}

interface FileIntent {
  mentioned: boolean;
  allowWrite: boolean;
}

function fileIntent(normalized: string): FileIntent {
  const intent = withoutUrls(normalized);
  const fileNoun =
    "(?:dosya\\w*|file(?:s)?|folder(?:s)?|klasor\\w*|director(?:y|ies)|dizin\\w*|markdown)";
  const readAction = "(?:oku\\w*|read|listele\\w*|list|incele\\w*|inspect)";
  const writeAction =
    "(?:yaz\\w*|write|olustur\\w*|create|duzenle\\w*|edit|kaydet\\w*|save)";
  const near = (left: string, right: string) =>
    new RegExp(`\\b${left}\\b.{0,48}\\b${right}\\b`, "u").test(intent);
  const reads = near(readAction, fileNoun) || near(fileNoun, readAction);
  const writes = near(writeAction, fileNoun) || near(fileNoun, writeAction);
  return { mentioned: reads || writes, allowWrite: writes };
}

function hasExplicitBrowserFileTransition(normalized: string): boolean {
  const intent = withoutUrls(normalized).replace(
    /(?:`[^`]*`|"[^"]*"|'[^']*')/gu,
    " ",
  );
  const connector = "(?:ve|sonra|ardindan|and|then)";
  const output =
    "(?:sonuc\\w*|cikti\\w*|icerik|metin|ekran goruntusu|result|output|content|screenshot)";
  const fileTarget = "(?:dosya\\w*|file|markdown)";
  const action = "(?:yaz\\w*|kaydet\\w*|write|save|read|oku\\w*)";
  const explicitLocal = "(?:local|workspace|agent workspace|calisma alani\\w*)";
  return (
    new RegExp(
      `\\b${connector}\\b.{0,160}(?:\\b${output}\\b.{0,80}\\b${fileTarget}\\b.{0,48}\\b${action}\\b|\\b${action}\\b.{0,80}\\b${output}\\b.{0,80}\\b${fileTarget}\\b|\\b${output}\\b.{0,80}\\b${explicitLocal}\\b.{0,48}\\b${fileTarget}\\b.{0,48}\\b${action}\\b)`,
      "u",
    ).test(intent) ||
    new RegExp(
      `\\b${connector}\\b.{0,160}\\b${explicitLocal}\\b.{0,48}\\b${fileTarget}\\b.{0,48}\\b${action}\\b`,
      "u",
    ).test(intent)
  );
}

function cleanCommandCandidate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let candidate = value.trim();
  const pairs: Array<[string, string]> = [
    ["`", "`"],
    ['"', '"'],
    ["“", "”"],
  ];
  for (const [open, close] of pairs) {
    if (candidate.startsWith(open) && candidate.endsWith(close)) {
      candidate = candidate.slice(open.length, -close.length).trim();
      break;
    }
  }
  if (
    candidate.length === 0 ||
    candidate.length > 1_000 ||
    /[\r\n\u0000]/u.test(candidate) ||
    /\b(?:sadece|yalniz|yalnizca|only|nothing else)\b/u.test(
      normalize(candidate),
    )
  ) {
    return undefined;
  }
  return candidate;
}

function extractExactSudoCommand(original: string): string | undefined {
  // Bind only text in an explicit execute/command relation. Never authorize
  // an arbitrary quoted span elsewhere in the request. Match the original
  // string so case-sensitive paths and arguments remain byte-for-byte intact.
  const turkish = original.match(
    /\b(?:sadece|yalnız|yalniz|yalnızca|yalnizca)\s+(.{1,1000}?)\s+komut(?:u|unu)?\b/iu,
  )?.[1];
  const fromTurkish = cleanCommandCandidate(turkish);
  if (fromTurkish) return fromTurkish;

  const english = original.match(
    /\b(?:only\s+(?:run|execute)|(?:run|execute)\s+only)\s+(?:the\s+)?(.{1,1000}?)(?:\s+command)?(?=\s+(?:and|for|to)\b|[.,;]|$)/iu,
  )?.[1];
  return cleanCommandCandidate(english);
}

/**
 * Converts an explicit user-authored "only / sadece" constraint into a
 * narrow, server-enforced tool allowlist. Ambiguous or ordinary requests do
 * not produce a policy: false positives would unnecessarily disable useful
 * multi-tool work.
 */
export function deriveExclusiveTurnPolicy(
  userContent: string,
): ExclusiveTurnPolicy | null {
  const normalized = normalize(userContent);
  if (!hasExplicitExclusivity(normalized)) return null;

  const families: ExclusiveToolFamily[] = [];
  const browser =
    mentionsBrowser(normalized) &&
    !explicitlyDeniesFamily(normalized, "browser");
  const sudoMentioned = mentionsSudo(normalized);
  const extractedSudoCommand = sudoMentioned
    ? extractExactSudoCommand(userContent)
    : undefined;
  const sudo =
    sudoMentioned &&
    (!explicitlyDeniesFamily(normalized, "sudo_approval") ||
      Boolean(extractedSudoCommand));
  const requestedFileIntent = fileIntent(normalized);
  const exactSudoCommand = sudo ? extractedSudoCommand : undefined;

  if (browser) families.push("browser");
  if (sudo) {
    families.push("sudo_approval");
  } else if (
    mentionsTerminal(normalized, browser) &&
    !explicitlyDeniesFamily(normalized, "terminal")
  ) {
    families.push("terminal");
  }
  if (
    requestedFileIntent.mentioned &&
    !explicitlyDeniesFamily(normalized, "files") &&
    (!browser || hasExplicitBrowserFileTransition(normalized))
  ) {
    families.push("files");
  }

  const allowed = new Set<string>();
  for (const family of families) {
    if (family === "browser") {
      BROWSER_TOOLS.forEach((tool) => allowed.add(tool));
      // A state-changing browser action still needs the existing scoped
      // approval gate. The argument validator below only permits an approval
      // whose target is an allowed browser tool.
      allowed.add("request_approval");
    } else if (family === "terminal") {
      TERMINAL_TOOLS.forEach((tool) => allowed.add(tool));
    } else if (family === "files") {
      allowed.add("vm_list_files");
      allowed.add("vm_read_file");
      if (requestedFileIntent.allowWrite) allowed.add("vm_write_file");
    } else if (exactSudoCommand) {
      // Without an unambiguous exact command, fail closed and expose no sudo
      // capability. The agent can only explain that the scope is insufficient.
      allowed.add("vm_run_sudo_command");
      allowed.add("request_approval");
    }
  }

  return {
    source: "explicit_user_exclusivity",
    families,
    allowedTools: [...allowed],
    ...(exactSudoCommand ? { exactSudoCommand } : {}),
  };
}

function parseArgs(
  rawArgs: string | Record<string, unknown>,
): Record<string, unknown> | null {
  if (typeof rawArgs !== "string") return rawArgs;
  try {
    const parsed = JSON.parse(rawArgs || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function describeExclusiveTurnPolicy(
  policy: ExclusiveTurnPolicy,
): string {
  return policy.families.length > 0
    ? policy.families.map((family) => FAMILY_LABELS[family]).join(" + ")
    : "hiçbir araç";
}

export function evaluateExclusiveToolCall(
  policy: ExclusiveTurnPolicy,
  toolName: string,
  rawArgs: string | Record<string, unknown>,
): ExclusiveToolDecision {
  const scope = describeExclusiveTurnPolicy(policy);
  if (!policy.allowedTools.includes(toolName)) {
    return {
      allowed: false,
      reason: "tool_not_allowed",
      explanation: `Kullanıcının açık sadece/only sınırı bu turu ${scope} araçlarıyla kısıtlıyor; ${toolName} kapsam dışında.`,
    };
  }

  const args = parseArgs(rawArgs);
  if (!args) {
    return {
      allowed: false,
      reason: "invalid_arguments",
      explanation: `${toolName} argümanları doğrulanamadığı için dar kapsam kapısı fail-closed engelledi.`,
    };
  }

  if (toolName === "vm_run_sudo_command" && policy.exactSudoCommand) {
    if (String(args.command ?? "").trim() !== policy.exactSudoCommand) {
      return {
        allowed: false,
        reason: "sudo_command_mismatch",
        explanation:
          "CEO Host Shell komutu kullanıcının bu tur için belirttiği tam komutla eşleşmiyor.",
      };
    }
  }

  if (toolName === "request_approval") {
    const requestedTool = String(args.toolName ?? "");
    const requestedArgs =
      args.toolArgs &&
      typeof args.toolArgs === "object" &&
      !Array.isArray(args.toolArgs)
        ? (args.toolArgs as Record<string, unknown>)
        : null;
    const targetsBrowser =
      policy.families.includes("browser") &&
      Boolean(requestedArgs) &&
      (requestedTool === "browser_click" || requestedTool === "browser_type");
    const targetsSudo =
      policy.families.includes("sudo_approval") &&
      Boolean(policy.exactSudoCommand) &&
      requestedTool === "vm_run_sudo_command";

    if (!targetsBrowser && !targetsSudo) {
      return {
        allowed: false,
        reason: "approval_target_not_allowed",
        explanation:
          "Onay talebi yalnızca bu turda izin verilen tarayıcı veya CEO Host Shell eylemini hedefleyebilir.",
      };
    }
    if (
      targetsSudo &&
      policy.exactSudoCommand &&
      String(requestedArgs?.command ?? "").trim() !== policy.exactSudoCommand
    ) {
      return {
        allowed: false,
        explanation:
          "Sudo onayı kullanıcının belirttiği tam komuta bağlı değil; kapsam genişletilemez.",
        reason: "approval_command_mismatch",
      };
    }
  }

  return {
    allowed: true,
    explanation: `${toolName}, bu turun ${scope} kapsamı içinde.`,
  };
}

export function filterToolsForExclusiveTurn(
  tools: ToolDef[],
  policy: ExclusiveTurnPolicy | null,
): ToolDef[] {
  if (!policy) return tools;
  return tools.filter((tool) =>
    policy.allowedTools.includes(tool.function.name),
  );
}

export function exclusiveTurnSystemPrompt(
  policy: ExclusiveTurnPolicy,
  locale: WorkspaceLocale = "tr",
): string {
  const copy = getToolCopy(locale);
  const scope = toolMessage(locale, "exclusiveTurnInstruction", {
    tools: policy.allowedTools.join(", ") || "∅",
  });
  const sudoScope = policy.families.includes("sudo_approval")
    ? policy.exactSudoCommand
      ? copy.exclusiveSudoExactInstruction
      : copy.exclusiveSudoUnavailableInstruction
    : "";
  return `<turn_scope enforcement="server" mode="exclusive">
${scope}${sudoScope ? ` ${sudoScope}` : ""}
</turn_scope>`;
}

export function exclusiveToolBlockedMessage(
  policy: ExclusiveTurnPolicy,
  toolName: string,
  explanation: string,
  locale?: WorkspaceLocale,
  reason?: ExclusiveToolDecision["reason"],
): string {
  if (locale) {
    if (reason === "invalid_arguments")
      return terminalMessage(locale, "invalidToolObject");
    if (reason === "sudo_command_mismatch")
      return terminalMessage(locale, "exclusiveSudoMismatch");
    return terminalMessage(locale, "exclusiveTools", {
      toolName,
      tools: policy.allowedTools.join(", "),
    });
  }
  return [
    `ENGELLENDI: ${toolName} kullanıcının bu turdaki açık sadece/only sınırının dışında.`,
    explanation,
    `Yalnızca ${describeExclusiveTurnPolicy(policy)} kapsamındaki bir sonraki adımı seç veya kapsam yetersizse durup kullanıcıya bildir.`,
  ].join(" ");
}
