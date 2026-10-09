import type { Locale } from "./i18n";

export type ReusableWorkCopy = {
  incomingTitle: string;
  incomingHelp: string;
  keepCurrent: string;
  useIncoming: string;
  choiceError: string;
  preparationOnly: string;
};
const loaders = {
  tr: () => import("./reusable-work-copy/reuse-tr"),
  en: () => import("./reusable-work-copy/reuse-en"),
  de: () => import("./reusable-work-copy/reuse-de"),
  ru: () => import("./reusable-work-copy/reuse-ru"),
  "zh-CN": () => import("./reusable-work-copy/reuse-zh-CN"),
  "zh-TW": () => import("./reusable-work-copy/reuse-zh-TW"),
  ar: () => import("./reusable-work-copy/reuse-ar"),
};
export async function loadReusableWorkCopy(
  locale: Locale,
): Promise<ReusableWorkCopy> {
  return (await loaders[locale]()).default;
}
