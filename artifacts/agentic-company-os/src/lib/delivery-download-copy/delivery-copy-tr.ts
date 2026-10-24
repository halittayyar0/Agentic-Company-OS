import type { DeliveryDownloadCopy } from "../delivery-download-copy";

export default {
  downloadDelivery: "Özeti indir (.txt)",
  deliveryDownloadError:
    "Dosya hazırlanamadı. Özetin burada duruyor; indirmeyi yeniden dene.",
  deliveryExportProject: "Proje {id}: {title}",
  deliveryExportStatus: "Güncel durum: {status}",
  deliveryExportNotice:
    "Kaydedilmiş görev sonucu. Bu dosyayı indirmek işin doğrulandığı anlamına gelmez.",
} satisfies DeliveryDownloadCopy;
