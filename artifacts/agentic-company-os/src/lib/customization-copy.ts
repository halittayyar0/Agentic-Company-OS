import type { Locale } from "./i18n";
import { useQuery } from "@tanstack/react-query";
export type CustomizationCopy = {
  source: string[];
  policy: string[];
  extensions: string[];
  program: string[];
};
const loaders = {
  tr: () => import("./customization-copy/customization-tr"),
  en: () => import("./customization-copy/customization-en"),
  de: () => import("./customization-copy/customization-de"),
  ru: () => import("./customization-copy/customization-ru"),
  "zh-CN": () => import("./customization-copy/customization-zh-CN"),
  "zh-TW": () => import("./customization-copy/customization-zh-TW"),
  ar: () => import("./customization-copy/customization-ar"),
};
export function useCustomizationCopy(locale: Locale) {
  return useQuery({
    queryKey: ["customization-copy", locale],
    queryFn: async (): Promise<CustomizationCopy> =>
      (await loaders[locale]()).default,
    staleTime: Infinity,
    retry: false,
  });
}
