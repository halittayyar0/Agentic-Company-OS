import type { Locale } from "./i18n";
import type { CodexSessionRecoveryReason } from "@workspace/api-client-react";
export type CodingRecoveryCopy = {
  title: string;
  description: string;
  acknowledge: string;
  reset: string;
  checking: string;
  inspect: string;
  retry: string;
  missing: string;
  unknown: string;
  storage: string;
  snapshotError: string;
  success: string;
  reasons: Record<CodexSessionRecoveryReason, string>;
};
const loaders = {
  en: () => import("./coding-recovery-copy/coding-recovery-en"),
  tr: () => import("./coding-recovery-copy/coding-recovery-tr"),
  de: () => import("./coding-recovery-copy/coding-recovery-de"),
  ru: () => import("./coding-recovery-copy/coding-recovery-ru"),
  "zh-CN": () => import("./coding-recovery-copy/coding-recovery-zh-CN"),
  "zh-TW": () => import("./coding-recovery-copy/coding-recovery-zh-TW"),
  ar: () => import("./coding-recovery-copy/coding-recovery-ar"),
};
export async function loadCodingRecoveryCopy(
  locale: Locale,
): Promise<CodingRecoveryCopy> {
  return (await loaders[locale]()).default;
}
