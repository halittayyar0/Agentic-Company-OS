const MAX_BYTES = 256 * 1024;
const MAX_ROWS = 2000;
const MAX_COLUMNS = 128;

function checkSize(input) {
  if (new TextEncoder().encode(input).length > MAX_BYTES)
    throw new Error("size");
  if (!input.trim()) throw new Error("empty");
}

export function auditCsv(input) {
  checkSize(input);
  const source = input.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let state = "start";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (state === "quoted") {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') state = "afterQuote";
      else field += char;
      continue;
    }
    if (char === "," || char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      state = "start";
      if (char !== ",") {
        rows.push(row);
        if (rows.length > MAX_ROWS + 1) throw new Error("rows");
        row = [];
        if (char === "\r" && source[i + 1] === "\n") i++;
      }
    } else if (char === '"' && state === "start") state = "quoted";
    else if (state === "afterQuote" || char === '"')
      throw new Error("csvSyntax");
    else {
      field += char;
      state = "plain";
    }
  }
  if (state === "quoted") throw new Error("csvSyntax");
  if (row.length || field || state === "afterQuote" || source.endsWith(",")) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length > MAX_ROWS + 1) throw new Error("rows");
  if (!rows.length) throw new Error("empty");
  if (rows.some((item) => item.length > MAX_COLUMNS))
    throw new Error("columns");
  const headers = rows.shift();
  const widthErrors = rows.filter(
    (item) => item.length !== headers.length,
  ).length;
  const missing = headers.map((_, index) =>
    rows.reduce((count, item) => count + (!item[index]?.trim() ? 1 : 0), 0),
  );
  const seen = new Set();
  let duplicates = 0;
  for (const item of rows) {
    const key = JSON.stringify(item);
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  const usedHeaders = new Set();
  let duplicateHeaders = 0;
  for (const header of headers) {
    if (usedHeaders.has(header)) duplicateHeaders++;
    usedHeaders.add(header);
  }
  return {
    rows: rows.length,
    columns: headers.length,
    widthErrors,
    duplicates,
    emptyHeaders: headers.filter((header) => !header.trim()).length,
    duplicateHeaders,
    missing,
    headers,
  };
}

export function auditJson(input) {
  checkSize(input);
  let root;
  try {
    root = JSON.parse(input);
  } catch {
    throw new Error("jsonSyntax");
  }
  const types = {
    object: 0,
    array: 0,
    string: 0,
    number: 0,
    boolean: 0,
    null: 0,
  };
  const stack = [[root, 0]];
  let maxDepth = 0;
  while (stack.length) {
    const [value, depth] = stack.pop();
    maxDepth = Math.max(maxDepth, depth);
    const type =
      value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    types[type]++;
    if (type === "array")
      for (const child of value) stack.push([child, depth + 1]);
    if (type === "object")
      for (const child of Object.values(value)) stack.push([child, depth + 1]);
  }
  return {
    rootType:
      root === null ? "null" : Array.isArray(root) ? "array" : typeof root,
    keys:
      root && !Array.isArray(root) && typeof root === "object"
        ? Object.keys(root)
        : [],
    types,
    nodes: Object.values(types).reduce((sum, value) => sum + value, 0),
    maxDepth,
  };
}

export function compareLists(first, second) {
  checkSize(first);
  checkSize(second);
  const parse = (input) => {
    const lines = input.split(/\r\n|\n|\r/);
    if (lines.length > MAX_ROWS) throw new Error("rows");
    return new Set(lines.map((line) => line.trim()).filter(Boolean));
  };
  const a = parse(first);
  const b = parse(second);
  return {
    onlyA: [...a].filter((item) => !b.has(item)),
    onlyB: [...b].filter((item) => !a.has(item)),
    common: [...a].filter((item) => b.has(item)),
    countA: a.size,
    countB: b.size,
  };
}

const labels =
  "heroTry|eyebrow|title|intro|privacy|csvTab|jsonTab|listsTab|csvLabel|jsonLabel|listALabel|listBLabel|chooseFile|sample|run|limit|resultEyebrow|resultTitle|download|copyTask|fileSize|empty|rows|columns|csvSyntax|jsonSyntax|summaryCsv|summaryJson|summaryLists|csvRows|csvColumns|csvWidth|csvDuplicates|csvEmptyHeaders|csvDuplicateHeaders|csvMissing|jsonRoot|jsonNodes|jsonDepth|jsonKeys|jsonTypes|onlyA|onlyB|common|copied|copyManual|downloaded|taskIntro|taskEnd|listSemantics".split(
    "|",
  );
