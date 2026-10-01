"use strict";
const keys =
  "skip|eyebrow|title|intro|start|examples|ownership|caption|smallTitle|smallBody|repeatTitle|repeatBody|controlTitle|controlBody|setupLabel|setupTitle|setupIntro|download|step1Title|step1|step2Title|step2|step3Title|step3|examplesLabel|examplesTitle|examplesIntro|knowTitle|knowBody|native|phone|security|feedback".split(
    "|",
  );
const translations = {
  tr: "Kuruluma geç|AÇIK KAYNAK · KENDİ ÇALIŞMA ALANIN|İşi ver.\nKontrol sende.|Tek bir görev veya düzenli bir sorumluluk. Ajanlar araçlarla çalışır, sonuçları saklar ve seçtiğin sınırlarda onay ister.|Çalışma alanını kur|İlk görevini seç ↓|Windows, macOS ve Linux. Dosyaların, model hesabın ve kuralların sana ait.|Model bağlanmadan önce İngilizce Ana Sayfa önizlemesi. Seçtiğin dosyalar bu sekmede kalır; bu sayfa API anahtarını istemez.|Küçük başla.|Rutin işler ekonomik modelle başlar. Mevcut ajanlar tekrar kullanılır; görev dağıtımı sunucuda sınırlandırılır.|Düzenli sürdür.|Tekrarlanan iş bir sonraki zamanını bekler. Döngü ve son 24 saat sınırları, bildirilen kullanım bütçeye ulaşınca yeni model çağrılarını durdurur.|Ne olduğunu gör.|Dosyaları, görev geçmişini, onayları ve sonuçları incele. Salt okunur, onaylı, tam veya özel erişim seç.|BAŞLANGIÇ|Sana ait bir çalışma alanı.|Hazır konteyner paketini kullan veya kaynak kodu doğrudan bilgisayarına kur.|İndirmeler ve sürüm notları ↗|Bilgisayarını hazırla|Hazır paket: Node.js 24, çalışan Docker Linux motoru ve Compose v2. Git, pnpm ve kaynak derlemesi gerekmez. Yerel modeller ek bellek gerektirir.|Kurulumu aç|Kurulum paketini çıkar. Windows’ta START.cmd dosyasını aç; macOS/Linux’ta sh START.command çalıştır. Yazdırılan özel bağlantıyı aç.|Dilini ve modelini seç|İzinleri, araçları ve sağlayıcını seç. Kurulum veritabanını oluşturur ve sistemi doğrular. Yeniden başlatmak için özel kurulum klasörünü sakla.|İLK İŞİN|Faydalı bir sonuçla başla.|Bir örneği çalışma alanına kopyala, ayrıntıları kendine göre değiştir. Bu sayfada hiçbir görev çalıştırılmaz.|Başlamadan önce.|Her kurulum tek operatöre aittir. Bulut model ücretleri kendi sağlayıcı hesabındadır; kesin harcama sınırını orada belirle. Bildirilen kullanım sınırı başlamış bir isteği iptal edemez. Yerel model API token ücreti yerine donanımını kullanır. Telefon için özel HTTPS bağlantısı kullan; ayrı AgenticOS mobil uygulaması gerekmez.|Yerel kurulum|Telefon erişimi|Güvenlik|Sorun bildir ↗",
  de: "Zur Einrichtung|OPEN SOURCE · DEIN ARBEITSBEREICH|Aufgabe geben.\nKontrolle behalten.|Ein Auftrag oder eine regelmäßige Verantwortung. Agenten nutzen Werkzeuge, speichern Ergebnisse und fragen an deinen gewählten Grenzen nach.|Arbeitsbereich einrichten|Erste Aufgabe finden ↓|Windows, macOS und Linux. Deine Dateien, dein Modellkonto, deine Regeln.|Vorschau der englischen Startseite vor dem Verbinden eines Modells. Ausgewählte Dateien bleiben in diesem Tab; diese Seite fragt nicht nach deinem API-Schlüssel.|Klein anfangen.|Routinearbeit startet mit einem sparsamen Modell. Vorhandene Agenten werden wiederverwendet; Delegation ist serverseitig begrenzt.|Im Rhythmus bleiben.|Wiederkehrende Arbeit wartet auf ihren Termin. Zyklus- und 24-Stunden-Limits stoppen weitere Modellaufrufe, wenn die gemeldete Nutzung das Budget erreicht.|Ergebnisse prüfen.|Dateien, Aufgabenverlauf, Freigaben und Ergebnisse ansehen. Lesezugriff, Freigaben, Vollzugriff oder eigene Regeln wählen.|ERSTE SCHRITTE|Dein eigener Arbeitsbereich.|Nutze das fertige Containerpaket oder installiere den Quellcode direkt.|Downloads und Versionshinweise ↗|Computer vorbereiten|Fertiges Paket: Node.js 24 und laufendes Docker mit Linux-Engine und Compose v2. Kein Git, pnpm oder Quellcode-Build. Lokale Modelle benötigen zusätzlichen Speicher.|Installer öffnen|Paket entpacken. Windows: START.cmd öffnen. macOS/Linux: sh START.command ausführen. Den angezeigten privaten Link öffnen.|Sprache und Modell wählen|Berechtigungen, Werkzeuge und Anbieter auswählen. Der Installer erstellt die Datenbank und prüft den Arbeitsbereich. Installationsordner für den Neustart aufbewahren.|DEINE ERSTE AUFGABE|Mit einem nützlichen Ergebnis beginnen.|Ein Beispiel in deinen Arbeitsbereich kopieren und anpassen. Auf dieser öffentlichen Seite wird nichts ausgeführt.|Vor dem Start.|Jede Installation gehört einem Betreiber. Cloud-Kosten trägt dein Anbieterkonto; dort ein festes Ausgabenlimit setzen. Gemeldete Nutzung kann laufende Anfragen nicht abbrechen. Lokale Modelle nutzen deine Hardware. Für das Telefon privates HTTPS verwenden; keine separate AgenticOS-App nötig.|Native Installation|Telefonzugriff|Sicherheit|Problem melden ↗",
  ru: "К установке|ОТКРЫТЫЙ КОД · ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО|Дайте задачу.\nСохраните контроль.|Разовое задание или регулярная обязанность. Агенты используют инструменты, сохраняют результаты и запрашивают разрешение на выбранных вами границах.|Настроить пространство|Выбрать первую задачу ↓|Windows, macOS и Linux. Ваши файлы, модель и правила.|Предпросмотр главной страницы на английском до подключения модели. Выбранные файлы остаются в этой вкладке; страница не запрашивает API-ключ.|Начните с малого.|Простые задачи начинают с экономичной модели. Агенты используются повторно; делегирование ограничено сервером.|Работайте регулярно.|Повторяющиеся задачи ждут своего времени. Лимиты цикла и последних 24 часов прекращают новые вызовы при достижении бюджета по отчётам провайдера.|Проверяйте результат.|Просматривайте файлы, историю, разрешения и результаты. Выберите чтение, согласование, полный или особый доступ.|НАЧАЛО|Ваше собственное пространство.|Используйте готовый контейнер или установите исходный код напрямую.|Загрузки и примечания к выпуску ↗|Подготовьте компьютер|Готовый пакет: Node.js 24, работающий Docker с Linux и Compose v2. Git, pnpm и сборка не нужны. Локальным моделям нужна дополнительная память.|Откройте установщик|Распакуйте пакет. Windows: откройте START.cmd. macOS/Linux: выполните sh START.command. Откройте выведенную частную ссылку.|Выберите язык и модель|Выберите разрешения, инструменты и провайдера. Установщик создаст базу и проверит пространство. Сохраните папку установки для перезапуска.|ПЕРВОЕ ЗАДАНИЕ|Начните с полезного результата.|Скопируйте пример в своё пространство и измените детали. На этой странице задания не выполняются.|Перед началом.|Одна установка рассчитана на одного оператора. Расходы облачной модели относятся к вашему аккаунту; задайте жёсткий лимит у провайдера. Учёт расходов не отменяет уже начатые запросы. Локальные модели используют ваше оборудование. Для телефона используйте частный HTTPS; отдельное приложение AgenticOS не нужно.|Локальная установка|Доступ с телефона|Безопасность|Сообщить о проблеме ↗",
  "zh-CN":
    "跳转到安装|开源 · 你的工作空间|交付任务。\n保留控制权。|一次性任务或定期职责。代理使用工具、保存结果，并在你设定的边界请求批准。|设置工作空间|选择第一个任务 ↓|Windows、macOS 和 Linux。你的文件、模型账户和规则。|连接模型前的英文主页预览。所选文件留在此标签页；本页不会索取 API 密钥。|从小任务开始。|常规工作从经济模型开始。优先复用现有代理，服务器限制任务委派。|按时持续工作。|定期任务等待下次执行时间。每轮和过去 24 小时的使用限额会在已报告用量达到预算时停止新模型调用。|查看实际结果。|查看文件、任务记录、批准和结果。选择只读、需批准、完全访问或自定义权限。|开始使用|属于你的工作空间。|使用预构建容器包，或直接安装源代码。|下载与发行说明 ↗|准备计算机|预构建包需要 Node.js 24、运行中的 Docker Linux 引擎和 Compose v2。无需 Git、pnpm 或编译源代码。本地模型需要额外内存。|打开安装程序|解压安装包。Windows 打开 START.cmd；macOS/Linux 运行 sh START.command。打开程序显示的私有链接。|选择语言和模型|选择权限、工具和提供商。安装程序创建数据库并验证工作空间。保留私有安装目录以便重启。|第一个任务|先获得一个有用的结果。|将示例复制到工作空间并修改细节。此公开页面不会运行任何任务。|开始前请了解。|每次安装仅供一位操作员使用。云模型费用由你的提供商账户承担，请在那里设置硬性支出限额。已报告用量限制无法取消已开始的请求。本地模型使用你的硬件。手机通过私有 HTTPS 访问，无需单独的 AgenticOS 应用。|本地安装|手机访问|安全|报告问题 ↗",
  "zh-TW":
    "跳至安裝|開源 · 你的工作空間|交付任務。\n保留控制權。|一次性任務或定期職責。代理使用工具、儲存結果，並在你設定的邊界請求核准。|設定工作空間|選擇第一個任務 ↓|Windows、macOS 和 Linux。你的檔案、模型帳戶與規則。|連接模型前的英文首頁預覽。所選檔案留在此分頁；本頁不會索取 API 金鑰。|從小任務開始。|日常工作從經濟模型開始。優先重用現有代理，伺服器限制任務委派。|按時持續工作。|定期任務等待下次執行時間。每輪與過去 24 小時的用量上限會在回報用量達到預算時停止新的模型呼叫。|查看實際結果。|查看檔案、任務記錄、核准與結果。選擇唯讀、需核准、完整存取或自訂權限。|開始使用|屬於你的工作空間。|使用預先建置的容器套件，或直接安裝原始碼。|下載與版本說明 ↗|準備電腦|預建套件需要 Node.js 24、執行中的 Docker Linux 引擎與 Compose v2。無需 Git、pnpm 或編譯原始碼。本機模型需要額外記憶體。|開啟安裝程式|解壓縮套件。Windows 開啟 START.cmd；macOS/Linux 執行 sh START.command。開啟程式顯示的私人連結。|選擇語言與模型|選擇權限、工具與供應商。安裝程式建立資料庫並驗證工作空間。保留私人安裝目錄以便重新啟動。|第一個任務|先取得有用的結果。|將範例複製到工作空間並修改細節。此公開頁面不會執行任何任務。|開始前請了解。|每次安裝僅供一位操作員使用。雲端模型費用由你的供應商帳戶負擔，請在該處設定支出上限。回報用量限制無法取消已開始的請求。本機模型使用你的硬體。手機透過私人 HTTPS 存取，無需獨立的 AgenticOS 應用程式。|本機安裝|手機存取|安全|回報問題 ↗",
  ar: "انتقل إلى الإعداد|مفتوح المصدر · مساحة عملك الخاصة|أعطه مهمة.\nواحتفظ بالتحكم.|مهمة واحدة أو مسؤولية دورية. يستخدم الوكلاء الأدوات ويحفظون النتائج ويطلبون الموافقة عند الحدود التي تختارها.|إعداد مساحة العمل|اختر أول مهمة ↓|Windows وmacOS وLinux. ملفاتك وحساب النموذج وقواعدك.|معاينة الصفحة الرئيسية بالإنجليزية قبل ربط نموذج. تبقى الملفات التي تختارها في هذه التبويبة؛ لا تطلب الصفحة مفتاح API.|ابدأ بمهمة صغيرة.|يبدأ العمل المعتاد بنموذج اقتصادي. يُعاد استخدام الوكلاء وتُفرض حدود التفويض على الخادم.|حافظ على الانتظام.|ينتظر العمل المتكرر موعده التالي. توقف حدود الدورة وآخر 24 ساعة الاستدعاءات الجديدة عندما يبلغ الاستخدام المبلّغ الميزانية.|راجع ما حدث.|افحص الملفات وسجل المهام والموافقات والنتائج. اختر القراءة فقط أو الموافقة أو الوصول الكامل أو المخصص.|ابدأ الآن|مساحة عمل تخصك.|استخدم حزمة الحاوية الجاهزة أو ثبّت المصدر مباشرة على جهازك.|التنزيلات وملاحظات الإصدار ↗|جهّز الكمبيوتر|تحتاج الحزمة الجاهزة Node.js 24 ومحرك Docker يعمل بنظام Linux مع Compose v2. لا حاجة إلى Git أو pnpm أو بناء المصدر. تحتاج النماذج المحلية ذاكرة إضافية.|افتح المثبّت|فك ضغط الحزمة. في Windows افتح START.cmd؛ في macOS/Linux شغّل sh START.command. افتح الرابط الخاص الذي يظهر.|اختر اللغة والنموذج|اختر الصلاحيات والأدوات والمزود. ينشئ المثبّت قاعدة البيانات ويتحقق من مساحة العمل. احتفظ بمجلد التثبيت الخاص لإعادة التشغيل.|مهمتك الأولى|ابدأ بنتيجة مفيدة.|انسخ مثالاً إلى مساحة عملك وعدّل تفاصيله. لا تُنفّذ أي مهمة على هذه الصفحة العامة.|قبل البدء.|كل تثبيت مخصص لمشغّل واحد. تكاليف النماذج السحابية على حساب مزودك؛ اضبط حد الإنفاق الصارم هناك. حدود الاستخدام المبلّغ لا تلغي طلباً بدأ بالفعل. النماذج المحلية تستخدم عتادك. استخدم HTTPS خاصاً للهاتف؛ لا تحتاج تطبيق AgenticOS منفصلاً.|التثبيت المحلي|الوصول من الهاتف|الأمان|الإبلاغ عن مشكلة ↗",
};
const english = Object.fromEntries(
  [...document.querySelectorAll("[data-i18n]")].map((el) => [
    el.dataset.i18n,
    el.innerText,
  ]),
);
const recipeWords = {
  en: [
    "Copy task",
    "Copied. Paste it into your workspace.",
    "Copy manually:",
    "A source-backed brief",
    "Compare three options for [topic]. Use primary sources, show links and dates, and deliver a one-page comparison. Reuse one agent unless independent work is necessary.",
    "Clean a data file",
    "Inspect [CSV file]. Report missing values and duplicates. Save a cleaned copy without changing the original, and verify row counts.",
    "A recurring watch",
    "Every 24 hours, check [public page] for changes. Save a dated summary only when something meaningful changes. Finish each cycle and wait for the next scheduled time. Do not contact anyone or publish externally.",
  ],
  tr: [
    "Görevi kopyala",
    "Kopyalandı. Çalışma alanına yapıştır.",
    "Elle kopyala:",
    "Kaynaklı kısa rapor",
    "[Konu] için üç seçeneği karşılaştır. Birincil kaynaklar, bağlantılar ve tarihlerle bir sayfalık rapor hazırla. Bağımsız iş gerekmedikçe tek ajan kullan.",
    "Veri dosyasını düzenle",
    "[CSV dosyası] içindeki eksik ve yinelenen verileri raporla. Aslına dokunmadan temizlenmiş kopyayı kaydet; satır sayılarını doğrula.",
    "Düzenli takip",
    "24 saatte bir [açık web sayfası] üzerindeki değişiklikleri kontrol et. Yalnız anlamlı değişiklikte tarihli özet kaydet. Her döngüyü tamamla, sonrakini zamanlayıcıya bırak. Kimseye mesaj gönderme veya dışarıya yayımlama.",
  ],
  de: [
    "Aufgabe kopieren",
    "Kopiert. Im Arbeitsbereich einfügen.",
    "Manuell kopieren:",
    "Bericht mit Quellen",
    "Vergleiche drei Optionen für [Thema]. Nutze Primärquellen mit Links und Datum. Liefere eine Seite; verwende einen Agenten, solange keine unabhängige Teilaufgabe nötig ist.",
    "Datendatei bereinigen",
    "Prüfe [CSV-Datei] auf fehlende Werte und Duplikate. Speichere eine bereinigte Kopie, erhalte das Original und prüfe die Zeilenzahlen.",
    "Regelmäßige Beobachtung",
    "Prüfe [öffentliche Webseite] alle 24 Stunden auf Änderungen. Speichere nur bei relevanten Änderungen einen datierten Bericht. Beende jeden Durchlauf und warte auf den nächsten Termin. Kontaktiere niemanden und veröffentliche nichts extern.",
  ],
  ru: [
    "Копировать задание",
    "Скопировано. Вставьте в рабочее пространство.",
    "Скопируйте вручную:",
    "Отчёт с источниками",
    "Сравни три варианта для [темы]. Используй первоисточники, ссылки и даты. Подготовь отчёт на одну страницу; используй одного агента, если нет независимых подзадач.",
    "Очистка данных",
    "Проверь [CSV-файл] на пропуски и дубликаты. Сохрани очищенную копию, не меняя оригинал, и проверь число строк.",
    "Регулярное наблюдение",
    "Каждые 24 часа проверяй изменения на [публичной странице]. Сохраняй датированный отчёт только при значимых изменениях. Заверши цикл и жди следующего времени. Никому не пиши и ничего не публикуй вовне.",
  ],
  "zh-CN": [
    "复制任务",
    "已复制，请粘贴到工作空间。",
    "手动复制：",
    "有来源的简报",
    "比较[主题]的三个选项。使用一手来源、链接和日期，交付一页报告。除非有独立子任务，否则使用一个代理。",
    "清理数据文件",
    "检查[CSV 文件]的缺失值和重复项。保留原文件，另存清理后的副本并核对行数。",
    "定期监测",
    "每 24 小时检查[公开网页]的变化。仅在有实质变化时保存带日期的摘要。完成每轮任务并等待下次计划时间。不要联系他人或向外发布。",
  ],
  "zh-TW": [
    "複製任務",
    "已複製，請貼到工作空間。",
    "手動複製：",
    "附來源的簡報",
    "比較[主題]的三個選項。使用第一手來源、連結與日期，交付一頁報告。除非有獨立子任務，否則使用一個代理。",
    "清理資料檔案",
    "檢查[CSV 檔案]的缺漏值與重複項目。保留原檔，另存清理後的副本並核對列數。",
    "定期監測",
    "每 24 小時檢查[公開網頁]的變化。僅在有實質變更時儲存附日期的摘要。完成每輪任務並等待下次排程。不要聯絡他人或對外發布。",
  ],
  ar: [
    "نسخ المهمة",
    "تم النسخ. الصقها في مساحة عملك.",
    "انسخ يدوياً:",
    "تقرير موثق",
    "قارن ثلاثة خيارات حول [الموضوع]. استخدم مصادر أولية وروابط وتواريخ وقدّم صفحة واحدة. استخدم وكيلاً واحداً ما لم توجد مهمة مستقلة.",
    "تنظيف ملف بيانات",
    "افحص [ملف CSV] بحثاً عن القيم المفقودة والتكرارات. احفظ نسخة منظفة دون تغيير الأصل وتحقق من عدد الصفوف.",
    "متابعة دورية",
    "كل 24 ساعة افحص التغييرات على [صفحة عامة]. احفظ ملخصاً مؤرخاً فقط عند تغير مهم. أكمل الدورة وانتظر الموعد التالي. لا تراسل أحداً ولا تنشر خارجياً.",
  ],
};
function render(locale) {
  const values = translations[locale]?.split("|");
  const copy = values
    ? Object.fromEntries(keys.map((key, index) => [key, values[index]]))
    : english;
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = copy[el.dataset.i18n] ?? english[el.dataset.i18n];
  });
  const words = recipeWords[locale] ?? recipeWords.en;
  const recipes = document.getElementById("recipes");
  recipes.replaceChildren();
  for (let index = 3; index < words.length; index += 2) {
    const row = document.createElement("article");
    row.className = "recipe";
    const text = document.createElement("div"),
      heading = document.createElement("h3"),
      paragraph = document.createElement("p"),
      button = document.createElement("button");
    heading.textContent = words[index];
    paragraph.textContent = words[index + 1];
    button.textContent = words[0];
    button.type = "button";
    button.addEventListener("click", async () => {
      const status = document.getElementById("copy-status");
      try {
        await navigator.clipboard.writeText(words[index + 1]);
        status.textContent = words[1];
      } catch {
        status.textContent = `${words[2]} ${words[index + 1]}`;
      }
    });
    text.append(heading, paragraph);
    row.append(text, button);
    recipes.append(row);
  }
  document.getElementById("copy-status").textContent = "";
  document.dispatchEvent(new CustomEvent("site:language", { detail: locale }));
  try {
    localStorage.setItem("agentic-site-language", locale);
  } catch {}
}
const picker = document.getElementById("language");
let preferred = navigator.language;
try {
  preferred = localStorage.getItem("agentic-site-language") || preferred;
} catch {}
if (!recipeWords[preferred])
  preferred = recipeWords[preferred.split("-")[0]]
    ? preferred.split("-")[0]
    : "en";
picker.value = preferred;
picker.addEventListener("change", () => render(picker.value));
render(preferred);
