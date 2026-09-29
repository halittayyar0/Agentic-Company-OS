import type { WorkspaceLocale } from "../workspace-locale";
import type { AdvancedToolName } from "./advanced-tools";

// Same order as the appended tool names in names.ts.
const names: AdvancedToolName[] = [
  "csv_select",
  "csv_group",
  "json_select",
  "json_flatten",
  "compare_lists",
  "text_find",
  "text_replace",
  "markdown_table",
  "convert_units",
  "date_interval",
];
const titles: Record<WorkspaceLocale, string> = {
  en: "Select CSV columns|Aggregate CSV groups|Select JSON paths|Flatten JSON|Compare lists|Find literal text|Replace literal text|Create Markdown table|Convert units exactly|Calculate date interval",
  tr: "CSV sütunlarını seç|CSV gruplarını özetle|JSON yollarını seç|JSON yapısını düzleştir|Listeleri karşılaştır|Metinde bul|Metni değiştir|Markdown tablosu oluştur|Birimleri kesin dönüştür|Tarih aralığını hesapla",
  de: "CSV-Spalten auswählen|CSV-Gruppen aggregieren|JSON-Pfade auswählen|JSON abflachen|Listen vergleichen|Text suchen|Text ersetzen|Markdown-Tabelle erstellen|Einheiten exakt umrechnen|Datumsabstand berechnen",
  ru: "Выбрать столбцы CSV|Агрегировать группы CSV|Выбрать пути JSON|Развернуть JSON|Сравнить списки|Найти текст|Заменить текст|Создать таблицу Markdown|Точно преобразовать единицы|Рассчитать интервал дат",
  "zh-CN":
    "选择 CSV 列|汇总 CSV 分组|选择 JSON 路径|展平 JSON|比较列表|查找文本|替换文本|创建 Markdown 表格|精确转换单位|计算日期间隔",
  "zh-TW":
    "選取 CSV 欄位|彙總 CSV 群組|選取 JSON 路徑|攤平 JSON|比較清單|尋找文字|取代文字|建立 Markdown 表格|精確轉換單位|計算日期間隔",
  ar: "اختيار أعمدة CSV|تجميع مجموعات CSV|اختيار مسارات JSON|تسطيح JSON|مقارنة القوائم|البحث عن نص|استبدال نص|إنشاء جدول Markdown|تحويل الوحدات بدقة|حساب الفترة بين تاريخين",
};
const descriptions: Record<WorkspaceLocale, string> = {
  en: "Select and reorder unique columns while preserving cell strings.|Group by exact keys; count rows or calculate exact decimal sum, minimum or maximum.|Read RFC 6901 paths, distinguishing missing values from null; reject lossy numbers.|Produce bounded leaf entries with escaped paths; preserve empty arrays and objects.|Compare case-sensitive strings as sets or multisets with explicit duplicate handling.|Find literal nonoverlapping matches with Unicode offsets and line numbers; no regex.|Replace literal nonoverlapping text; dollar signs remain literal.|Render a rectangular table, escaping HTML and Markdown and flattening cell line breaks.|Convert decimal strings within length, mass, time or binary storage; reject rounding and incompatible units.|Count signed calendar days between valid Gregorian YYYY-MM-DD dates, excluding the start day.",
  tr: "Hücre metinlerini koruyarak benzersiz sütunları seç ve sırala.|Tam eşleşen anahtarlara göre grupla; satır sayısı veya kesin ondalık toplam, en küçük ya da en büyük değeri hesapla.|RFC 6901 yollarını oku; eksik değer ile null ayrımını koru ve hassasiyet kaybeden sayıları reddet.|Kaçışlı yollarla sınırlı yaprak listesi üret; boş dizi ve nesneleri koru.|Büyük/küçük harfe duyarlı metinleri küme veya çoklu küme olarak karşılaştır.|Düz metin eşleşmelerini Unicode konumu ve satır numarasıyla bul; düzenli ifade kullanmaz.|Çakışmayan düz metin eşleşmelerini değiştir; dolar işaretlerini aynen koru.|HTML ve Markdown karakterlerini kaçırarak dikdörtgen tablo oluştur; hücre satır sonlarını boşluğa çevir.|Uzunluk, kütle, zaman veya ikili depolama birimlerini kesin dönüştür; yuvarlama ve uyumsuz birimleri reddet.|Geçerli YYYY-MM-DD Gregoryen tarihleri arasında başlangıç günü hariç işaretli gün farkını hesapla.",
  de: "Eindeutige Spalten auswählen und anordnen; Zelltexte bleiben erhalten.|Nach exakten Schlüsseln gruppieren; Zeilen zählen oder exakte Dezimalsumme, Minimum oder Maximum berechnen.|RFC-6901-Pfade lesen; fehlende Werte von null unterscheiden und Zahlen mit Präzisionsverlust ablehnen.|Begrenzte Blatteinträge mit maskierten Pfaden erzeugen; leere Container erhalten.|Zeichenfolgen mit Beachtung der Großschreibung als Mengen oder Multimengen vergleichen.|Wörtliche Treffer mit Unicode-Positionen und Zeilennummern finden; keine regulären Ausdrücke.|Nicht überlappende wörtliche Treffer ersetzen; Dollarzeichen unverändert behandeln.|Rechteckige Tabelle erstellen; HTML und Markdown maskieren und Zellumbrüche durch Leerzeichen ersetzen.|Dezimalwerte für Länge, Masse, Zeit oder binären Speicher exakt umrechnen; Rundung ablehnen.|Vorzeichenbehaftete Kalendertage zwischen gültigen gregorianischen YYYY-MM-DD-Daten ohne Starttag zählen.",
  ru: "Выбрать уникальные столбцы и изменить порядок, сохранив текст ячеек.|Группировать по точным ключам; считать строки или точную десятичную сумму, минимум либо максимум.|Читать пути RFC 6901; отличать отсутствие от null и отклонять потерю точности чисел.|Создать ограниченный список листьев с экранированными путями; сохранить пустые контейнеры.|Сравнить строки с учётом регистра как множества или мультимножества.|Найти буквальные совпадения с позициями Unicode и номерами строк; без регулярных выражений.|Заменить неперекрывающиеся буквальные совпадения; сохранить смысл знаков доллара.|Создать прямоугольную таблицу с экранированием HTML и Markdown; заменить переносы пробелами.|Точно преобразовать десятичные значения длины, массы, времени или двоичного объёма; отклонить округление.|Посчитать знаковую разницу календарных дней между корректными григорианскими датами YYYY-MM-DD без начального дня.",
  "zh-CN":
    "选择并重排唯一列，保留单元格原始文本。|按精确键分组，计数或计算精确十进制总和、最小值、最大值。|读取 RFC 6901 路径，区分缺失与 null，拒绝精度丢失。|生成有界叶节点列表，转义路径并保留空数组和对象。|区分大小写，以集合或多重集合比较字符串。|查找非重叠字面文本，返回 Unicode 位置和行号，不使用正则表达式。|替换非重叠字面文本，美元符号保持字面含义。|生成矩形表格，转义 HTML 和 Markdown，将单元格换行替换为空格。|精确转换长度、质量、时间或二进制存储单位，拒绝舍入和不兼容单位。|计算有效公历 YYYY-MM-DD 日期之间带符号的日数，不含起始日。",
  "zh-TW":
    "選取並重排唯一欄位，保留儲存格原始文字。|按精確鍵分組，計數或計算精確十進位總和、最小值、最大值。|讀取 RFC 6901 路徑，區分缺漏與 null，拒絕精度損失。|產生有界葉節點清單，跳脫路徑並保留空陣列和物件。|區分大小寫，以集合或多重集合比較字串。|尋找不重疊的字面文字，傳回 Unicode 位置及行號，不使用正規表示式。|取代不重疊的字面文字，錢字符號維持字面含義。|建立矩形表格，跳脫 HTML 和 Markdown，將儲存格換行轉為空格。|精確轉換長度、質量、時間或二進位儲存單位，拒絕四捨五入和不相容單位。|計算有效西曆 YYYY-MM-DD 日期間帶正負號的日數，不含起始日。",
  ar: "اختيار أعمدة فريدة وإعادة ترتيبها مع الحفاظ على نص الخلايا.|التجميع حسب مفاتيح مطابقة وحساب عدد الصفوف أو المجموع العشري الدقيق أو الحد الأدنى أو الأقصى.|قراءة مسارات RFC 6901 والتمييز بين القيمة المفقودة وnull ورفض فقدان الدقة.|إنتاج قائمة أوراق محدودة بمسارات مهربة مع الحفاظ على الحاويات الفارغة.|مقارنة النصوص الحساسة لحالة الأحرف كمجموعات أو مجموعات متعددة.|البحث عن نص حرفي غير متداخل مع مواضع Unicode وأرقام الأسطر دون تعبيرات نمطية.|استبدال النص الحرفي غير المتداخل والحفاظ على المعنى الحرفي لعلامة الدولار.|إنشاء جدول مستطيل مع تهريب HTML وMarkdown وتحويل فواصل الأسطر إلى مسافات.|تحويل عشري دقيق للطول أو الكتلة أو الزمن أو التخزين الثنائي مع رفض التقريب والوحدات غير المتوافقة.|حساب فرق الأيام التقويمية بإشارة بين تاريخين ميلاديين صالحين بصيغة YYYY-MM-DD دون يوم البداية.",
};
export function advancedCatalog(locale: WorkspaceLocale) {
  const t = titles[locale].split("|"),
    d = descriptions[locale].split("|");
  return new Map(
    names.map((name, i) => [name, { title: t[i], description: d[i] }]),
  );
}