const copy = {
  en: "Try a useful tool|USE IT NOW · NO ACCOUNT|Get a result before you install.|Check a small file or compare two lists in this browser. No model, account or upload is needed.|Your input stays in this browser tab. Nothing is sent to our server.|CSV check|JSON map|List difference|Paste comma-separated data|Paste JSON|First list · one item per line|Second list · one item per line|Or choose a local file|Use an example|Check my data|Up to 256 KB. CSV: 2,000 rows and 128 columns. Lists: 2,000 lines each.|LOCAL RESULT|Your check is ready.|Download report|Copy follow-up task|File exceeds 256 KB.|Add some data first.|Too many rows or lines.|Too many columns.|CSV has an invalid or unclosed quoted field.|JSON is invalid.|{0} rows · {1} columns · {2} duplicate rows|{0} nodes · maximum depth {1}|{0} only in first · {1} only in second · {2} shared|Data rows|Columns|Rows with a different column count|Duplicate rows|Empty headers|Duplicate headers|Missing values by column|Root type|Total nodes|Maximum depth|Top-level keys|Node types|Only in first|Only in second|In both|Task copied. Paste it into your private workspace.|Copy manually:|Report downloaded.|Analyze the attached original file or lists in my private workspace. This public-page check found:|Check the findings, explain limitations, and save a reviewed result. Ask before modifying originals. The original input was not copied into this task.|List matching is case-sensitive. Outer spaces are trimmed, blank lines ignored, and duplicate entries counted once.",
  tr: "Faydalı bir araç dene|ŞİMDİ KULLAN · HESAP YOK|Kurulumdan önce bir sonuç al.|Küçük bir dosyayı kontrol et veya iki listeyi bu tarayıcıda karşılaştır. Model, hesap veya yükleme gerekmez.|Girdi bu tarayıcı sekmesinde kalır. Sunucumuza gönderilmez.|CSV kontrolü|JSON haritası|Liste farkı|Virgülle ayrılmış veriyi yapıştır|JSON yapıştır|İlk liste · satır başına bir öğe|İkinci liste · satır başına bir öğe|Veya yerel dosya seç|Örnek kullan|Verimi kontrol et|En fazla 256 KB. CSV: 2.000 satır ve 128 sütun. Listeler: her biri 2.000 satır.|YEREL SONUÇ|Kontrol hazır.|Raporu indir|Devam görevini kopyala|Dosya 256 KB sınırını aşıyor.|Önce veri ekle.|Çok fazla satır var.|Çok fazla sütun var.|CSV içinde hatalı veya kapatılmamış tırnaklı alan var.|JSON geçersiz.|{0} satır · {1} sütun · {2} yinelenen satır|{0} düğüm · en fazla {1} derinlik|Yalnız ilk listede {0} · yalnız ikincide {1} · ortak {2}|Veri satırı|Sütun|Farklı sütun sayılı satır|Yinelenen satır|Boş başlık|Yinelenen başlık|Sütun başına eksik değer|Kök türü|Toplam düğüm|En büyük derinlik|Üst düzey anahtarlar|Düğüm türleri|Yalnız ilk listede|Yalnız ikinci listede|İkisinde de|Görev kopyalandı. Özel çalışma alanına yapıştır.|Elle kopyala:|Rapor indirildi.|Ekteki asıl dosyayı veya listeleri özel çalışma alanımda incele. Açık sayfadaki kontrol şu sonucu buldu:|Bulguları doğrula, sınırlarını açıkla ve gözden geçirilmiş sonucu kaydet. Asılları değiştirmeden önce onay iste. Asıl girdi bu göreve kopyalanmadı.|Liste eşleştirmesi büyük/küçük harfe duyarlıdır. Baştaki ve sondaki boşluklar temizlenir, boş satırlar atlanır, tekrarlar bir kez sayılır.",
  de: "Nützliches Werkzeug testen|JETZT NUTZEN · OHNE KONTO|Ein Ergebnis vor der Installation.|Prüfe eine kleine Datei oder vergleiche zwei Listen direkt im Browser. Kein Modell, Konto oder Upload nötig.|Deine Eingabe bleibt in diesem Browser-Tab. Sie wird nicht an unseren Server gesendet.|CSV prüfen|JSON-Struktur|Listen vergleichen|Kommagetrennte Daten einfügen|JSON einfügen|Erste Liste · ein Eintrag je Zeile|Zweite Liste · ein Eintrag je Zeile|Oder lokale Datei auswählen|Beispiel verwenden|Daten prüfen|Bis 256 KB. CSV: 2.000 Zeilen und 128 Spalten. Listen: je 2.000 Zeilen.|LOKALES ERGEBNIS|Prüfung abgeschlossen.|Bericht herunterladen|Folgeauftrag kopieren|Datei ist größer als 256 KB.|Bitte zuerst Daten eingeben.|Zu viele Zeilen.|Zu viele Spalten.|CSV enthält ein ungültiges oder nicht geschlossenes Anführungszeichen.|Ungültiges JSON.|{0} Zeilen · {1} Spalten · {2} doppelte Zeilen|{0} Knoten · maximale Tiefe {1}|{0} nur in Liste eins · {1} nur in Liste zwei · {2} gemeinsam|Datenzeilen|Spalten|Zeilen mit anderer Spaltenzahl|Doppelte Zeilen|Leere Überschriften|Doppelte Überschriften|Fehlende Werte je Spalte|Wurzeltyp|Knoten gesamt|Maximale Tiefe|Schlüssel der obersten Ebene|Knotentypen|Nur in Liste eins|Nur in Liste zwei|In beiden|Auftrag kopiert. Im privaten Arbeitsbereich einfügen.|Manuell kopieren:|Bericht heruntergeladen.|Analysiere die angehängte Originaldatei oder Listen in meinem privaten Arbeitsbereich. Die Prüfung auf der öffentlichen Seite ergab:|Prüfe die Befunde, erläutere Grenzen und speichere ein überprüftes Ergebnis. Frage vor Änderungen am Original. Die Eingabe wurde nicht in den Auftrag kopiert.|Beim Listenvergleich zählt Groß- und Kleinschreibung. Äußere Leerzeichen und Leerzeilen werden ignoriert, Duplikate nur einmal gezählt.",
  ru: "Попробовать инструмент|ИСПОЛЬЗУЙТЕ СЕЙЧАС · БЕЗ УЧЁТНОЙ ЗАПИСИ|Получите результат до установки.|Проверьте небольшой файл или сравните два списка прямо в браузере. Модель, аккаунт и загрузка не нужны.|Ввод остаётся в этой вкладке браузера и не отправляется на наш сервер.|Проверка CSV|Структура JSON|Сравнение списков|Вставьте данные с разделителем-запятой|Вставьте JSON|Первый список · по одному элементу в строке|Второй список · по одному элементу в строке|Или выберите локальный файл|Использовать пример|Проверить данные|До 256 КБ. CSV: 2000 строк и 128 столбцов. Списки: по 2000 строк.|ЛОКАЛЬНЫЙ РЕЗУЛЬТАТ|Проверка завершена.|Скачать отчёт|Скопировать задачу|Файл превышает 256 КБ.|Сначала добавьте данные.|Слишком много строк.|Слишком много столбцов.|В CSV неверно оформлено поле в кавычках.|Неверный JSON.|Строк: {0} · столбцов: {1} · повторов: {2}|Узлов: {0} · максимальная глубина: {1}|Только в первом: {0} · только во втором: {1} · общих: {2}|Строки данных|Столбцы|Строки с другим числом столбцов|Повторяющиеся строки|Пустые заголовки|Повторяющиеся заголовки|Пропуски по столбцам|Тип корня|Всего узлов|Максимальная глубина|Ключи верхнего уровня|Типы узлов|Только в первом|Только во втором|В обоих|Задача скопирована. Вставьте её в личное рабочее пространство.|Скопируйте вручную:|Отчёт скачан.|Проверь приложенный исходный файл или списки в моём личном рабочем пространстве. Публичная проверка показала:|Проверь выводы и ограничения, сохрани проверенный результат. Спроси перед изменением оригинала. Исходные данные в задачу не скопированы.|Сравнение учитывает регистр. Пробелы по краям и пустые строки игнорируются; повторы считаются один раз.",
  "zh-CN":
    "试用实用工具|立即使用 · 无需账户|安装前先获得结果。|直接在浏览器中检查小文件或比较两个列表。无需模型、账户或上传。|输入仅保留在当前浏览器标签页，不会发送到我们的服务器。|检查 CSV|JSON 结构|列表差异|粘贴逗号分隔的数据|粘贴 JSON|第一个列表 · 每行一项|第二个列表 · 每行一项|或选择本地文件|使用示例|检查数据|不超过 256 KB。CSV：2000 行、128 列。列表：各 2000 行。|本地结果|检查完成。|下载报告|复制后续任务|文件超过 256 KB。|请先输入数据。|行数过多。|列数过多。|CSV 引号字段无效或未关闭。|JSON 无效。|{0} 行 · {1} 列 · {2} 个重复行|{0} 个节点 · 最大深度 {1}|仅在第一项 {0} · 仅在第二项 {1} · 共同 {2}|数据行|列|列数不同的行|重复行|空标题|重复标题|各列缺失值|根类型|节点总数|最大深度|顶层键|节点类型|仅在第一项|仅在第二项|两者都有|任务已复制。请粘贴到私人工作空间。|手动复制：|报告已下载。|在我的私人工作空间分析附加的原始文件或列表。公开页面的检查发现：|核实发现、说明限制并保存审核后的结果。修改原件前先征求同意。原始输入没有复制到此任务。|列表比较区分大小写。会去除首尾空格、忽略空行，并将重复项计为一次。",
  "zh-TW":
    "試用實用工具|立即使用 · 無需帳戶|安裝前先取得結果。|直接在瀏覽器中檢查小檔案或比較兩個清單。無需模型、帳戶或上傳。|輸入僅留在目前瀏覽器分頁，不會傳送至我們的伺服器。|檢查 CSV|JSON 結構|清單差異|貼上逗號分隔的資料|貼上 JSON|第一個清單 · 每行一項|第二個清單 · 每行一項|或選擇本機檔案|使用範例|檢查資料|不超過 256 KB。CSV：2,000 行、128 欄。清單：各 2,000 行。|本機結果|檢查完成。|下載報告|複製後續任務|檔案超過 256 KB。|請先輸入資料。|行數過多。|欄數過多。|CSV 引號欄位無效或未關閉。|JSON 無效。|{0} 行 · {1} 欄 · {2} 個重複行|{0} 個節點 · 最大深度 {1}|僅在第一項 {0} · 僅在第二項 {1} · 共同 {2}|資料行|欄|欄數不同的行|重複行|空標題|重複標題|各欄缺漏值|根類型|節點總數|最大深度|頂層鍵|節點類型|僅在第一項|僅在第二項|兩者都有|任務已複製。請貼到私人工作空間。|手動複製：|報告已下載。|在我的私人工作空間分析附加的原始檔案或清單。公開頁面的檢查發現：|核實發現、說明限制並儲存審核後的結果。修改原件前先徵求同意。原始輸入沒有複製到此任務。|清單比較區分大小寫。會移除首尾空白、忽略空行，並將重複項計為一次。",
  ar: "جرّب أداة مفيدة|استخدمها الآن · بلا حساب|احصل على نتيجة قبل التثبيت.|افحص ملفاً صغيراً أو قارن قائمتين داخل المتصفح. لا حاجة إلى نموذج أو حساب أو رفع.|يبقى إدخالك في علامة تبويب المتصفح هذه ولا يُرسل إلى خادمنا.|فحص CSV|بنية JSON|فرق القائمتين|الصق بيانات مفصولة بفواصل|الصق JSON|القائمة الأولى · عنصر في كل سطر|القائمة الثانية · عنصر في كل سطر|أو اختر ملفاً محلياً|استخدم مثالاً|افحص البيانات|حتى 256 كيلوبايت. CSV: ألفا صف و128 عموداً. القوائم: ألفا سطر لكل منها.|نتيجة محلية|اكتمل الفحص.|تنزيل التقرير|نسخ مهمة المتابعة|يتجاوز الملف 256 كيلوبايت.|أضف بيانات أولاً.|عدد الصفوف كبير جداً.|عدد الأعمدة كبير جداً.|يحتوي CSV على حقل اقتباس غير صالح أو غير مغلق.|JSON غير صالح.|{0} صف · {1} عمود · {2} صف مكرر|{0} عقدة · أقصى عمق {1}|{0} في الأولى فقط · {1} في الثانية فقط · {2} مشتركة|صفوف البيانات|الأعمدة|صفوف بعدد أعمدة مختلف|صفوف مكررة|عناوين فارغة|عناوين مكررة|القيم الناقصة لكل عمود|نوع الجذر|إجمالي العقد|أقصى عمق|مفاتيح المستوى الأعلى|أنواع العقد|في الأولى فقط|في الثانية فقط|في الاثنتين|نُسخت المهمة. الصقها في مساحة عملك الخاصة.|انسخ يدوياً:|نُزّل التقرير.|حلل الملف الأصلي أو القوائم المرفقة داخل مساحة عملي الخاصة. أظهر فحص الصفحة العامة:|تحقق من النتائج واشرح القيود واحفظ نتيجة مراجعة. اطلب الموافقة قبل تعديل الأصول. لم يُنسخ الإدخال الأصلي إلى المهمة.|مقارنة القوائم حساسة لحالة الأحرف. تُزال المسافات على الأطراف وتُتجاهل الأسطر الفارغة ويُحسب التكرار مرة واحدة.",
};
export const quickToolTranslations = Object.fromEntries(
  Object.entries(copy).map(([locale, value]) => [
    locale,
    Object.fromEntries(
      labels.map((label, index) => [label, value.split("|")[index]]),
    ),
  ]),
);

