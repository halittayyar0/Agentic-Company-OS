"use strict";
const keys =
  "skip|eyebrow|title|intro|start|examples|ownership|caption|smallTitle|smallBody|repeatTitle|repeatBody|controlTitle|controlBody|setupLabel|setupTitle|setupIntro|download|step1Title|step1|step2Title|step2|step3Title|step3|examplesLabel|examplesTitle|examplesIntro|knowTitle|knowBody|native|phone|security|feedback".split(
    "|",
  );
const translations = {
  tr: "Kuruluma geç|AÇIK KAYNAK · KENDİ ÇALIŞMA ALANIN|İşi ver.\nKontrol sende.|Tek bir görev veya düzenli bir sorumluluk. Ajanlar araçlarla çalışır, sonuçları saklar ve seçtiğin sınırlarda onay ister.|Çalışma alanını kur|İlk görevini seç ↓|Windows, macOS ve Linux. Dosyaların, model hesabın ve kuralların sana ait.|Model bağlanmadan önce İngilizce Ana Sayfa önizlemesi. Seçtiğin dosyalar bu sekmede kalır; bu sayfa API anahtarını istemez.|Küçük başla.|Rutin işler ekonomik modelle başlar. Mevcut ajanlar tekrar kullanılır; görev dağıtımı sunucuda sınırlandırılır.|Düzenli sürdür.|Tekrarlanan iş bir sonraki zamanını bekler. Döngü ve son 24 saat sınırları, bildirilen kullanım bütçeye ulaşınca yeni model çağrılarını durdurur.|Ne olduğunu gör.|Dosyaları, görev geçmişini, onayları ve sonuçları incele. Salt okunur, onaylı, tam veya özel erişim seç.|BAŞLANGIÇ|Sana ait bir çalışma alanı.|Windows x64, macOS Intel veya Apple Silicon, Linux x64 veya ARM64 için hazır yerel arşivi indir.|İndirmeler ve sürüm notları ↗|Bilgisayarına uygun paketi seç|Node.js, PostgreSQL ve uygulama dahildir. Node.js, Docker, pnpm, Git veya PostgreSQL ayrıca kurulmaz. Sürümü ve dosya özetini kontrol et.|Kurulumu aç|Arşivin tamamını çıkar. Normal kullanıcı olarak Windows’ta START.cmd dosyasını aç; macOS/Linux’ta ./START.command çalıştır. Başlatıcı özel yerel tarayıcı bağlantısını açar ve terminale de yazar.|Dilini ve modelini seç|Dilini ve izinleri seç. Yapay zekâ işleri için yapılandırılmış Ollama veya sağlayıcı erişimi gerekir; model dosyaları ve sağlayıcı erişimi dahil değildir. Veri ve anahtarlar paketin dışında tutulur. Devam etmek için özel veri klasörünü ve orijinal paketi yerinde sakla.|İLK İŞİN|Faydalı bir sonuçla başla.|Bir örneği çalışma alanına kopyala, ayrıntıları kendine göre değiştir. Bu sayfada hiçbir görev çalıştırılmaz.|Başlamadan önce.|Her kurulum tek operatöre aittir. Bulut model ücretleri kendi sağlayıcı hesabındadır; kesin harcama sınırını orada belirle. Bildirilen kullanım sınırı başlamış bir isteği iptal edemez. Yerel model API token ücreti yerine donanımını kullanır. Telefon için özel HTTPS bağlantısı kullan; ayrı AgenticOS mobil uygulaması gerekmez.|Kurulum rehberi|Telefon erişimi|Güvenlik|Sorun bildir ↗",
  de: "Zur Einrichtung|OPEN SOURCE · DEIN ARBEITSBEREICH|Aufgabe geben.\nKontrolle behalten.|Ein Auftrag oder eine regelmäßige Verantwortung. Agenten nutzen Werkzeuge, speichern Ergebnisse und fragen an deinen gewählten Grenzen nach.|Arbeitsbereich einrichten|Erste Aufgabe finden ↓|Windows, macOS und Linux. Deine Dateien, dein Modellkonto, deine Regeln.|Vorschau der englischen Startseite vor dem Verbinden eines Modells. Ausgewählte Dateien bleiben in diesem Tab; diese Seite fragt nicht nach deinem API-Schlüssel.|Klein anfangen.|Routinearbeit startet mit einem sparsamen Modell. Vorhandene Agenten werden wiederverwendet; Delegation ist serverseitig begrenzt.|Im Rhythmus bleiben.|Wiederkehrende Arbeit wartet auf ihren Termin. Zyklus- und 24-Stunden-Limits stoppen weitere Modellaufrufe, wenn die gemeldete Nutzung das Budget erreicht.|Ergebnisse prüfen.|Dateien, Aufgabenverlauf, Freigaben und Ergebnisse ansehen. Lesezugriff, Freigaben, Vollzugriff oder eigene Regeln wählen.|ERSTE SCHRITTE|Dein eigener Arbeitsbereich.|Lade das native Archiv für Windows x64, macOS Intel oder Apple Silicon sowie Linux x64 oder ARM64 herunter.|Downloads und Versionshinweise ↗|Dein natives Paket wählen|Node.js, PostgreSQL und die App sind enthalten. Node.js, Docker, pnpm, Git und PostgreSQL müssen nicht separat installiert werden. Prüfe Version und Prüfsumme.|Installer öffnen|Entpacke das gesamte Archiv. Als normaler Benutzer: Windows START.cmd öffnen; macOS/Linux ./START.command ausführen. Der Launcher öffnet einen privaten lokalen Browserlink und zeigt ihn auch im Terminal.|Sprache und Modell wählen|Sprache und Berechtigungen wählen. KI-Aufgaben benötigen eingerichtetes Ollama oder Anbieterzugang; Modellgewichte und Anbieterzugang sind nicht enthalten. Daten und Schlüssel bleiben außerhalb des Pakets. Bewahre den privaten Datenordner und das ursprüngliche Paket am selben Ort für den Neustart auf.|DEINE ERSTE AUFGABE|Mit einem nützlichen Ergebnis beginnen.|Ein Beispiel in deinen Arbeitsbereich kopieren und anpassen. Auf dieser öffentlichen Seite wird nichts ausgeführt.|Vor dem Start.|Jede Installation gehört einem Betreiber. Cloud-Kosten trägt dein Anbieterkonto; dort ein festes Ausgabenlimit setzen. Gemeldete Nutzung kann laufende Anfragen nicht abbrechen. Lokale Modelle nutzen deine Hardware. Für das Telefon privates HTTPS verwenden; keine separate AgenticOS-App nötig.|Installationsanleitung|Telefonzugriff|Sicherheit|Problem melden ↗",
  ru: "К установке|ОТКРЫТЫЙ КОД · ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО|Дайте задачу.\nСохраните контроль.|Разовое задание или регулярная обязанность. Агенты используют инструменты, сохраняют результаты и запрашивают разрешение на выбранных вами границах.|Настроить пространство|Выбрать первую задачу ↓|Windows, macOS и Linux. Ваши файлы, модель и правила.|Предпросмотр главной страницы на английском до подключения модели. Выбранные файлы остаются в этой вкладке; страница не запрашивает API-ключ.|Начните с малого.|Простые задачи начинают с экономичной модели. Агенты используются повторно; делегирование ограничено сервером.|Работайте регулярно.|Повторяющиеся задачи ждут своего времени. Лимиты цикла и последних 24 часов прекращают новые вызовы при достижении бюджета по отчётам провайдера.|Проверяйте результат.|Просматривайте файлы, историю, разрешения и результаты. Выберите чтение, согласование, полный или особый доступ.|НАЧАЛО|Ваше собственное пространство.|Скачайте нативный архив для Windows x64, macOS Intel или Apple Silicon, Linux x64 или ARM64.|Загрузки и примечания к выпуску ↗|Выберите нативный пакет|Node.js, PostgreSQL и приложение включены. Отдельно устанавливать Node.js, Docker, pnpm, Git или PostgreSQL не нужно. Проверьте версию и контрольную сумму.|Откройте установщик|Распакуйте весь архив. От обычного пользователя откройте START.cmd в Windows или выполните ./START.command в macOS/Linux. Программа откроет приватную локальную ссылку в браузере и напечатает её в терминале.|Выберите язык и модель|Выберите язык и разрешения. ИИ-задачам нужны настроенный Ollama или доступ к провайдеру; веса моделей и доступ к провайдеру не включены. Данные и ключи хранятся вне пакета. Сохраните частную папку данных и исходный пакет на прежнем месте для продолжения.|ПЕРВОЕ ЗАДАНИЕ|Начните с полезного результата.|Скопируйте пример в своё пространство и измените детали. На этой странице задания не выполняются.|Перед началом.|Одна установка рассчитана на одного оператора. Расходы облачной модели относятся к вашему аккаунту; задайте жёсткий лимит у провайдера. Учёт расходов не отменяет уже начатые запросы. Локальные модели используют ваше оборудование. Для телефона используйте частный HTTPS; отдельное приложение AgenticOS не нужно.|Руководство по установке|Доступ с телефона|Безопасность|Сообщить о проблеме ↗",
  "zh-CN":
    "跳转到安装|开源 · 你的工作空间|交付任务。\n保留控制权。|一次性任务或定期职责。代理使用工具、保存结果，并在你设定的边界请求批准。|设置工作空间|选择第一个任务 ↓|Windows、macOS 和 Linux。你的文件、模型账户和规则。|连接模型前的英文主页预览。所选文件留在此标签页；本页不会索取 API 密钥。|从小任务开始。|常规工作从经济模型开始。优先复用现有代理，服务器限制任务委派。|按时持续工作。|定期任务等待下次执行时间。每轮和过去 24 小时的使用限额会在已报告用量达到预算时停止新模型调用。|查看实际结果。|查看文件、任务记录、批准和结果。选择只读、需批准、完全访问或自定义权限。|开始使用|属于你的工作空间。|下载适用于 Windows x64、macOS Intel 或 Apple Silicon、Linux x64 或 ARM64 的原生压缩包。|下载与发行说明 ↗|选择适合电脑的原生包|已包含 Node.js、PostgreSQL 和应用，无需另外安装 Node.js、Docker、pnpm、Git 或 PostgreSQL。请核对发布版本和校验和。|打开安装程序|解压整个压缩包。以普通用户在 Windows 打开 START.cmd，或在 macOS/Linux 运行 ./START.command。启动器会打开私有本地浏览器链接，并在终端打印备用链接。|选择语言和模型|选择语言和权限。AI 任务需要配置好的 Ollama 或服务商访问权限；包内不含模型权重或服务商访问权限。数据和密钥保存在包外。请将私有数据目录和原始包保留在原位置，以便恢复。|第一个任务|先获得一个有用的结果。|将示例复制到工作空间并修改细节。此公开页面不会运行任何任务。|开始前请了解。|每次安装仅供一位操作员使用。云模型费用由你的提供商账户承担，请在那里设置硬性支出限额。已报告用量限制无法取消已开始的请求。本地模型使用你的硬件。手机通过私有 HTTPS 访问，无需单独的 AgenticOS 应用。|安装指南|手机访问|安全|报告问题 ↗",
  "zh-TW":
    "跳至安裝|開源 · 你的工作空間|交付任務。\n保留控制權。|一次性任務或定期職責。代理使用工具、儲存結果，並在你設定的邊界請求核准。|設定工作空間|選擇第一個任務 ↓|Windows、macOS 和 Linux。你的檔案、模型帳戶與規則。|連接模型前的英文首頁預覽。所選檔案留在此分頁；本頁不會索取 API 金鑰。|從小任務開始。|日常工作從經濟模型開始。優先重用現有代理，伺服器限制任務委派。|按時持續工作。|定期任務等待下次執行時間。每輪與過去 24 小時的用量上限會在回報用量達到預算時停止新的模型呼叫。|查看實際結果。|查看檔案、任務記錄、核准與結果。選擇唯讀、需核准、完整存取或自訂權限。|開始使用|屬於你的工作空間。|下載適用於 Windows x64、macOS Intel 或 Apple Silicon、Linux x64 或 ARM64 的原生壓縮包。|下載與版本說明 ↗|選擇適合電腦的原生套件|已包含 Node.js、PostgreSQL 和應用程式，無需另外安裝 Node.js、Docker、pnpm、Git 或 PostgreSQL。請核對版本與校驗碼。|開啟安裝程式|解壓整個壓縮包。以一般使用者在 Windows 開啟 START.cmd，或在 macOS/Linux 執行 ./START.command。啟動器會開啟私人本機瀏覽器連結，並在終端機列印備用連結。|選擇語言與模型|選擇語言和權限。AI 任務需要設定好的 Ollama 或供應商存取權；套件不含模型權重或供應商存取權。資料和金鑰儲存在套件外。請將私人資料目錄和原始套件保留在原位置，以便接續。|第一個任務|先取得有用的結果。|將範例複製到工作空間並修改細節。此公開頁面不會執行任何任務。|開始前請了解。|每次安裝僅供一位操作員使用。雲端模型費用由你的供應商帳戶負擔，請在該處設定支出上限。回報用量限制無法取消已開始的請求。本機模型使用你的硬體。手機透過私人 HTTPS 存取，無需獨立的 AgenticOS 應用程式。|安裝指南|手機存取|安全|回報問題 ↗",
  ar: "انتقل إلى الإعداد|مفتوح المصدر · مساحة عملك الخاصة|أعطه مهمة.\nواحتفظ بالتحكم.|مهمة واحدة أو مسؤولية دورية. يستخدم الوكلاء الأدوات ويحفظون النتائج ويطلبون الموافقة عند الحدود التي تختارها.|إعداد مساحة العمل|اختر أول مهمة ↓|Windows وmacOS وLinux. ملفاتك وحساب النموذج وقواعدك.|معاينة الصفحة الرئيسية بالإنجليزية قبل ربط نموذج. تبقى الملفات التي تختارها في هذه التبويبة؛ لا تطلب الصفحة مفتاح API.|ابدأ بمهمة صغيرة.|يبدأ العمل المعتاد بنموذج اقتصادي. يُعاد استخدام الوكلاء وتُفرض حدود التفويض على الخادم.|حافظ على الانتظام.|ينتظر العمل المتكرر موعده التالي. توقف حدود الدورة وآخر 24 ساعة الاستدعاءات الجديدة عندما يبلغ الاستخدام المبلّغ الميزانية.|راجع ما حدث.|افحص الملفات وسجل المهام والموافقات والنتائج. اختر القراءة فقط أو الموافقة أو الوصول الكامل أو المخصص.|ابدأ الآن|مساحة عمل تخصك.|نزّل الأرشيف الأصلي لـWindows x64 أو macOS Intel أو Apple Silicon أو Linux x64 أو ARM64.|التنزيلات وملاحظات الإصدار ↗|اختر الحزمة الأصلية المناسبة|تتضمن الحزمة Node.js وPostgreSQL والتطبيق. لا تحتاج إلى تثبيت Node.js أو Docker أو pnpm أو Git أو PostgreSQL بشكل منفصل. تحقق من الإصدار ومجموع التحقق.|افتح المثبّت|فك الأرشيف بالكامل. كمستخدم عادي، افتح START.cmd في Windows أو شغّل ./START.command في macOS/Linux. يفتح المشغّل رابطاً محلياً خاصاً في المتصفح ويطبعه أيضاً في الطرفية.|اختر اللغة والنموذج|اختر اللغة والصلاحيات. تحتاج مهام الذكاء الاصطناعي إلى Ollama مُعدّ أو وصول لمزود؛ أوزان النماذج والوصول للمزود غير مضمنين. تُحفظ البيانات والمفاتيح خارج الحزمة. احتفظ بمجلد البيانات الخاص والحزمة الأصلية في موقعهما للمتابعة.|مهمتك الأولى|ابدأ بنتيجة مفيدة.|انسخ مثالاً إلى مساحة عملك وعدّل تفاصيله. لا تُنفّذ أي مهمة على هذه الصفحة العامة.|قبل البدء.|كل تثبيت مخصص لمشغّل واحد. تكاليف النماذج السحابية على حساب مزودك؛ اضبط حد الإنفاق الصارم هناك. حدود الاستخدام المبلّغ لا تلغي طلباً بدأ بالفعل. النماذج المحلية تستخدم عتادك. استخدم HTTPS خاصاً للهاتف؛ لا تحتاج تطبيق AgenticOS منفصلاً.|دليل التثبيت|الوصول من الهاتف|الأمان|الإبلاغ عن مشكلة ↗",
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
