import type { DeliveryDownloadCopy } from "../delivery-download-copy";

export default {
  downloadDelivery: "Download summary (.txt)",
  deliveryDownloadError:
    "The file could not be prepared. Your summary is still here; try downloading again.",
  deliveryExportProject: "Project {id}: {title}",
  deliveryExportStatus: "Current status: {status}",
  deliveryExportNotice:
    "Saved task result. Downloading this file does not verify the work.",
} satisfies DeliveryDownloadCopy;
