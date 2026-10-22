import type { DeliveryDownloadCopy } from "../delivery-download-copy";

export default {
  downloadDelivery: "Özeti indir (.txt)",
  deliveryDownloadError:
    "Dosya hazırlanamadı. Özetin burada duruyor; indirmeyi yeniden dene.",
  deliveryExportProject: "Proje {id}: {title}",
  deliveryExportStatus: "Güncel durum: {status}",
  deliveryExportNotice:
    "Ajanın kaydettiği özet. Bu dosyayı indirmek çalışmayı doğrulamaz.",
} satisfies DeliveryDownloadCopy;
