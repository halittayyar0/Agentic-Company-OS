import type { Locale } from "./i18n";
export type CompanyRoomCopy = {
  title: string;
  eyebrow: string;
  description: string;
  members: string;
  memberRegion: string;
  activeMembers: string;
  rosterHelp: string;
  openChat: string;
  join: string;
  leave: string;
  inactive: string;
  memberAdded: string;
  memberRemoved: string;
  memberError: string;
  rosterError: string;
  rosterStale: string;
  noAgents: string;
  noMembers: string;
  loadingMembers: string;
  loadingMessages: string;
  messagesError: string;
  messagesStale: string;
  empty: string;
  emptyHelp: string;
  firstMessage: string;
  retry: string;
  older: string;
  newMessages: string;
  loadedMessages: string;
  founder: string;
  agent: string;
  roomReply: string;
  projectNote: string;
  operatorMessage: string;
  project: string;
  source: string;
  skipped: string;
  busy: string;
  unavailable: string;
  empty_response: string;
  model_error: string;
  not_relevant: string;
  not_mentioned: string;
  budget_guard: string;
  close: string;
  compose: string;
  placeholder: string;
  send: string;
  sending: string;
  mentionMembers: string;
  removeMention: string;
  noMatches: string;
  mentionedHelp: string;
  ambientHelp: string;
  invalidMention: string;
  stored: string;
  storedHelp: string;
  unconfirmed: string;
  unknown: string;
  recover: string;
  storageError: string;
  conflict: string;
  invalid: string;
  capacity: string;
  stopped: string;
  safetyUnknown: string;
  pendingHelp: string;
  newSend: string;
};
const loaders = {
  en: () => import("./company-room-copy/room-en"),
  tr: () => import("./company-room-copy/room-tr"),
  de: () => import("./company-room-copy/room-de"),
  ru: () => import("./company-room-copy/room-ru"),
  "zh-CN": () => import("./company-room-copy/room-zh-CN"),
  "zh-TW": () => import("./company-room-copy/room-zh-TW"),
  ar: () => import("./company-room-copy/room-ar"),
};
export async function loadCompanyRoomCopy(
  locale: Locale,
): Promise<CompanyRoomCopy> {
  return (await loaders[locale]()).default;
}
