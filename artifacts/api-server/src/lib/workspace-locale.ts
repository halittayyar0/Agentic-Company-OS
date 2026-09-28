import { readBoundedRegularFile } from "./read-bounded-file";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const WORKSPACE_LOCALES = [
  "tr",
  "en",
  "de",
  "ru",
  "zh-CN",
  "zh-TW",
  "ar",
] as const;

export type WorkspaceLocale = (typeof WORKSPACE_LOCALES)[number];

export const WORKSPACE_LANGUAGE_NAMES: Record<WorkspaceLocale, string> = {
  tr: "Turkish",
  en: "English",
  de: "German",
  ru: "Russian",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  ar: "Arabic",
};

export function isWorkspaceLocale(value: unknown): value is WorkspaceLocale {
  return WORKSPACE_LOCALES.some((locale) => locale === value);
}

export function workspaceLanguageContract(locale: WorkspaceLocale): string {
  return `<workspace_language locale="${locale}">
The operator selected ${WORKSPACE_LANGUAGE_NAMES[locale]} as the workspace language. Write user-facing replies, task summaries, meeting messages and deliverable prose in this language by default. If the operator explicitly requests another language for a particular response or deliverable, follow that request. Preserve code, commands, identifiers, quoted source material and proper names as needed. A language preference never changes safety, approval or evidence rules.
</workspace_language>`;
}

function workspaceRoot(): string {
  let directory = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(directory, "pnpm-workspace.yaml")))
      return directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return process.cwd();
}

const defaultPath = () =>
  path.join(workspaceRoot(), "data", "workspace-locale.json");

export async function readWorkspaceLocale(
  filePath = defaultPath(),
): Promise<WorkspaceLocale> {
  try {
    const parsed: unknown = JSON.parse(
      await readBoundedRegularFile(filePath, 1024),
    );
    const value = (parsed as { locale?: unknown } | null)?.locale;
    if (!isWorkspaceLocale(value))
      throw new Error("Workspace locale is invalid");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "tr";
    throw error;
  }
}

let writeQueue: Promise<void> = Promise.resolve();

export async function writeWorkspaceLocale(
  locale: WorkspaceLocale,
  filePath = defaultPath(),
): Promise<void> {
  if (!isWorkspaceLocale(locale))
    throw new Error("Workspace locale is invalid");
  const previous = writeQueue;
  let finish: (() => void) | undefined;
  writeQueue = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await previous;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ locale }), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await fs.rename(temporary, filePath);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    if (process.platform !== "win32") await fs.chmod(filePath, 0o600);
  } finally {
    finish?.();
  }
}
