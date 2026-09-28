import type { Locale } from "./i18n";
export type ComputerCopy = {
  title: string;
  agentLabel: string;
  scope: string;
  projectScope: string;
  source: string;
  activity: string;
  activityHelp: string;
  projectActivityHelp: string;
  activityEmpty: string;
  activityError: string;
  activityStale: string;
  refresh: string;
  loading: string;
  ready: string;
  notCreated: string;
  statusError: string;
  bytes: string;
  files: string;
  folders: string;
  browser: string;
  terminal: string;
  surfaces: string;
  follow: string;
  followHelp: string;
  permissionOff: string;
  terminalHelp: string;
  hostHelp: string;
  host: string;
  workspace: string;
  command: string;
  commandRequired: string;
  run: string;
  keyboard: string;
  tooLong: string;
  disabled: string;
  blocked: string;
  cwdLoading: string;
  cwdError: string;
  folder: string;
  running: string;
  unconfirmed: string;
  unconfirmedHelp: string;
  reviewCheck: string;
  reviewDone: string;
  storageError: string;
  storageRetry: string;
  damaged: string;
  localOnly: string;
  result: string;
  output: string;
  emptyOutput: string;
  copy: string;
  copied: string;
  copyError: string;
  clearOutput: string;
  reuse: string;
  exit: string;
  duration: string;
  latest: string;
  historyHelp: string;
};
const loaders = {
  en: () => import("./computer-copy/computer-en"),
  tr: () => import("./computer-copy/computer-tr"),
  de: () => import("./computer-copy/computer-de"),
  ru: () => import("./computer-copy/computer-ru"),
  "zh-CN": () => import("./computer-copy/computer-zh-CN"),
  "zh-TW": () => import("./computer-copy/computer-zh-TW"),
  ar: () => import("./computer-copy/computer-ar"),
};
export async function loadComputerCopy(locale: Locale): Promise<ComputerCopy> {
  return (await loaders[locale]()).default;
}
