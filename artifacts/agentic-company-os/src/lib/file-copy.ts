import type { Locale } from "./i18n";
export type FileCopy = {
  filesTitle: string;
  filesHelp: string;
  root: string;
  openFile: string;
  openFolder: string;
  newFile: string;
  refreshFiles: string;
  loadingFiles: string;
  listError: string;
  listStale: string;
  partialList: string;
  emptyList: string;
  entriesLabel: string;
  pathLabel: string;
  pathHelp: string;
  pathInvalid: string;
  create: string;
  fileCreated: string;
  contentLabel: string;
  save: string;
  close: string;
  readError: string;
  reading: string;
  readonly: string;
  contentInvalid: string;
  snapshotHint: string;
  saved: string;
  draftsTitle: string;
  resumeDraft: string;
  discardDraft: string;
  discardTitle: string;
  discardBody: string;
  discardConfirm: string;
  reviewTitle: string;
  reviewHelp: string;
  compare: string;
  comparisonLabel: string;
  comparisonError: string;
  reviewCheck: string;
  reviewDone: string;
  writeUnknown: string;
  writeUnknownHelp: string;
  writePending: string;
  reviewRequest: string;
  missingFile: string;
  fileStorageError: string;
  fileDamaged: string;
  fileResetCheck: string;
  fileReset: string;
  fileLocalOnly: string;
  fileBlocked: string;
  title: string;
  remove: string;
  help: string;
  inspect: string;
  inspecting: string;
  scope: string;
  count: string;
  bytes: string;
  file: string;
  folder: string;
  confirm: string;
  submit: string;
  pending: string;
  cancel: string;
  success: string;
  unknown: string;
  unknownHelp: string;
  missing: string;
  error: string;
  limited: string;
  changed: string;
  storageError: string;
  damaged: string;
  clearConfirm: string;
  clear: string;
  recover: string;
  localOnly: string;
  storageRetry: string;
  blocked: string;
  required: string;
};
const loaders = {
  en: () => import("./file-copy/files-en"),
  tr: () => import("./file-copy/files-tr"),
  de: () => import("./file-copy/files-de"),
  ru: () => import("./file-copy/files-ru"),
  "zh-CN": () => import("./file-copy/files-zh-CN"),
  "zh-TW": () => import("./file-copy/files-zh-TW"),
  ar: () => import("./file-copy/files-ar"),
};
export async function loadFileCopy(locale: Locale): Promise<FileCopy> {
  return (await loaders[locale]()).default;
}
