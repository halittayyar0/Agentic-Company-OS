import type { Locale } from "./i18n";
export type ApprovalCopy = {
  emptyPage: string;
  closedPreview: string;
  eyebrow: string;
  title: string;
  description: string;
  pending: string;
  approved: string;
  rejected: string;
  spend: string;
  delete: string;
  publish: string;
  external_contact: string;
  other: string;
  shown: string;
  newer: string;
  older: string;
  retry: string;
  loading: string;
  loadError: string;
  stale: string;
  emptyPending: string;
  emptyPendingHelp: string;
  emptyApproved: string;
  emptyApprovedHelp: string;
  emptyRejected: string;
  emptyRejectedHelp: string;
  requester: string;
  unknownRequester: string;
  task: string;
  note: string;
  notePlaceholder: string;
  approve: string;
  reject: string;
  saving: string;
  approvedSaved: string;
  rejectedSaved: string;
  approvedHelp: string;
  rejectedHelp: string;
  safetyStopped: string;
  safetyUnknown: string;
  scope: string;
  tool: string;
  target: string;
  hash: string;
  preview: string;
  expires: string;
  consumed: string;
  consumedHelp: string;
  expired: string;
  noExpiry: string;
  unscoped: string;
  source: string;
  missingScope: string;
  hostTitle: string;
  hostCategory: string;
  hostWarning: string;
  hostDetails: string;
  hostConfirm: string;
  confirmInstruction: string;
  confirmInput: string;
  confirmSubmit: string;
  cancel: string;
  unknownError: string;
  changedError: string;
  expiredError: string;
  confirmationError: string;
  inputError: string;
};
const loaders = {
  en: () => import("./approval-copy/approval-en"),
  tr: () => import("./approval-copy/approval-tr"),
  de: () => import("./approval-copy/approval-de"),
  ru: () => import("./approval-copy/approval-ru"),
  "zh-CN": () => import("./approval-copy/approval-zh-CN"),
  "zh-TW": () => import("./approval-copy/approval-zh-TW"),
  ar: () => import("./approval-copy/approval-ar"),
};
export async function loadApprovalCopy(locale: Locale): Promise<ApprovalCopy> {
  return (await loaders[locale]()).default;
}
