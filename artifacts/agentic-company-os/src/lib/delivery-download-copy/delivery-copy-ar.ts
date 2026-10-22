import type { DeliveryDownloadCopy } from "../delivery-download-copy";

export default {
  downloadDelivery: "تنزيل الملخص (.txt)",
  deliveryDownloadError:
    "تعذّر إنشاء الملف. لا يزال الملخص محفوظًا هنا؛ حاول تنزيله مجددًا.",
  deliveryExportProject: "المشروع {id}: {title}",
  deliveryExportStatus: "الحالة الحالية: {status}",
  deliveryExportNotice:
    "هذا هو الملخص الذي حفظه الوكيل. تنزيل الملف لا يُعد تحققًا من العمل.",
} satisfies DeliveryDownloadCopy;
