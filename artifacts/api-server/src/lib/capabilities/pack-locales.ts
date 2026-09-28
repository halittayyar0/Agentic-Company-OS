import type { WorkspaceLocale } from "../workspace-locale";
import { PACK_TOOL_NAMES, EXTENSION_TOOL_NAMES } from "./names";
const titles: Record<WorkspaceLocale, string> = {
  tr: "CSV filtrele|CSV sırala|CSV tekrarlarını kaldır|CSV tablolarını birleştir|CSV → JSON|JSON → CSV|JSON karşılaştır|JSON biçimlendir|HTML raporu oluştur|Şablonu doldur|Markdown başlıklarını çıkar|Sayfa metinlerini karşılaştır",
  en: "Filter CSV|Sort CSV|Deduplicate CSV|Join CSV tables|CSV → JSON|JSON → CSV|Compare JSON|Format JSON|Create HTML report|Fill a template|Extract Markdown headings|Compare page text",
  de: "CSV filtern|CSV sortieren|CSV-Duplikate entfernen|CSV-Tabellen verbinden|CSV → JSON|JSON → CSV|JSON vergleichen|JSON formatieren|HTML-Bericht erstellen|Vorlage ausfüllen|Markdown-Überschriften extrahieren|Seitentexte vergleichen",
  ru: "Фильтрация CSV|Сортировка CSV|Удаление повторов CSV|Объединение таблиц CSV|CSV → JSON|JSON → CSV|Сравнение JSON|Форматирование JSON|Создание HTML-отчёта|Заполнение шаблона|Извлечение заголовков Markdown|Сравнение текста страниц",
  "zh-CN":
    "筛选 CSV|排序 CSV|CSV 去重|合并 CSV 表格|CSV → JSON|JSON → CSV|比较 JSON|格式化 JSON|创建 HTML 报告|填充模板|提取 Markdown 标题|比较页面文本",
  "zh-TW":
    "篩選 CSV|排序 CSV|CSV 去重|合併 CSV 表格|CSV → JSON|JSON → CSV|比較 JSON|格式化 JSON|建立 HTML 報告|填入範本|擷取 Markdown 標題|比較頁面文字",
  ar: "تصفية CSV|ترتيب CSV|إزالة تكرار CSV|دمج جداول CSV|CSV → JSON|JSON → CSV|مقارنة JSON|تنسيق JSON|إنشاء تقرير HTML|ملء قالب|استخراج عناوين Markdown|مقارنة نص الصفحات",
};
const boundary: Record<WorkspaceLocale, string> = {
  tr: "Verdiğin içerik üzerinde, boyut sınırları içinde çalışır. Dosya, terminal veya ağ erişimi kullanmaz.",
  en: "Works on supplied content within size limits. Uses no file, terminal or network access.",
  de: "Verarbeitet bereitgestellte Inhalte innerhalb der Größenlimits. Kein Datei-, Terminal- oder Netzwerkzugriff.",
  ru: "Обрабатывает переданные данные в пределах ограничений размера. Без доступа к файлам, терминалу или сети.",
  "zh-CN": "在大小限制内处理提供的内容，不访问文件、终端或网络。",
  "zh-TW": "在大小限制內處理提供的內容，不存取檔案、終端機或網路。",
  ar: "يعالج المحتوى المقدم ضمن حدود الحجم دون الوصول إلى الملفات أو الطرفية أو الشبكة.",
};
const extensionTitles: Record<WorkspaceLocale, string> = {
  tr: "Kişisel araçları listele|Kişisel aracı çalıştır",
  en: "List personal capabilities|Run a personal tool",
  de: "Persönliche Erweiterungen auflisten|Persönliches Werkzeug ausführen",
  ru: "Список личных расширений|Запустить личный инструмент",
  "zh-CN": "列出个人扩展|运行个人工具",
  "zh-TW": "列出個人擴充功能|執行個人工具",
  ar: "عرض الإضافات الشخصية|تشغيل أداة شخصية",
};
export function packCatalog(locale: WorkspaceLocale) {
  const words = [
    ...titles[locale].split("|"),
    ...extensionTitles[locale].split("|"),
  ];
  return [...PACK_TOOL_NAMES, ...EXTENSION_TOOL_NAMES].map((name, index) => ({
    name,
    title: words[index],
    description: boundary[locale],
  }));
}