export const quickToolExamples = {
  csv: 'name,city,score\nAda,London,10\nLin,,8\nAda,London,10\n"Sam, Jr",Berlin,9',
  json: '{"project":"Example","tasks":[{"done":true},{"done":false}],"owner":null}',
  lists: ["alpha\nbeta\ngamma", "beta\ngamma\ndelta"],
};

export function formatQuickReport(mode, result, locale = "en") {
  const words = quickToolTranslations[locale] || quickToolTranslations.en;
  const word = (key) => words[key] || quickToolTranslations.en[key];
  const format = (key, ...values) =>
    values.reduce(
      (text, value, index) => text.replace(`{${index}}`, value),
      word(key),
    );
  if (mode === "csv") {
    const lines = [
      ["csvRows", result.rows],
      ["csvColumns", result.columns],
      ["csvWidth", result.widthErrors],
      ["csvDuplicates", result.duplicates],
      ["csvEmptyHeaders", result.emptyHeaders],
      ["csvDuplicateHeaders", result.duplicateHeaders],
    ];
    return {
      summary: format(
        "summaryCsv",
        result.rows,
        result.columns,
        result.duplicates,
      ),
      report: [
        ...lines.map(([key, value]) => `${word(key)}: ${value}`),
        "",
        word("csvMissing"),
        ...result.headers.map(
          (header, index) =>
            `${index + 1}. ${header || "(empty)"}: ${result.missing[index]}`,
        ),
      ].join("\n"),
    };
  }
  if (mode === "json") {
    return {
      summary: format("summaryJson", result.nodes, result.maxDepth),
      report: [
        `${word("jsonRoot")}: ${result.rootType}`,
        `${word("jsonNodes")}: ${result.nodes}`,
        `${word("jsonDepth")}: ${result.maxDepth}`,
        `${word("jsonKeys")}: ${result.keys.join(", ") || "—"}`,
        "",
        word("jsonTypes"),
        ...Object.entries(result.types).map(
          ([key, value]) => `${key}: ${value}`,
        ),
      ].join("\n"),
    };
  }
  if (mode === "lists") {
    return {
      summary: format(
        "summaryLists",
        result.onlyA.length,
        result.onlyB.length,
        result.common.length,
      ),
      report: [
        `${word("onlyA")} (${result.onlyA.length})`,
        ...result.onlyA,
        "",
        `${word("onlyB")} (${result.onlyB.length})`,
        ...result.onlyB,
        "",
        `${word("common")} (${result.common.length})`,
        ...result.common,
        "",
        word("listSemantics"),
      ].join("\n"),
    };
  }
  throw new Error("unknownMode");
}

