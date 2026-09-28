import type { Locale } from "./i18n";
export type WorkforceCopy = {
  storageError: string;
  eyebrow: string;
  title: string;
  description: string;
  library: string;
  roles: string;
  crew: string;
  flow: string;
  recommended: string;
  triggers: string;
  structure: string;
  handoffs: string;
  noHandoffs: string;
  manager: string;
  expert: string;
  reportsTo: string;
  selectedManager: string;
  ai: string;
  next: string;
  review: string;
  configure: string;
  setup: string;
  managerHelp: string;
  noManagers: string;
  outcome: string;
  outcomePlaceholder: string;
  outcomeHelp: string;
  outcomeInvalid: string;
  finite: string;
  continuous: string;
  cadence: string;
  hour: string;
  fourHours: string;
  day: string;
  week: string;
  scope: string;
  approval: string;
  atomic: string;
  install: string;
  installStart: string;
  installing: string;
  installed: string;
  receipt: string;
  openTask: string;
  another: string;
  retry: string;
  loading: string;
  loadError: string;
  empty: string;
  stale: string;
  safetyUnknown: string;
  stopped: string;
  unknown: string;
  recover: string;
  rejected: string;
  versionChanged: string;
  managerChanged: string;
  capacity: string;
};
const loaders = {
  en: () => import("./workforce-copy/workforce-en"),
  tr: () => import("./workforce-copy/workforce-tr"),
  de: () => import("./workforce-copy/workforce-de"),
  ru: () => import("./workforce-copy/workforce-ru"),
  "zh-CN": () => import("./workforce-copy/workforce-zh-CN"),
  "zh-TW": () => import("./workforce-copy/workforce-zh-TW"),
  ar: () => import("./workforce-copy/workforce-ar"),
};
export async function loadWorkforceCopy(
  locale: Locale,
): Promise<WorkforceCopy> {
  return (await loaders[locale]()).default;
}
