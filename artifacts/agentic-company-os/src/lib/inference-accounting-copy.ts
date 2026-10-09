import type { Locale } from "./i18n";
export type InferenceAccountingCopy = {
  title: string;
  clear: string;
  pending: string;
  recovery_required: string;
  pendingHelp: string;
  recoveryHelp: string;
  clearHelp: string;
  inspect: string;
  error: string;
  observed: string;
  request: string;
  tokens: string;
  lowerBound: string;
  complete: string;
  unknownUsage: string;
  unknownCost: string;
  more: string;
  states: Record<
    "reserved" | "dispatched" | "uncertain" | "accounted" | "not_dispatched",
    string
  >;
};
const loaders = {
  tr: () => import("./inference-accounting-copy/inference-copy-tr"),
  en: () => import("./inference-accounting-copy/inference-copy-en"),
  de: () => import("./inference-accounting-copy/inference-copy-de"),
  ru: () => import("./inference-accounting-copy/inference-copy-ru"),
  "zh-CN": () => import("./inference-accounting-copy/inference-copy-zh-CN"),
  "zh-TW": () => import("./inference-accounting-copy/inference-copy-zh-TW"),
  ar: () => import("./inference-accounting-copy/inference-copy-ar"),
};
export async function loadInferenceAccountingCopy(
  locale: Locale,
): Promise<InferenceAccountingCopy> {
  return (await loaders[locale]()).default;
}
