import type { Locale } from "./i18n";
export type ConnectionCopy = {
  apiProviders: string;
  signedOut: string;
  signInAgain: string;
  clearAttempt: string;
  description: string;
  local: string;
  localHint: string;
  chatgptHint: string;
  api: string;
  apiHint: string;
  back: string;
  endpoint: string;
  endpointHint: string;
  save: string;
  restore: string;
  restoreHint: string;
  key: string;
  keyHint: string;
  saved: string;
  unconfirmed: string;
  invalid: string;
  changed: string;
  discovered: string;
  none: string;
  tools: string;
  chatOnly: string;
  advanced: string;
  done: string;
  accounts: string;
  noAccounts: string;
  selected: string;
  select: string;
  identityOnly: string;
  planReady: string;
  paused: string;
  signIn: string;
  sameComputer: string;
  officialLink: string;
  pending: string;
  review: string;
  confirm: string;
  cancel: string;
  connected: string;
  ended: string;
  handoffTitle: string;
  handoffText: string;
  handoffGuide: string;
  enablePlan: string;
  refresh: string;
  unknown: string;
};
const loaders = {
  en: () => import("./connection-copy/connection-en"),
  tr: () => import("./connection-copy/connection-tr"),
  de: () => import("./connection-copy/connection-de"),
  ru: () => import("./connection-copy/connection-ru"),
  "zh-CN": () => import("./connection-copy/connection-zh-CN"),
  "zh-TW": () => import("./connection-copy/connection-zh-TW"),
  ar: () => import("./connection-copy/connection-ar"),
} satisfies Record<Locale, () => Promise<{ default: ConnectionCopy }>>;
export async function loadConnectionCopy(
  locale: Locale,
): Promise<ConnectionCopy> {
  return (await loaders[locale]()).default;
}
