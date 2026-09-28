import type { WorkspaceLocale } from "../workspace-locale";
import type { CatalogLocale } from "./catalog-types";
import { en } from "./locales/en";
import { tr } from "./locales/tr";
import { de } from "./locales/de";
import { ru } from "./locales/ru";
import { zhCN } from "./locales/zh-CN";
import { zhTW } from "./locales/zh-TW";
import { ar } from "./locales/ar";
export const catalogLocales: Record<WorkspaceLocale, CatalogLocale> = {
  en,
  tr,
  de,
  ru,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ar,
};
