import { isWorkspaceLocale, type WorkspaceLocale } from "../workspace-locale";
import {
  terminalTr,
  type TerminalCopy,
  type TerminalMessageKey,
} from "./terminal-copy";
import { terminalEn } from "./terminal-locales/en";
import { terminalDe } from "./terminal-locales/de";
import { terminalRu } from "./terminal-locales/ru";
import { terminalZhCN } from "./terminal-locales/zh-CN";
import { terminalZhTW } from "./terminal-locales/zh-TW";
import { terminalAr } from "./terminal-locales/ar";

const catalogs: Record<WorkspaceLocale, TerminalCopy> = {
  tr: terminalTr,
  en: terminalEn,
  de: terminalDe,
  ru: terminalRu,
  "zh-CN": terminalZhCN,
  "zh-TW": terminalZhTW,
  ar: terminalAr,
};

export function getTerminalCopy(
  locale: WorkspaceLocale,
): Readonly<TerminalCopy> {
  if (!isWorkspaceLocale(locale)) throw new Error("Invalid Terminal locale");
  return Object.freeze(catalogs[locale]);
}

export function terminalMessage(
  locale: WorkspaceLocale,
  key: TerminalMessageKey,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const copy = getTerminalCopy(locale);
  if (!Object.hasOwn(copy, key))
    throw new Error("Invalid Terminal message key");
  // Replace only the authored template in one pass. A path/command containing
  // braces or replacement-pattern characters stays literal source content.
  return copy[key].replace(
    /\{([A-Za-z][A-Za-z0-9]*)\}/g,
    (_match, name: string) => {
      if (!Object.hasOwn(params, name))
        throw new Error(`Missing Terminal parameter: ${name}`);
      return String(params[name]);
    },
  );
}
