import type { DeliveryDownloadCopy } from "../delivery-download-copy";

export default {
  downloadDelivery: "تنزيل الملخص (.txt)",
  deliveryDownloadError:
    "تعذّر إنشاء الملف. لا يزال الملخص محفوظًا هنا؛ حاول تنزيله مجددًا.",
  deliveryExportProject: "المشروع {id}: {title}",
  deliveryExportStatus: "الحالة الحالية: {status}",
  deliveryExportNotice:
    "نتيجة مهمة محفوظة. تنزيل هذا الملف لا يؤكد التحقق من العمل.",
} satisfies DeliveryDownloadCopy;
