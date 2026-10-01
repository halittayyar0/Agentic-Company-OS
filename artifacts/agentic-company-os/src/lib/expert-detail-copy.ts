import type { Locale } from "./i18n";
import type { KeeperCompanionCopy } from "./keeper-copy";
export type ExpertDetailCopy = {
  keeper: KeeperCompanionCopy;
  invalid: string;
  missing: string;
  loadError: string;
  loadHelp: string;
  loading: string;
  refresh: string;
  stale: string;
  created: string;
  lastSeen: string;
  noSignal: string;
  noStep: string;
  nextModel: string;
  changeModel: string;
  modelHelp: string;
  save: string;
  saving: string;
  saved: string;
  unknown: string;
  changed: string;
  busyError: string;
  capacity: string;
  denied: string;
  review: string;
  discard: string;
  source: string;
  promptHelp: string;
  managedPrompt: string;
  promptRequired: string;
  promptChanged: string;
  permissionsHelp: string;
  enabled: string;
  disabled: string;
  hostShell: string;
  hostHelp: string;
  archive: string;
  archiveTitle: string;
  archiveHelp: string;
  restore: string;
  restoreHelp: string;
  cancel: string;
  active: string;
  archived: string;
  chat: string;
  computer: string;
  tasks: string;
  stats: string;
  settings: string;
  taskLoading: string;
  taskError: string;
  taskEmpty: string;
  taskWindow: string;
  progress: string;
  low: string;
  normal: string;
  high: string;
  urgent: string;
  statsWindow: string;
  statsError: string;
  replies: string;
  toolEvents: string;
  createdTasks: string;
  delegations: string;
  reviews: string;
  approvalRequests: string;
  modelUsage: string;
  modelUsageHelp: string;
  noModels: string;
  recentTools: string;
  noTools: string;
  oldest: string;
  records: string;
  avatar: string;
  avatarBuiltin: string;
  avatarCustom: string;
  avatarHelp: string;
  chooseImage: string;
  processing: string;
  preview: string;
  resetAvatar: string;
  saveAvatar: string;
  avatarFileError: string;
  avatarPrepareError: string;
  avatarChanged: string;
  configuration: string;
  configHelp: string;
  serverPrompt: string;
  busyArchive: string;
  readonly: string;
  actionTitle: string;
  taskMore: string;
};
const loaders = {
  en: () => import("./expert-detail-copy/expert-detail-en"),
  tr: () => import("./expert-detail-copy/expert-detail-tr"),
  de: () => import("./expert-detail-copy/expert-detail-de"),
  ru: () => import("./expert-detail-copy/expert-detail-ru"),
  "zh-CN": () => import("./expert-detail-copy/expert-detail-zh-CN"),
  "zh-TW": () => import("./expert-detail-copy/expert-detail-zh-TW"),
  ar: () => import("./expert-detail-copy/expert-detail-ar"),
};
export async function loadExpertDetailCopy(
  locale: Locale,
): Promise<ExpertDetailCopy> {
  return (await loaders[locale]()).default;
}
