import { isLocale, LOCALE_STORAGE_KEY, type Locale } from "./i18n";
// Kept in the shell: recovery cannot depend on a failed route/language chunk.
export const recoveryCopy: Record<
  Locale,
  { title: string; body: string; reload: string; home: string; details: string }
> = {
  tr: {
    title: "Bu ekran açılamadı",
    body: "Son işlemin veya kaydedilmemiş değişikliklerin durumu doğrulanamadı. Yeniden yüklemek bu sayfadaki taslakları temizler. İşlemi tekrarlamadan önce kayıtları kontrol et.",
    reload: "Sayfayı yeniden yükle",
    home: "Ana sayfaya dön",
    details: "Geliştirici ayrıntıları",
  },
  en: {
    title: "This screen could not open",
    body: "The last action or unsaved changes could not be verified. Reloading clears drafts on this page. Check the records before repeating an action.",
    reload: "Reload page",
    home: "Go to home",
    details: "Developer details",
  },
  de: {
    title: "Diese Ansicht konnte nicht geöffnet werden",
    body: "Die letzte Aktion oder ungespeicherte Änderungen konnten nicht bestätigt werden. Neuladen löscht Entwürfe auf dieser Seite. Prüfe die Einträge, bevor du eine Aktion wiederholst.",
    reload: "Seite neu laden",
    home: "Zur Startseite",
    details: "Entwicklerdetails",
  },
  ru: {
    title: "Не удалось открыть этот экран",
    body: "Состояние последнего действия или несохранённых изменений не подтверждено. Перезагрузка очистит черновики на странице. Проверьте записи, прежде чем повторять действие.",
    reload: "Перезагрузить страницу",
    home: "На главную",
    details: "Сведения для разработчика",
  },
  "zh-CN": {
    title: "无法打开此页面",
    body: "无法确认上一次操作或未保存更改的状态。重新加载将清除此页面的草稿。再次执行操作前，请先检查记录。",
    reload: "重新加载页面",
    home: "返回首页",
    details: "开发者详情",
  },
  "zh-TW": {
    title: "無法開啟此頁面",
    body: "無法確認上一次操作或未儲存變更的狀態。重新載入將清除此頁面的草稿。再次執行操作前，請先檢查紀錄。",
    reload: "重新載入頁面",
    home: "返回首頁",
    details: "開發者詳細資訊",
  },
  ar: {
    title: "تعذّر فتح هذه الشاشة",
    body: "تعذّر التحقق من حالة آخر إجراء أو التغييرات غير المحفوظة. ستؤدي إعادة التحميل إلى مسح المسودات في هذه الصفحة. راجع السجلات قبل تكرار أي إجراء.",
    reload: "إعادة تحميل الصفحة",
    home: "الانتقال إلى الرئيسية",
    details: "تفاصيل للمطوّر",
  },
};
export function recoveryLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    /* Recovery also works when browser storage is unavailable. */
  }
  const language = document.documentElement.lang;
  return isLocale(language) ? language : "tr";
}
