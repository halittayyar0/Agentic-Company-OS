import type { Locale } from "./i18n";
export interface CompletionRequirementsCopy {
  title: string;
  optional: string;
  help: string;
  limit: string;
  loading: string;
  loadError: string;
  retry: string;
  empty: string;
  search: string;
  selected: string;
  remove: string;
  unavailable: string;
  unavailableActive: string;
  satisfied: string;
  missing: string;
  cycle: string;
  observed: string;
  sourceHelp: string;
  permissionHelp: string;
  other: string;
  labels: Record<string, string>;
}
const loaders = {
  en: () => import("./completion-requirements-copy/requirements-en"),
  tr: () => import("./completion-requirements-copy/requirements-tr"),
  de: () => import("./completion-requirements-copy/requirements-de"),
  ru: () => import("./completion-requirements-copy/requirements-ru"),
  "zh-CN": () => import("./completion-requirements-copy/requirements-zh-CN"),
  "zh-TW": () => import("./completion-requirements-copy/requirements-zh-TW"),
  ar: () => import("./completion-requirements-copy/requirements-ar"),
} satisfies Record<
  Locale,
  () => Promise<{ default: CompletionRequirementsCopy }>
>;
export async function loadCompletionRequirementsCopy(
  locale: Locale,
): Promise<CompletionRequirementsCopy> {
  return (await loaders[locale]()).default;
}
