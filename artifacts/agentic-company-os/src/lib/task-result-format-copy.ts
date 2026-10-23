import type { Locale } from "./i18n";
export interface ResultFormatCopy {
  title: string;
  plain: string;
  table: string;
  help: string;
  columns: string;
  add: string;
  remove: string;
  invalid: string;
  saved: string;
  defaults: string[];
}
const loaders = {
  en: () => import("./task-result-format-copy/result-format-en"),
  tr: () => import("./task-result-format-copy/result-format-tr"),
  de: () => import("./task-result-format-copy/result-format-de"),
  ru: () => import("./task-result-format-copy/result-format-ru"),
  "zh-CN": () => import("./task-result-format-copy/result-format-zh-CN"),
  "zh-TW": () => import("./task-result-format-copy/result-format-zh-TW"),
  ar: () => import("./task-result-format-copy/result-format-ar"),
} satisfies Record<Locale, () => Promise<{ default: ResultFormatCopy }>>;
export async function loadResultFormatCopy(
  locale: Locale,
): Promise<ResultFormatCopy> {
  return (await loaders[locale]()).default;
}
