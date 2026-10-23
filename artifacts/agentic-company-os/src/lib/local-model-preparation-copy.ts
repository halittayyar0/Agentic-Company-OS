import type { Locale } from "./i18n";
export type ModelPreparationCopy = Record<
  | "title"
  | "description"
  | "download"
  | "stop"
  | "checking"
  | "returnToJob"
  | "available"
  | "preparing"
  | "downloading"
  | "stopping"
  | "interrupted"
  | "failed"
  | "unknown"
  | "check"
  | "install"
  | "where"
  | "storage"
  | "saveFirst"
  | "continues"
  | "reset"
  | "unavailable"
  | "update"
  | "changed"
  | "readyHint"
  | "pendingHint"
  | "bytes",
  string
>;
const loaders = {
  en: () => import("./local-model-preparation-copy/preparation-en"),
  tr: () => import("./local-model-preparation-copy/preparation-tr"),
  de: () => import("./local-model-preparation-copy/preparation-de"),
  ru: () => import("./local-model-preparation-copy/preparation-ru"),
  "zh-CN": () => import("./local-model-preparation-copy/preparation-zh-CN"),
  "zh-TW": () => import("./local-model-preparation-copy/preparation-zh-TW"),
  ar: () => import("./local-model-preparation-copy/preparation-ar"),
} satisfies Record<Locale, () => Promise<{ default: ModelPreparationCopy }>>;
export const loadModelPreparationCopy = async (
  locale: Locale,
): Promise<ModelPreparationCopy> => (await loaders[locale]()).default;
