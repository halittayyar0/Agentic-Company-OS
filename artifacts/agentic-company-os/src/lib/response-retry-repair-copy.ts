import type { Locale } from "./i18n";
export type ResponseRetryRepairCopy = readonly [
  storage: string,
  help: string,
  action: string,
  repaired: string,
  changed: string,
  failed: string,
];
const loaders = {
  tr: () => import("./response-retry-repair-copy/retry-repair-tr"),
  en: () => import("./response-retry-repair-copy/retry-repair-en"),
  de: () => import("./response-retry-repair-copy/retry-repair-de"),
  ru: () => import("./response-retry-repair-copy/retry-repair-ru"),
  "zh-CN": () => import("./response-retry-repair-copy/retry-repair-zh-CN"),
  "zh-TW": () => import("./response-retry-repair-copy/retry-repair-zh-TW"),
  ar: () => import("./response-retry-repair-copy/retry-repair-ar"),
};
export async function loadResponseRetryRepairCopy(
  locale: Locale,
): Promise<ResponseRetryRepairCopy> {
  return (await loaders[locale]()).default;
}
