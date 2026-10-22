import type { Locale } from "./i18n";

export type DeliveryDownloadCopy = {
  downloadDelivery: string;
  deliveryDownloadError: string;
  deliveryExportProject: string;
  deliveryExportStatus: string;
  deliveryExportNotice: string;
};
const loaders = {
  tr: () => import("./delivery-download-copy/delivery-copy-tr"),
  en: () => import("./delivery-download-copy/delivery-copy-en"),
  de: () => import("./delivery-download-copy/delivery-copy-de"),
  ru: () => import("./delivery-download-copy/delivery-copy-ru"),
  "zh-CN": () => import("./delivery-download-copy/delivery-copy-zh-CN"),
  "zh-TW": () => import("./delivery-download-copy/delivery-copy-zh-TW"),
  ar: () => import("./delivery-download-copy/delivery-copy-ar"),
};
export async function loadDeliveryDownloadCopy(
  locale: Locale,
): Promise<DeliveryDownloadCopy> {
  return (await loaders[locale]()).default;
}
