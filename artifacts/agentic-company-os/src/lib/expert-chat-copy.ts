import type { Locale } from "./i18n";
export type ExpertChatCopy = {
  projectTitle: string;
  projectHelp: string;
  projectPrompt: string;
  projectUnavailable: string;
  required: string;
  title: string;
  help: string;
  history: string;
  empty: string;
  emptyHelp: string;
  loading: string;
  historyError: string;
  historyStale: string;
  refresh: string;
  older: string;
  olderError: string;
  windowLimit: string;
  latest: string;
  newMessages: string;
  you: string;
  system: string;
  model: string;
  copy: string;
  copied: string;
  copyError: string;
  unsafeLink: string;
  mode: string;
  ask: string;
  delegate: string;
  continuous: string;
  askHelp: string;
  delegateHelp: string;
  continuousHelp: string;
  instruction: string;
  placeholder: string;
  send: string;
  keyboard: string;
  tooLong: string;
  blocked: string;
  unavailable: string;
  draftLocal: string;
  storageError: string;
  sending: string;
  unconfirmed: string;
  unconfirmedHelp: string;
  check: string;
  checking: string;
  missing: string;
  recover: string;
  recoverHelp: string;
  readError: string;
  rejected: string;
  configChanged: string;
  busy: string;
  capacity: string;
  invalid: string;
  conflict: string;
  receipt: string;
  done: string;
  queued: string;
  systemResult: string;
  project: string;
  operations: string;
  continue: string;
  review: string;
  reviewHelp: string;
  acknowledge: string;
  cancel: string;
  activity: string;
  activityHelp: string;
  activityEmpty: string;
  activityError: string;
  source: string;
  prompt: string;
};
const loaders = {
  tr: () => import("./expert-chat-copy/chat-tr"),
  en: () => import("./expert-chat-copy/chat-en"),
  de: () => import("./expert-chat-copy/chat-de"),
  ru: () => import("./expert-chat-copy/chat-ru"),
  "zh-CN": () => import("./expert-chat-copy/chat-zh-CN"),
  "zh-TW": () => import("./expert-chat-copy/chat-zh-TW"),
  ar: () => import("./expert-chat-copy/chat-ar"),
};
export async function loadExpertChatCopy(
  locale: Locale,
): Promise<ExpertChatCopy> {
  return (await loaders[locale]()).default;
}