if (typeof document !== "undefined" && document.getElementById("quick-form")) {
  const $ = (id) => document.getElementById(id);
  const picker = $("language");
  let locale = quickToolTranslations[picker.value] ? picker.value : "en";
  let mode = "csv";
  let report = "";
  let summary = "";
  const word = (key) =>
    quickToolTranslations[locale][key] || quickToolTranslations.en[key];
  const clearResult = () => {
    $("quick-result").hidden = true;
    $("quick-error").hidden = true;
    $("quick-status").textContent = "";
    report = "";
    summary = "";
  };
  function setMode(next) {
    mode = next;
    for (const button of document.querySelectorAll("[data-tool]"))
      button.setAttribute("aria-pressed", String(button.dataset.tool === mode));
    for (const panel of document.querySelectorAll("[data-tool-panel]"))
      panel.hidden = panel.dataset.toolPanel !== mode;
    $("quick-file-label").hidden = mode === "lists";
    $("quick-file").accept =
      mode === "json"
        ? ".json,application/json,text/plain"
        : ".csv,text/csv,text/plain";
    $("quick-file").value = "";
    clearResult();
  }
  function render() {
    for (const element of document.querySelectorAll("[data-quick]"))
      element.textContent = word(element.dataset.quick);
    $("quick-switch").setAttribute(
      "aria-label",
      `${word("csvTab")} / ${word("jsonTab")} / ${word("listsTab")}`,
    );
    if (report) $("quick-summary").textContent = summary;
  }
  function makeReport(result) {
    ({ summary, report } = formatQuickReport(mode, result, locale));
    $("quick-summary").textContent = summary;
    $("quick-report").textContent =
      report.length > 12000 ? `${report.slice(0, 12000)}\n…` : report;
    $("quick-result").hidden = false;
    $("quick-error").hidden = true;
  }
  document
    .querySelectorAll(".quick-switch [data-tool]")
    .forEach((button) =>
      button.addEventListener("click", () => setMode(button.dataset.tool)),
    );
  $("quick-sample").addEventListener("click", () => {
    if (mode === "csv") $("quick-csv").value = quickToolExamples.csv;
    if (mode === "json") $("quick-json").value = quickToolExamples.json;
    if (mode === "lists") {
      $("quick-list-a").value = quickToolExamples.lists[0];
      $("quick-list-b").value = quickToolExamples.lists[1];
    }
    clearResult();
  });
  $("quick-file").addEventListener("change", async () => {
    const file = $("quick-file").files?.[0];
    if (!file) return;
    clearResult();
    if (file.size > MAX_BYTES) {
      $("quick-error").textContent = word("fileSize");
      $("quick-error").hidden = false;
      return;
    }
    $(mode === "csv" ? "quick-csv" : "quick-json").value = await file.text();
  });
  $("quick-form").addEventListener("submit", (event) => {
    event.preventDefault();
    clearResult();
    try {
      const result =
        mode === "csv"
          ? auditCsv($("quick-csv").value)
          : mode === "json"
            ? auditJson($("quick-json").value)
            : compareLists($("quick-list-a").value, $("quick-list-b").value);
      makeReport(result);
    } catch (error) {
      $("quick-error").textContent = word(
        error.message === "size" ? "fileSize" : error.message,
      );
      $("quick-error").hidden = false;
    }
  });
  $("quick-download").addEventListener("click", () => {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([`${summary}\n\n${report}\n`], {
        type: "text/plain;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `agentic-${mode}-report.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("quick-status").textContent = word("downloaded");
  });
  $("quick-copy").addEventListener("click", async () => {
    if (!report) return;
    const task = `${word("taskIntro")} ${summary}\n\n${word("taskEnd")}`;
    try {
      await navigator.clipboard.writeText(task);
      $("quick-status").textContent = word("copied");
    } catch {
      $("quick-status").textContent = `${word("copyManual")} ${task}`;
    }
  });
  document.addEventListener("site:language", (event) => {
    locale = quickToolTranslations[event.detail] ? event.detail : "en";
    clearResult();
    render();
  });
  render();
}
