import type { Locale } from "./i18n";
export interface TaskResultReviewCopy {
  title: string;
  help: string;
  loading: string;
  unavailable: string;
  auth: string;
  refresh: string;
  acknowledge: string;
  confirm: string;
  reject: string;
  confirmed: string;
  rejected: string;
  error: string;
  safety: string;
  digest: string;
  cycle: string;
  expires: string;
  requirements: string;
  satisfied: string;
  source_mismatch: string;
  missing_required_action: string;
  unauthorized_action: string;
  insufficient_evidence: string;
  provenance: string;
  provenanceHelp: string;
}
const loaders = {
  en: () => import("./task-result-review-copy/result-review-en"),
  tr: () => import("./task-result-review-copy/result-review-tr"),
  de: () => import("./task-result-review-copy/result-review-de"),
  ru: () => import("./task-result-review-copy/result-review-ru"),
  "zh-CN": () => import("./task-result-review-copy/result-review-zh-CN"),
  "zh-TW": () => import("./task-result-review-copy/result-review-zh-TW"),
  ar: () => import("./task-result-review-copy/result-review-ar"),
} satisfies Record<Locale, () => Promise<{ default: TaskResultReviewCopy }>>;
export async function loadTaskResultReviewCopy(
  locale: Locale,
): Promise<TaskResultReviewCopy> {
  return (await loaders[locale]()).default;
}
