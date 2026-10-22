import type { DeliveryDownloadCopy } from "../delivery-download-copy";

export default {
  downloadDelivery: "下载摘要 (.txt)",
  deliveryDownloadError: "无法生成文件。摘要仍保留在此页面，请重试下载。",
  deliveryExportProject: "项目 {id}：{title}",
  deliveryExportStatus: "当前状态：{status}",
  deliveryExportNotice:
    "这是智能体保存的摘要。下载此文件并不代表工作已通过验证。",
} satisfies DeliveryDownloadCopy;
