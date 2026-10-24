import type { DeliveryDownloadCopy } from "../delivery-download-copy";

export default {
  downloadDelivery: "下載摘要 (.txt)",
  deliveryDownloadError: "無法產生檔案。摘要仍保留在此頁面，請重試下載。",
  deliveryExportProject: "專案 {id}：{title}",
  deliveryExportStatus: "目前狀態：{status}",
  deliveryExportNotice: "已儲存的任務結果。下載此檔案不代表工作已通過驗證。",
} satisfies DeliveryDownloadCopy;
