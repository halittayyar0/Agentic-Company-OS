(() => {
  "use strict";
  const keys =
    "setup|title|intro|destination|native|nativeHelp|container|containerHelp|access|read_only|approval|full_access|custom|accessHelp|provider|later|database|key|port|packs|data|documents|web|code|planning|phone|local|private_network|phoneHelp|review|secrets|open|back|next|install|checking|ready|unavailable|error|installing|complete|failed|session".split(
      "|",
    );
  const words = {
    en: "SETUP|Your workspace. Your rules.|Choose where your agents work and what they can do.|Where should it run?|On this computer|Run directly on Windows, macOS or Linux. Requires PostgreSQL.|In a container|Run the app and its database together with Docker.|Agent access|Read only|Ask for approval|Full access|Custom|Access applies within the configured workspace and operating-system permissions.|AI provider|Set up later|PostgreSQL connection URL|API key|Local port|Tool packs|Data|Documents|Web|Code|Planning|Phone access|This computer only|Private network|Use your phone’s browser. Private network access needs a configured connection; no phone app is required.|Review installation|Credentials stay in this installation’s private directory. They are never included in the summary.|Open workspace|Back|Continue|Install|Checking this computer…|Ready to continue.|Prerequisites are missing. Check Node 24 for native installation or a running Docker Linux engine with Compose v2.|Unable to continue. Check your entries and connection, then try again.|Installing…|Installation verified.|Installation stopped. Your saved configuration is retained; check the installer before starting again.|Open the setup link printed by the launcher to use this session.",
    tr: "KURULUM|Senin alanın. Senin kuralların.|Ajanların nerede çalışacağını ve neler yapabileceğini seç.|Nereye kurulsun?|Bu bilgisayara|Windows, macOS veya Linux üzerinde doğrudan çalışır. PostgreSQL gerekir.|Container içine|Uygulama ve veritabanını Docker ile birlikte çalıştır.|Ajan erişimi|Salt okunur|Onay iste|Tam erişim|Özel|Erişim, belirlenen çalışma alanı ve işletim sistemi izinleri içinde geçerlidir.|Yapay zekâ sağlayıcısı|Daha sonra ayarla|PostgreSQL bağlantı adresi|API anahtarı|Yerel bağlantı noktası|Araç paketleri|Veri|Belgeler|Web|Kod|Planlama|Telefon erişimi|Yalnızca bu bilgisayar|Özel ağ|Telefonunun tarayıcısını kullan. Özel ağ erişimi için bağlantı yapılandırılması gerekir; telefon uygulaması gerekmez.|Kurulumu gözden geçir|Anahtarlar bu kuruluma ait özel klasörde tutulur. Özete hiçbir zaman eklenmez.|Çalışma alanını aç|Geri|Devam|Kur|Bilgisayar kontrol ediliyor…|Devam etmeye hazır.|Gereksinimler eksik. Doğrudan kurulum için Node 24; container için çalışan Docker Linux motoru ve Compose v2 gerekir.|Devam edilemedi. Bilgileri ve bağlantıyı kontrol edip yeniden dene.|Kuruluyor…|Kurulum doğrulandı.|Kurulum durdu. Kaydedilen yapılandırma korundu; yeniden başlatmadan önce kurulum aracını kontrol et.|Bu oturumu kullanmak için başlatıcının verdiği kurulum bağlantısını aç.",
    de: "EINRICHTUNG|Dein Arbeitsbereich. Deine Regeln.|Wähle, wo deine Agenten arbeiten und was sie tun dürfen.|Wo soll es laufen?|Auf diesem Computer|Direkt unter Windows, macOS oder Linux. PostgreSQL erforderlich.|In einem Container|App und Datenbank gemeinsam mit Docker betreiben.|Agentenzugriff|Nur lesen|Genehmigung anfordern|Vollzugriff|Benutzerdefiniert|Der Zugriff gilt innerhalb des Arbeitsbereichs und der Betriebssystemrechte.|KI-Anbieter|Später einrichten|PostgreSQL-Verbindungsadresse|API-Schlüssel|Lokaler Port|Werkzeugpakete|Daten|Dokumente|Web|Code|Planung|Telefonzugriff|Nur dieser Computer|Privates Netzwerk|Nutze den Browser deines Telefons. Ein privates Netzwerk erfordert eine eingerichtete Verbindung; keine Telefon-App nötig.|Installation prüfen|Zugangsdaten bleiben im privaten Installationsordner und erscheinen nie in der Übersicht.|Arbeitsbereich öffnen|Zurück|Weiter|Installieren|Computer wird geprüft…|Bereit zum Fortfahren.|Voraussetzungen fehlen. Prüfe Node 24 oder eine laufende Docker-Linux-Engine mit Compose v2.|Fortfahren nicht möglich. Prüfe Eingaben und Verbindung und versuche es erneut.|Installation läuft…|Installation überprüft.|Installation angehalten. Die Konfiguration bleibt erhalten; prüfe das Installationsprogramm vor einem Neustart.|Öffne den vom Startprogramm ausgegebenen Einrichtungslink.",
    ru: "УСТАНОВКА|Ваше пространство. Ваши правила.|Выберите, где работают агенты и что им разрешено.|Где запустить?|На этом компьютере|Работа напрямую в Windows, macOS или Linux. Требуется PostgreSQL.|В контейнере|Приложение и база данных вместе в Docker.|Доступ агентов|Только чтение|Запрашивать разрешение|Полный доступ|Настроить|Доступ ограничен рабочим пространством и правами операционной системы.|Провайдер ИИ|Настроить позже|Адрес подключения PostgreSQL|Ключ API|Локальный порт|Наборы инструментов|Данные|Документы|Веб|Код|Планирование|Доступ с телефона|Только этот компьютер|Частная сеть|Используйте браузер телефона. Для частной сети нужно настроенное соединение; мобильное приложение не требуется.|Проверка установки|Учётные данные хранятся в закрытой папке установки и не попадают в сводку.|Открыть пространство|Назад|Продолжить|Установить|Проверка компьютера…|Можно продолжить.|Не выполнены требования. Проверьте Node 24 либо работающий Docker с Linux и Compose v2.|Не удалось продолжить. Проверьте данные и соединение, затем повторите.|Установка…|Установка проверена.|Установка остановлена. Конфигурация сохранена; проверьте установщик перед повторным запуском.|Откройте ссылку установки, выданную программой запуска.",
    "zh-CN":
      "安装|你的工作空间，由你做主。|选择智能体的运行位置和操作权限。|安装在哪里？|这台电脑|直接在 Windows、macOS 或 Linux 上运行，需要 PostgreSQL。|容器中|使用 Docker 一起运行应用和数据库。|智能体权限|只读|请求批准|完全访问|自定义|访问范围受工作空间和操作系统权限限制。|AI 服务商|稍后设置|PostgreSQL 连接地址|API 密钥|本地端口|工具包|数据|文档|网页|代码|规划|手机访问|仅这台电脑|私有网络|使用手机浏览器。私有网络访问需要配置连接，无需手机应用。|确认安装|凭据保存在此安装的私有目录中，不会显示在摘要中。|打开工作空间|返回|继续|安装|正在检查电脑…|可以继续。|缺少必要条件。请检查 Node 24，或运行中的 Docker Linux 引擎及 Compose v2。|无法继续。请检查输入和连接后重试。|正在安装…|安装已验证。|安装已停止。配置已保存；再次启动前请检查安装程序。|请打开启动程序提供的安装链接。",
    "zh-TW":
      "安裝|你的工作空間，由你做主。|選擇代理的執行位置和操作權限。|安裝在哪裡？|這台電腦|直接在 Windows、macOS 或 Linux 上執行，需要 PostgreSQL。|容器中|使用 Docker 一起執行應用程式和資料庫。|代理權限|唯讀|要求核准|完整存取|自訂|存取範圍受工作空間和作業系統權限限制。|AI 服務供應商|稍後設定|PostgreSQL 連線位址|API 金鑰|本機連接埠|工具套件|資料|文件|網頁|程式碼|規劃|手機存取|僅這台電腦|私人網路|使用手機瀏覽器。私人網路存取需要設定連線，無需手機應用程式。|確認安裝|憑證儲存在此安裝的私人目錄中，不會顯示在摘要中。|開啟工作空間|返回|繼續|安裝|正在檢查電腦…|可以繼續。|缺少必要條件。請檢查 Node 24，或執行中的 Docker Linux 引擎及 Compose v2。|無法繼續。請檢查輸入和連線後重試。|正在安裝…|安裝已驗證。|安裝已停止。設定已保留；再次啟動前請檢查安裝程式。|請開啟啟動程式提供的安裝連結。",
    ar: "الإعداد|مساحتك. قواعدك.|اختر مكان عمل الوكلاء وما يمكنهم فعله.|أين تريد التشغيل؟|على هذا الكمبيوتر|تشغيل مباشر على Windows أو macOS أو Linux. يتطلب PostgreSQL.|داخل حاوية|شغّل التطبيق وقاعدة البيانات معًا باستخدام Docker.|صلاحيات الوكلاء|قراءة فقط|طلب الموافقة|وصول كامل|مخصص|يقتصر الوصول على مساحة العمل وصلاحيات نظام التشغيل.|مزود الذكاء الاصطناعي|الإعداد لاحقًا|عنوان اتصال PostgreSQL|مفتاح API|المنفذ المحلي|حزم الأدوات|البيانات|المستندات|الويب|البرمجة|التخطيط|الوصول من الهاتف|هذا الكمبيوتر فقط|شبكة خاصة|استخدم متصفح هاتفك. تحتاج الشبكة الخاصة إلى اتصال مُعدّ مسبقًا؛ لا حاجة إلى تطبيق هاتف.|مراجعة التثبيت|تبقى بيانات الدخول في مجلد التثبيت الخاص ولا تظهر في الملخص.|فتح مساحة العمل|رجوع|متابعة|تثبيت|جارٍ فحص الكمبيوتر…|جاهز للمتابعة.|المتطلبات غير مكتملة. تحقق من Node 24 أو محرك Docker يعمل بنظام Linux مع Compose v2.|تعذرت المتابعة. تحقق من البيانات والاتصال ثم حاول مجددًا.|جارٍ التثبيت…|تم التحقق من التثبيت.|توقف التثبيت. تم الاحتفاظ بالإعدادات؛ افحص أداة التثبيت قبل البدء مجددًا.|افتح رابط الإعداد الذي يعرضه برنامج التشغيل.",
  };
  const permissionKeys = ["files", "terminal", "browser", "delegation", "sudo"];
  const permissionWords = {
    tr: [
      "Dosya değişiklikleri",
      "Komut çalıştırma",
      "Tarayıcı işlemleri",
      "Ekip ve görev oluşturma",
      "Yükseltilmiş komutlar",
    ],
    en: [
      "File changes",
      "Run commands",
      "Browser actions",
      "Create teams and tasks",
      "Elevated commands",
    ],
    de: [
      "Dateiänderungen",
      "Befehle ausführen",
      "Browseraktionen",
      "Teams und Aufgaben erstellen",
      "Erhöhte Befehle",
    ],
    ru: [
      "Изменение файлов",
      "Выполнение команд",
      "Действия браузера",
      "Создание команд и задач",
      "Команды с повышенными правами",
    ],
    "zh-CN": [
      "修改文件",
      "执行命令",
      "浏览器操作",
      "创建团队和任务",
      "提权命令",
    ],
    "zh-TW": [
      "修改檔案",
      "執行命令",
      "瀏覽器操作",
      "建立團隊和任務",
      "提升權限命令",
    ],
    ar: [
      "تعديل الملفات",
      "تنفيذ الأوامر",
      "إجراءات المتصفح",
      "إنشاء الفرق والمهام",
      "أوامر بصلاحيات مرتفعة",
    ],
  };
  const $ = (id) => document.getElementById(id);
  const form = $("setup-form");
  const token = location.hash.slice(1);
  // The bearer never enters a query string, browser storage, form field or log.
  history.replaceState(null, "", location.pathname);
  let stage = 0,
    capabilities = null,
    plan = null,
    busy = false;
  let copy = {};
  const value = (name) => new FormData(form).get(name);
  function translate() {
    const locale = $("language").value;
    copy = Object.fromEntries(
      keys.map((key, index) => [key, words[locale].split("|")[index]]),
    );
    const connectionWords = {
      tr: [
        "Erişim anahtarını göster",
        "Telefon bağlantısını aç",
        "Bu anahtarı giriş ekranına yapıştır. Güvenli bir yerde sakla.",
      ],
      en: [
        "Show access key",
        "Open phone connection",
        "Paste this key into the sign-in screen. Store it in a safe place.",
      ],
      de: [
        "Zugangsschlüssel anzeigen",
        "Telefonverbindung öffnen",
        "Diesen Schlüssel im Anmeldebildschirm einfügen und sicher aufbewahren.",
      ],
      ru: [
        "Показать ключ доступа",
        "Открыть ссылку для телефона",
        "Вставьте ключ на экране входа и сохраните его в безопасном месте.",
      ],
      "zh-CN": [
        "显示访问密钥",
        "打开手机连接",
        "将此密钥粘贴到登录页面，并妥善保存。",
      ],
      "zh-TW": [
        "顯示存取金鑰",
        "開啟手機連線",
        "將此金鑰貼到登入頁面，並妥善保存。",
      ],
      ar: [
        "عرض مفتاح الوصول",
        "فتح رابط الهاتف",
        "ألصق هذا المفتاح في شاشة تسجيل الدخول واحفظه في مكان آمن.",
      ],
    };
    [copy.connection, copy.phoneLink, copy.connectionHint] =
      connectionWords[locale];
    const phoneRequirements = {
      tr: "Özel ağ için bilgisayar/sunucu ve telefonda aynı Tailscale ağına bağlan. HTTPS açık olmalı. Ek telefon uygulaması geliştirmiyoruz; arayüz tarayıcıda açılır.",
      en: "For private access, connect this computer/server and your phone to the same Tailscale network and enable HTTPS. The workspace opens in your phone browser.",
      de: "Computer/Server und Telefon müssen mit demselben Tailscale-Netzwerk verbunden sein; HTTPS muss aktiviert sein. Der Arbeitsbereich öffnet sich im Telefonbrowser.",
      ru: "Подключите компьютер/сервер и телефон к одной сети Tailscale и включите HTTPS. Пространство открывается в браузере телефона.",
      "zh-CN":
        "请将电脑/服务器和手机连接到同一 Tailscale 网络并启用 HTTPS。工作空间在手机浏览器中打开。",
      "zh-TW":
        "請將電腦/伺服器和手機連線至同一 Tailscale 網路並啟用 HTTPS。工作空間在手機瀏覽器中開啟。",
      ar: "اربط الكمبيوتر أو الخادم والهاتف بشبكة Tailscale نفسها وفعّل HTTPS. تفتح مساحة العمل في متصفح الهاتف.",
    };
    copy.phoneHelp = phoneRequirements[locale];
    permissionKeys.forEach((key, index) => {
      copy[`permission_${key}`] = permissionWords[locale][index];
    });
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    document.querySelectorAll("[data-copy]").forEach((element) => {
      element.textContent = copy[element.dataset.copy];
    });
    $("progress").setAttribute("aria-label", copy.installing);
    draw();
  }
  function draw() {
    form.elements
      .namedItem("phoneAccess")
      .querySelector('[value="private_network"]').disabled =
      !capabilities?.phone?.ready;
    for (const [index, id] of [
      "destination",
      "preferences",
      "review",
      "progress-panel",
    ].entries())
      $(id).hidden = index !== stage;
    $("back").hidden = stage === 0 || stage === 3;
    $("back").disabled = busy;
    $("language").disabled = busy || stage === 3;
    $("next").hidden = stage === 3;
    $("next").textContent = stage === 2 ? copy.install : copy.next;
    $("next").disabled =
      busy || !capabilities || !capabilities[value("mode")].ready;
    $("requirements").textContent = !capabilities
      ? copy.checking
      : capabilities[value("mode")].ready
        ? copy.ready
        : copy.unavailable;
    $("database-field").hidden = value("mode") !== "native";
    $("custom-fields").hidden = value("accessMode") !== "custom";
    $("key-field").hidden = !["openai", "openrouter"].includes(
      value("provider"),
    );
    $("ollama-field").hidden = value("provider") !== "ollama";
    for (const [name, id] of [
      ["databaseUrl", "database-field"],
      ["providerKey", "key-field"],
      ["ollamaUrl", "ollama-field"],
    ]) {
      form.elements.namedItem(name).required = stage === 1 && !$(id).hidden;
    }
    if (stage === 2 && plan) {
      $("summary").replaceChildren();
      for (const [label, text] of [
        ["destination", copy[plan.settings.mode]],
        [
          "access",
          copy[plan.settings.accessMode] +
            (plan.settings.accessMode === "custom"
              ? ": " +
                (permissionKeys
                  .filter((key) => plan.settings.customPermissions[key])
                  .map((key) => copy[`permission_${key}`])
                  .join(", ") || "—")
              : ""),
        ],
        ["provider", copy[plan.settings.provider] || plan.settings.provider],
        ["port", plan.settings.port],
        [
          "packs",
          plan.settings.toolPacks.map((key) => copy[key]).join(", ") || "—",
        ],
        ["phone", copy[plan.settings.phoneAccess]],
      ]) {
        const dt = document.createElement("dt"),
          dd = document.createElement("dd");
        dt.textContent = copy[label];
        dd.textContent = String(text);
        $("summary").append(dt, dd);
      }
    }
  }
  async function api(path, data) {
    const response = await fetch(`/api/${path}`, {
      method: data ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(data ? { "content-type": "application/json" } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (!response.ok)
      throw new Error(response.status === 401 ? "session" : "error");
    return response.json();
  }
  function settings() {
    return {
      mode: value("mode"),
      locale: $("language").value,
      accessMode: value("accessMode"),
      provider: value("provider"),
      port: Number(value("port")),
      phoneAccess: value("phoneAccess"),
      toolPacks: new FormData(form).getAll("toolPacks"),
      ...(value("accessMode") === "custom"
        ? {
            customPermissions: Object.fromEntries(
              permissionKeys.map((key) => [
                key,
                new FormData(form).getAll("customPermission").includes(key),
              ]),
            ),
          }
        : {}),
    };
  }
  async function poll() {
    try {
      const state = await api("state");
      $("phase").textContent = copy[state.phase] || copy.installing;
      $("step").textContent =
        `${state.completedSteps.length} / ${plan ? plan.steps.length : "…"}`;
      if (state.phase === "complete") {
        $("progress").value = 1;
        const url = new URL(state.url);
        if (url.protocol === "http:" && url.hostname === "127.0.0.1") {
          $("open").href = url.href;
          $("open").hidden = false;
        }
        $("connection").hidden = !state.connectionAvailable;
        if (state.phoneUrl) {
          const phone = new URL(state.phoneUrl);
          if (
            phone.protocol === "https:" &&
            phone.hostname.endsWith(".ts.net") &&
            phone.port === "8443"
          ) {
            $("phone-link").href = phone.href;
            $("phone-link").hidden = false;
          }
        }
      } else if (state.phase === "failed") {
        $("progress").hidden = true;
      } else {
        setTimeout(poll, 1200);
      }
    } catch (error) {
      $("error").textContent = copy[error.message] || copy.error;
    }
  }
  $("language").addEventListener("change", () => {
    plan = null;
    if (stage === 2) stage = 1;
    translate();
  });
  $("connection").addEventListener("click", async () => {
    $("connection").disabled = true;
    try {
      const value = await api("connection", {});
      $("operator-key").value = value.operatorToken;
      $("connection-field").hidden = false;
      $("connection").hidden = true;
      $("operator-key").focus();
      $("operator-key").select();
    } catch {
      $("error").textContent = copy.error;
    }
  });
  form.addEventListener("change", draw);
  $("back").addEventListener("click", () => {
    stage--;
    plan = null;
    draw();
    $("heading").focus();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || stage === 3) return;
    $("error").textContent = "";
    busy = true;
    draw();
    try {
      if (stage === 0) stage = 1;
      else if (stage === 1) {
        const selected = settings();
        const result = await api("plan", selected);
        if (JSON.stringify(selected) !== JSON.stringify(settings()))
          throw new Error("error");
        plan = result;
        stage = 2;
      } else {
        const credentials = {};
        if (plan.settings.mode === "native")
          credentials.databaseUrl = value("databaseUrl");
        if (["openai", "openrouter"].includes(plan.settings.provider))
          credentials.providerKey = value("providerKey");
        if (plan.settings.provider === "ollama")
          credentials.ollamaUrl = value("ollamaUrl");
        await api("install", { planId: plan.id, credentials });
        form.elements.namedItem("databaseUrl").value = "";
        form.elements.namedItem("providerKey").value = "";
        stage = 3;
        $("language").disabled = true;
        void poll();
      }
      $("heading").focus();
    } catch (error) {
      $("error").textContent = copy[error.message] || copy.error;
    } finally {
      busy = false;
      draw();
    }
  });
  const locale = navigator.language;
  if (Object.hasOwn(words, locale)) $("language").value = locale;
  else if (Object.hasOwn(words, locale.split("-")[0]))
    $("language").value = locale.split("-")[0];
  translate();
  if (!token) {
    $("error").textContent = copy.session;
    return;
  }
  api("capabilities")
    .then((result) => {
      capabilities = result;
      draw();
    })
    .catch((error) => {
      $("error").textContent = copy[error.message] || copy.error;
    });
})();
