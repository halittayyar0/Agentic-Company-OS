import type { Locale } from "./i18n";
export type MeetingTurnCopy = {
  outcomeHelp: string;
  recordedFailure: string;
  skipped: string;
  skip_busy: string;
  skip_unavailable: string;
  skip_empty_response: string;
  skip_model_error: string;
  skip_provider_unavailable: string;
  skip_budget_guard: string;
  title: string;
  help: string;
  prompt: string;
  pending: string;
  check: string;
  checking: string;
  running: string;
  notRecorded: string;
  retry: string;
  recorded: string;
  unconfirmed: string;
  review: string;
  reviewHelp: string;
  continue: string;
  cancel: string;
  storage: string;
  invalid: string;
  loadError: string;
  recordId: string;
  requestFailed: string;
  inboxTitle: string;
  inboxHelp: string;
  meetingId: string;
  participants: string;
  defaultParticipants: string;
  noParticipants: string;
  tokenLimit: string;
  defaultLimit: string;
  damagedTitle: string;
  reviewDamaged: string;
  damagedHelp: string;
  clearDamaged: string;
  clearHelp: string;
  localKey: string;
  storageReadError: string;
  refreshInbox: string;
  changed: string;
  previous: string;
  next: string;
  scanMore: string;
  scanIncomplete: string;
  pageSummary: string;
};
const loaders = {
  en: () => import("./meeting-turn-copy/meeting-turn-en"),
  tr: () => import("./meeting-turn-copy/meeting-turn-tr"),
  de: () => import("./meeting-turn-copy/meeting-turn-de"),
  ru: () => import("./meeting-turn-copy/meeting-turn-ru"),
  "zh-CN": () => import("./meeting-turn-copy/meeting-turn-zh-CN"),
  "zh-TW": () => import("./meeting-turn-copy/meeting-turn-zh-TW"),
  ar: () => import("./meeting-turn-copy/meeting-turn-ar"),
};
export async function loadMeetingTurnCopy(
  locale: Locale,
): Promise<MeetingTurnCopy> {
  return (await loaders[locale]()).default;
}
