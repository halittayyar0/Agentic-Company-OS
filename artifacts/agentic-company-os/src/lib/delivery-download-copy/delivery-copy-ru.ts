import type { DeliveryDownloadCopy } from "../delivery-download-copy";

export default {
  downloadDelivery: "Скачать сводку (.txt)",
  deliveryDownloadError:
    "Не удалось подготовить файл. Сводка сохранена на странице. Попробуйте скачать её ещё раз.",
  deliveryExportProject: "Проект {id}: {title}",
  deliveryExportStatus: "Текущий статус: {status}",
  deliveryExportNotice:
    "Сводка сохранена агентом. Скачивание файла не подтверждает правильность работы.",
} satisfies DeliveryDownloadCopy;
