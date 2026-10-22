import type { DeliveryDownloadCopy } from "../delivery-download-copy";

export default {
  downloadDelivery: "Zusammenfassung herunterladen (.txt)",
  deliveryDownloadError:
    "Die Datei konnte nicht erstellt werden. Die Zusammenfassung bleibt hier erhalten. Versuche den Download erneut.",
  deliveryExportProject: "Projekt {id}: {title}",
  deliveryExportStatus: "Aktueller Status: {status}",
  deliveryExportNotice:
    "Vom Agenten gespeicherte Zusammenfassung. Dieser Download bestätigt nicht, dass die Arbeit korrekt ist.",
} satisfies DeliveryDownloadCopy;
