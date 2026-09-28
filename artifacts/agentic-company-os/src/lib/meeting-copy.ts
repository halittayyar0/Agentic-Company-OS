import type { Locale } from "./i18n";
export type MeetingCopy = {
  [K in keyof typeof import("./meeting-copy/meetings-en").default]: string;
};
const loaders = {
  tr: () => import("./meeting-copy/meetings-tr"),
  en: () => import("./meeting-copy/meetings-en"),
  de: () => import("./meeting-copy/meetings-de"),
  ru: () => import("./meeting-copy/meetings-ru"),
  "zh-CN": () => import("./meeting-copy/meetings-zh-CN"),
  "zh-TW": () => import("./meeting-copy/meetings-zh-TW"),
  ar: () => import("./meeting-copy/meetings-ar"),
};
export async function loadMeetingCopy(locale: Locale): Promise<MeetingCopy> {
  return (await loaders[locale]()).default;
}
export function meetingText(
  text: string,
  values: Record<string, string | number>,
): string {
  return text.replace(/\{(\w+)\}/g, (match, key) =>
    String(values[key] ?? match),
  );
}
