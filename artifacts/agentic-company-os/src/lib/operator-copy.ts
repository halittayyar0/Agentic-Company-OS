import type { Locale } from "./i18n";
export type OperatorCopy = {
  check: string;
  checking: string;
  help: string;
  legacy: string;
  reserved: string;
  dispatched: string;
  complete: string;
  unavailable: string;
  not_dispatched: string;
  unknown: string;
  missing: string;
  error: string;
  browser: string;
  review: string;
  reviewHelp: string;
  reviewCheck: string;
  finish: string;
  cancel: string;
  changed: string;
};
const loaders = {
  en: () => import("./operator-copy/operator-en"),
  tr: () => import("./operator-copy/operator-tr"),
  de: () => import("./operator-copy/operator-de"),
  ru: () => import("./operator-copy/operator-ru"),
  "zh-CN": () => import("./operator-copy/operator-zh-CN"),
  "zh-TW": () => import("./operator-copy/operator-zh-TW"),
  ar: () => import("./operator-copy/operator-ar"),
};
export async function loadOperatorCopy(locale: Locale): Promise<OperatorCopy> {
  return (await loaders[locale]()).default;
}
