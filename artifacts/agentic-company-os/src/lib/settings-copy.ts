import type { Locale } from "./i18n";
export type SettingsCopy = {
  title: string;
  description: string;
  preferences: string;
  appearance: string;
  light: string;
  dark: string;
  system: string;
  appearanceHelp: string;
  providers: string;
  credentialHelp: string;
  key: string;
  sourceRuntime: string;
  sourceEnvironment: string;
  sourceNone: string;
  save: string;
  remove: string;
  removeHelp: string;
  storedLocal: string;
  storedDatabase: string;
  serverManaged: string;
  serverHelp: string;
  unavailable: string;
  test: string;
  testHelp: string;
  confirmTest: string;
  cancel: string;
  saved: string;
  changed: string;
  unconfirmed: string;
  refresh: string;
  busy: string;
  draftHelp: string;
  loading: string;
  loadError: string;
  stale: string;
  rateLimited: string;
  testFailed: string;
  testPassed: string;
  testHistorical: string;
  testBlocked: string;
  revision: string;
  selectedModel: string;
  catalog: string;
  catalogHelp: string;
  search: string;
  tools: string;
  chatOnly: string;
  economy: string;
  standard: string;
  premium: string;
  reasoning: string;
  freeIdentifier: string;
  defaultModel: string;
  more: string;
  empty: string;
  source: string;
  runtime: string;
  browserHelp: string;
  hostHelp: string;
  hostSettings: string;
  clear: string;
  removeTitle: string;
  notTested: string;
  elapsed: string;
  currentChanged: string;
  noDescription: string;
};
const loaders = {
  en: () => import("./settings-copy/settings-en"),
  tr: () => import("./settings-copy/settings-tr"),
  de: () => import("./settings-copy/settings-de"),
  ru: () => import("./settings-copy/settings-ru"),
  "zh-CN": () => import("./settings-copy/settings-zh-CN"),
  "zh-TW": () => import("./settings-copy/settings-zh-TW"),
  ar: () => import("./settings-copy/settings-ar"),
};
export async function loadSettingsCopy(locale: Locale): Promise<SettingsCopy> {
  return (await loaders[locale]()).default;
}
