import type { Locale } from "./i18n";
export type ExtensionEditorCopy = {
  storageError: string;
  pendingTitle: string;
  uncertain: string;
  check: string;
  retry: string;
  continue: string;
  matching: string;
  missing: string;
  changed: string;
  invalid: string;
  validation: string;
  availability: string;
  incomingHelp: string;
  keep: string;
  use: string;
  reviewCurrent: string;
  storedVersion: string;
  storedAvailability: string;
  reviewHelp: string;
};
const loaders = {
  tr: () => import("./extension-editor-copy/editor-tr"),
  en: () => import("./extension-editor-copy/editor-en"),
  de: () => import("./extension-editor-copy/editor-de"),
  ru: () => import("./extension-editor-copy/editor-ru"),
  "zh-CN": () => import("./extension-editor-copy/editor-zh-CN"),
  "zh-TW": () => import("./extension-editor-copy/editor-zh-TW"),
  ar: () => import("./extension-editor-copy/editor-ar"),
};
export async function loadExtensionEditorCopy(
  locale: Locale,
): Promise<ExtensionEditorCopy> {
  return (await loaders[locale]()).default;
}
