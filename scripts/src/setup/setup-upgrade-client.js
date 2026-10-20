/* Standalone installer controller: no app runtime, external assets or storage. */
globalThis.initializeSetupUpgrade = function ({ api, language, freshForm }) {
  const keys =
    "title|lead|existing|path|pathHelp|find|fresh|keep|from|to|data|preserve|close|update|recover|retry|paused|open|check|checking|copying|migrating|qualifying|promoting|recovering|opening|complete|failed|cancelled|stale|notFound|session|offline|cancel|stopping|key|keyHint|hide|language|recoveryLead|restart".split(
      "|",
    );
  const words = {
    en: "Update your workspace|Keep your work, connections and rules while updating the app.|Update an existing workspace|Existing installation folder|Usually found automatically. If needed, paste the full instance folder path from your previous setup.|Find workspace|Back to new setup|To keep the current version, close this setup and open its original START file.|Current version|New version|Your data folder|Tasks, files, connections, permissions and cost limits stay with this workspace. A private copy of the original database is retained.|Close the previous START window before continuing. Keep this new window open until the update finishes.|Update workspace|Continue recovery|Prepare a new copy|Work is paused. Open the workspace, review the result and resume work when ready.|Open workspace|Check again|Checking the installation…|Copying your data|Verifying and updating the copy…|Checking the verified copy…|Switching to the updated workspace. Let this step finish.|Recovering the saved update. Let this step finish.|Opening the updated workspace…|Update verified|The update stopped. Your data is retained. Check the previous START window and data folder, then check again.|Preparation stopped. Your data is retained. Check again to continue safely.|The installation changed since review. Check it again before continuing.|No eligible workspace was found. Check the instance folder or use the original package.|Open the original private setup link from the launcher to continue.|Could not reach the installer. Keep the launcher open and check progress again.|Stop preparing|Stopping preparation…|Show connection key|Use this key only if the workspace asks you to sign in. Keep it private.|Hide key|Language|A previous update did not finish. Continue from its saved state; your original data is retained.|If the update finished but the workspace did not open, close this launcher and run the new START again. For an expired setup link, restart START to get a new private link.",
    tr: "Çalışma alanını güncelle|Uygulamayı güncellerken işlerini, bağlantılarını ve kurallarını koru.|Mevcut çalışma alanını güncelle|Mevcut kurulum klasörü|Genellikle otomatik bulunur. Gerekirse önceki kurulumdaki instance klasörünün tam yolunu yapıştır.|Çalışma alanını bul|Yeni kuruluma dön|Mevcut sürümü kullanmak için bu kurulumu kapatıp onun asıl START dosyasını aç.|Mevcut sürüm|Yeni sürüm|Veri klasörün|Görevler, dosyalar, bağlantılar, izinler ve maliyet sınırları korunur. Asıl veritabanının özel bir kopyası saklanır.|Devam etmeden önce eski START penceresini kapat. Güncelleme bitene kadar bu yeni pencereyi açık tut.|Çalışma alanını güncelle|Kurtarmaya devam et|Yeni kopya hazırla|İşler duraklatıldı. Çalışma alanını aç, sonucu incele ve hazır olduğunda işleri sürdür.|Çalışma alanını aç|Tekrar kontrol et|Kurulum kontrol ediliyor…|Verilerin kopyalanıyor|Kopya doğrulanıyor ve güncelleniyor…|Doğrulanan kopya kontrol ediliyor…|Güncellenen çalışma alanına geçiliyor. Bu adımın bitmesini bekle.|Kaydedilen güncelleme kurtarılıyor. Bu adımın bitmesini bekle.|Güncellenen çalışma alanı açılıyor…|Güncelleme doğrulandı|Güncelleme durdu. Verilerin saklanıyor. Eski START penceresini ve veri klasörünü kontrol edip tekrar denetle.|Hazırlık durduruldu. Verilerin saklanıyor. Güvenle devam etmek için tekrar kontrol et.|İncelemeden sonra kurulum değişti. Devam etmeden önce tekrar kontrol et.|Uygun çalışma alanı bulunamadı. Instance klasörünü kontrol et veya asıl paketi kullan.|Devam etmek için başlatıcıdaki asıl özel kurulum bağlantısını aç.|Kurulum programına ulaşılamadı. Başlatıcıyı açık tut ve ilerlemeyi tekrar kontrol et.|Hazırlığı durdur|Hazırlık durduruluyor…|Bağlantı anahtarını göster|Bu anahtarı yalnız çalışma alanı giriş isterse kullan. Gizli tut.|Anahtarı gizle|Dil|Önceki güncelleme tamamlanmadı. Kaydedilen durumdan devam et; asıl verilerin saklanıyor.|Güncelleme bittiği halde çalışma alanı açılmadıysa başlatıcıyı kapatıp yeni START dosyasını tekrar çalıştır. Kurulum bağlantısı süresi dolduysa yeni özel bağlantı için START dosyasını yeniden başlat.",
    de: "Arbeitsbereich aktualisieren|Arbeit, Verbindungen und Regeln bleiben beim Aktualisieren erhalten.|Vorhandenen Arbeitsbereich aktualisieren|Ordner der bestehenden Installation|Wird normalerweise automatisch gefunden. Füge bei Bedarf den vollständigen Pfad zum bisherigen instance-Ordner ein.|Arbeitsbereich finden|Zur neuen Einrichtung|Um die bisherige Version zu verwenden, schließe diese Einrichtung und öffne ihre ursprüngliche START-Datei.|Bisherige Version|Neue Version|Dein Datenordner|Aufgaben, Dateien, Verbindungen, Berechtigungen und Kostenlimits bleiben erhalten. Eine private Kopie der ursprünglichen Datenbank wird aufbewahrt.|Schließe zuerst das bisherige START-Fenster. Lass dieses neue Fenster bis zum Ende der Aktualisierung geöffnet.|Arbeitsbereich aktualisieren|Wiederherstellung fortsetzen|Neue Kopie vorbereiten|Die Arbeit ist pausiert. Öffne den Arbeitsbereich, prüfe das Ergebnis und setze die Arbeit fort, wenn du bereit bist.|Arbeitsbereich öffnen|Erneut prüfen|Installation wird geprüft…|Daten werden kopiert|Kopie wird geprüft und aktualisiert…|Verifizierte Kopie wird geprüft…|Der aktualisierte Arbeitsbereich wird übernommen. Lass diesen Schritt abschließen.|Die gespeicherte Aktualisierung wird wiederhergestellt. Lass diesen Schritt abschließen.|Aktualisierter Arbeitsbereich wird geöffnet…|Aktualisierung geprüft|Die Aktualisierung wurde angehalten. Deine Daten bleiben erhalten. Prüfe das bisherige START-Fenster und den Datenordner und prüfe erneut.|Vorbereitung angehalten. Deine Daten bleiben erhalten. Prüfe erneut, um sicher fortzufahren.|Die Installation hat sich seit der Prüfung geändert. Prüfe sie vor dem Fortfahren erneut.|Kein geeigneter Arbeitsbereich gefunden. Prüfe den instance-Ordner oder verwende das ursprüngliche Paket.|Öffne zum Fortfahren den ursprünglichen privaten Einrichtungslink aus dem Startfenster.|Der Installer ist nicht erreichbar. Lass das Startfenster geöffnet und prüfe den Fortschritt erneut.|Vorbereitung anhalten|Vorbereitung wird angehalten…|Verbindungsschlüssel anzeigen|Verwende diesen Schlüssel nur, wenn der Arbeitsbereich zur Anmeldung auffordert. Halte ihn geheim.|Schlüssel verbergen|Sprache|Eine frühere Aktualisierung wurde nicht abgeschlossen. Setze sie am gespeicherten Stand fort; die ursprünglichen Daten bleiben erhalten.|Wenn die Aktualisierung fertig ist, aber der Arbeitsbereich nicht öffnet, schließe das Startfenster und starte die neue START-Datei erneut. Ist der Einrichtungslink abgelaufen, starte START für einen neuen privaten Link erneut.",
    ru: "Обновить рабочее пространство|Сохраните работу, подключения и правила при обновлении приложения.|Обновить существующее пространство|Папка существующей установки|Обычно находится автоматически. При необходимости вставьте полный путь к прежней папке instance.|Найти пространство|Вернуться к новой установке|Чтобы использовать прежнюю версию, закройте эту установку и откройте её исходный файл START.|Текущая версия|Новая версия|Ваша папка данных|Задачи, файлы, подключения, права и ограничения расходов сохраняются. Приватная копия исходной базы данных остаётся на диске.|Сначала закройте прежнее окно START. Оставьте новое окно открытым до завершения обновления.|Обновить пространство|Продолжить восстановление|Подготовить новую копию|Работа приостановлена. Откройте пространство, проверьте результат и продолжите работу, когда будете готовы.|Открыть пространство|Проверить ещё раз|Проверка установки…|Копирование данных|Проверка и обновление копии…|Проверка подтверждённой копии…|Переход к обновлённому пространству. Дождитесь завершения этого шага.|Восстановление сохранённого обновления. Дождитесь завершения этого шага.|Открытие обновлённого пространства…|Обновление проверено|Обновление остановилось. Данные сохранены. Проверьте прежнее окно START и папку данных, затем повторите проверку.|Подготовка остановлена. Данные сохранены. Проверьте ещё раз для безопасного продолжения.|Установка изменилась после проверки. Проверьте её заново перед продолжением.|Подходящее пространство не найдено. Проверьте папку instance или используйте исходный пакет.|Для продолжения откройте исходную приватную ссылку установки из окна запуска.|Нет связи с установщиком. Не закрывайте окно запуска и снова проверьте ход обновления.|Остановить подготовку|Остановка подготовки…|Показать ключ подключения|Используйте ключ, только если пространство запросит вход. Храните его в секрете.|Скрыть ключ|Язык|Предыдущее обновление не завершилось. Продолжите с сохранённого состояния; исходные данные сохранены.|Если обновление завершилось, но пространство не открылось, закройте окно запуска и снова откройте новый START. Если срок ссылки истёк, перезапустите START для новой приватной ссылки.",
    "zh-CN":
      "更新工作区|更新应用，同时保留工作、连接和权限设置。|更新现有工作区|现有安装文件夹|通常会自动找到。如有需要，请粘贴原安装中 instance 文件夹的完整路径。|查找工作区|返回新安装|如需继续使用当前版本，请关闭此安装程序并打开原版本的 START 文件。|当前版本|新版本|数据文件夹|任务、文件、连接、权限和费用限制都会保留。原数据库的私有副本也会保留。|继续前请关闭原来的 START 窗口。更新结束前请保持这个新窗口打开。|更新工作区|继续恢复|准备新副本|工作已暂停。请打开工作区，检查结果，准备好后再恢复工作。|打开工作区|重新检查|正在检查安装…|正在复制数据|正在验证并更新副本…|正在检查已验证的副本…|正在切换到更新后的工作区，请等待此步骤完成。|正在恢复已保存的更新，请等待此步骤完成。|正在打开更新后的工作区…|更新已验证|更新已停止，数据仍然保留。请检查原来的 START 窗口和数据文件夹，然后重新检查。|准备已停止，数据仍然保留。请重新检查后安全继续。|安装在检查后发生了变化，请重新检查后再继续。|未找到可更新的工作区。请检查 instance 文件夹或使用原安装包。|请打开启动器显示的原始私有安装链接以继续。|无法连接安装程序。请保持启动器打开并重新检查进度。|停止准备|正在停止准备…|显示连接密钥|仅在工作区要求登录时使用此密钥，请妥善保密。|隐藏密钥|语言|先前的更新尚未完成，请从已保存的状态继续，原始数据仍然保留。|如果更新已完成但工作区未打开，请关闭启动器并重新运行新版 START。如果安装链接已过期，请重启 START 获取新的私有链接。",
    "zh-TW":
      "更新工作區|更新應用程式，同時保留工作、連線和權限設定。|更新現有工作區|現有安裝資料夾|通常會自動找到。如有需要，請貼上原安裝中 instance 資料夾的完整路徑。|尋找工作區|返回新安裝|如需繼續使用目前版本，請關閉此安裝程式並開啟原版本的 START 檔案。|目前版本|新版本|資料資料夾|任務、檔案、連線、權限和費用限制都會保留。原資料庫的私有副本也會保留。|繼續前請關閉原來的 START 視窗。更新結束前請保持這個新視窗開啟。|更新工作區|繼續復原|準備新副本|工作已暫停。請開啟工作區、檢查結果，準備好後再恢復工作。|開啟工作區|重新檢查|正在檢查安裝…|正在複製資料|正在驗證並更新副本…|正在檢查已驗證的副本…|正在切換到更新後的工作區，請等待此步驟完成。|正在復原已儲存的更新，請等待此步驟完成。|正在開啟更新後的工作區…|更新已驗證|更新已停止，資料仍然保留。請檢查原來的 START 視窗和資料夾，然後重新檢查。|準備已停止，資料仍然保留。請重新檢查後安全繼續。|檢查後安裝內容已變更，請重新檢查後再繼續。|找不到可更新的工作區。請檢查 instance 資料夾或使用原安裝套件。|請開啟啟動器顯示的原始私有安裝連結以繼續。|無法連線到安裝程式。請保持啟動器開啟並重新檢查進度。|停止準備|正在停止準備…|顯示連線金鑰|只在工作區要求登入時使用此金鑰，請妥善保密。|隱藏金鑰|語言|先前的更新尚未完成，請從已儲存的狀態繼續，原始資料仍然保留。|如果更新已完成但工作區未開啟，請關閉啟動器並重新執行新版 START。如果安裝連結已過期，請重新啟動 START 取得新的私有連結。",
    ar: "تحديث مساحة العمل|احتفظ بالعمل والاتصالات والصلاحيات عند تحديث التطبيق.|تحديث مساحة عمل موجودة|مجلد التثبيت الحالي|يُعثر عليه تلقائيًا عادةً. عند الحاجة، الصق المسار الكامل لمجلد instance من التثبيت السابق.|العثور على مساحة العمل|العودة إلى إعداد جديد|لاستخدام الإصدار الحالي، أغلق هذا الإعداد وافتح ملف START الأصلي الخاص به.|الإصدار الحالي|الإصدار الجديد|مجلد بياناتك|تُحفظ المهام والملفات والاتصالات والصلاحيات وحدود التكلفة. تُحفظ أيضًا نسخة خاصة من قاعدة البيانات الأصلية.|أغلق نافذة START السابقة أولًا. أبقِ هذه النافذة الجديدة مفتوحة حتى يكتمل التحديث.|تحديث مساحة العمل|متابعة الاستعادة|إعداد نسخة جديدة|العمل متوقف مؤقتًا. افتح المساحة وراجع النتيجة ثم استأنف العمل عندما تكون مستعدًا.|فتح مساحة العمل|التحقق مجددًا|جارٍ فحص التثبيت…|جارٍ نسخ البيانات|جارٍ التحقق من النسخة وتحديثها…|جارٍ فحص النسخة الموثقة…|جارٍ الانتقال إلى المساحة المحدّثة. انتظر اكتمال هذه الخطوة.|جارٍ استعادة التحديث المحفوظ. انتظر اكتمال هذه الخطوة.|جارٍ فتح المساحة المحدّثة…|تم التحقق من التحديث|توقف التحديث مع الاحتفاظ ببياناتك. افحص نافذة START السابقة ومجلد البيانات ثم تحقق مجددًا.|توقف الإعداد مع الاحتفاظ ببياناتك. تحقق مجددًا للمتابعة بأمان.|تغير التثبيت بعد المراجعة. تحقق منه مجددًا قبل المتابعة.|لم يُعثر على مساحة مناسبة للتحديث. افحص مجلد instance أو استخدم الحزمة الأصلية.|افتح رابط الإعداد الخاص الأصلي من نافذة التشغيل للمتابعة.|تعذر الاتصال بالمثبّت. أبقِ نافذة التشغيل مفتوحة وتحقق من التقدم مجددًا.|إيقاف الإعداد|جارٍ إيقاف الإعداد…|إظهار مفتاح الاتصال|استخدم هذا المفتاح فقط إذا طلبت مساحة العمل تسجيل الدخول. احتفظ به سرًا.|إخفاء المفتاح|اللغة|لم يكتمل تحديث سابق. تابع من الحالة المحفوظة؛ بياناتك الأصلية محفوظة.|إذا اكتمل التحديث ولم تفتح المساحة، أغلق نافذة التشغيل وشغّل ملف START الجديد مجددًا. إذا انتهت صلاحية رابط الإعداد، أعد تشغيل START للحصول على رابط خاص جديد.",
  };
  const $ = (id) => document.getElementById(`upgrade-${id}`);
  const root = $("panel"),
    title = document.getElementById("heading");
  const intro = document.querySelector('[data-copy="intro"]');
  let review = null,
    state = null,
    busy = false,
    selected = false,
    freshAvailable = true,
    timer;
  let failure = "",
    keyLoaded = false,
    alive = true;
  const copy = () =>
    Object.fromEntries(
      keys.map((key, index) => [
        key,
        (words[language.value] || words.en).split("|")[index],
      ]),
    );
  function select(active) {
    selected = active;
    root.hidden = !active;
    freshForm.hidden = active;
    intro.hidden = active;
    document.getElementById("status").hidden = active;
    document.getElementById("error").hidden = active;
    if (active) title.textContent = copy().title;
  }
  function render() {
    const text = copy();
    root.querySelectorAll("[data-upgrade-copy]").forEach((node) => {
      node.textContent = text[node.dataset.upgradeCopy];
    });
    language.setAttribute("aria-label", text.language);
    $("existing").textContent = text.existing;
    $("existing").hidden = selected;
    if (!selected) return;
    title.textContent = text.title;
    document.title = `${text.title} — Agentic Company OS`;
    $("error").textContent = failure ? text[failure] || text.failed : "";
    $("lookup").hidden = Boolean(review);
    $("review").hidden = !review;
    $("fresh").hidden = !freshAvailable;
    $("keep").hidden = freshAvailable;
    const running = state?.phase === "installing",
      complete = state?.phase === "complete",
      failed = state?.phase === "failed";
    $("lead").textContent =
      review && review.mode !== "upgrade" ? text.recoveryLead : text.lead;
    if (review) {
      $("source-version").textContent = review.sourceVersion;
      $("target-version").textContent = review.targetVersion;
      $("directory").textContent = review.directory;
      $("confirm").textContent =
        text[
          review.mode === "recover"
            ? "recover"
            : review.mode === "retry"
              ? "retry"
              : "update"
        ];
    }
    $("confirm").hidden = !review || running || complete || failed;
    $("confirm").disabled = busy;
    $("find").disabled = busy;
    $("fresh").disabled = busy || running || complete;
    $("close").hidden = running || complete;
    $("progress-panel").hidden = !running && !complete && !failed && !busy;
    $("cancel").hidden = !running;
    $("cancel").disabled = busy || !state?.upgrade?.canCancel;
    $("paused").hidden = !complete;
    $("check").hidden = !failed && !failure;
    $("check").disabled = busy;
    $("restart").hidden = !failed && !failure;
    $("open").hidden = true;
    $("connection").hidden =
      !complete || (!state.connectionAvailable && !keyLoaded);
    $("key-field").hidden = !keyLoaded;
    $("connection").textContent =
      keyLoaded && $("key").type === "text" ? text.hide : text.key;
    let progress = text.checking;
    if (complete) progress = text.complete;
    else if (failed)
      progress =
        text[
          state.error === "upgrade_cancelled"
            ? "cancelled"
            : state.error === "upgrade_review_changed"
              ? "stale"
              : "failed"
        ];
    else if (running) {
      progress = state.upgrade?.cancelRequested
        ? text.stopping
        : text[
            state.upgrade?.phase === "complete"
              ? "opening"
              : state.upgrade?.phase
          ] || text.checking;
      if (
        state.upgrade?.phase === "copying" &&
        Number.isSafeInteger(state.upgrade.copiedFiles)
      )
        progress += ` · ${new Intl.NumberFormat(language.value).format(state.upgrade.copiedFiles)}`;
    }
    $("progress-text").textContent = progress;
    root.setAttribute("aria-busy", String(busy));
    if (complete && state.url) {
      try {
        const url = new URL(state.url);
        if (
          url.protocol === "http:" &&
          url.hostname === "127.0.0.1" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        ) {
          $("open").href = url.href;
          $("open").hidden = false;
        }
      } catch {
        /* invalid links stay hidden */
      }
    }
  }
  const errorCopy = (error) =>
    error.message === "session"
      ? "session"
      : error.message === "review_changed" ||
          error.message === "native_upgrade_review_changed"
        ? "stale"
        : "offline";
  async function poll() {
    clearTimeout(timer);
    try {
      state = await api("state");
      if (state.operation === "upgrade" && state.upgrade) {
        review = state.upgrade;
        failure = "";
        select(true);
        render();
      }
      if (state.phase === "installing" && alive) timer = setTimeout(poll, 1200);
    } catch (error) {
      failure = errorCopy(error);
      render();
    }
  }
  async function inspect(input = {}, automatic = false) {
    if (busy || state?.phase === "installing") return;
    busy = true;
    failure = "";
    review = null;
    state = null;
    select(true);
    render();
    try {
      const value = await api("upgrade/review", input);
      if (value.id) {
        review = value;
        $("path").setAttribute("aria-invalid", "false");
      } else if (automatic && freshAvailable) {
        select(false);
        language.dispatchEvent(new Event("change"));
      } else failure = "notFound";
    } catch (error) {
      failure = error.message === "session" ? "session" : "notFound";
      $("path").setAttribute("aria-invalid", "true");
    } finally {
      busy = false;
      render();
    }
  }
  $("lookup").addEventListener("submit", async (event) => {
    event.preventDefault();
    await inspect(
      $("path").value.trim() ? { directory: $("path").value.trim() } : {},
    );
    if (!review) $("path").focus();
    else $("confirm").focus();
  });
  $("path").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.isComposing) event.preventDefault();
  });
  $("existing").addEventListener("click", () => {
    select(true);
    render();
    $("path").focus();
  });
  $("fresh").addEventListener("click", async () => {
    if (busy || state?.phase === "installing") return;
    try {
      if (review) await api("upgrade/dismiss", { reviewId: review.id });
      review = null;
      state = null;
      failure = "";
      select(false);
      language.dispatchEvent(new Event("change"));
      title.focus();
    } catch (error) {
      failure = errorCopy(error);
      render();
    }
  });
  $("confirm").addEventListener("click", async () => {
    if (busy || !review || state?.phase === "installing") return;
    busy = true;
    failure = "";
    render();
    try {
      state = await api("upgrade/install", { reviewId: review.id });
    } catch (error) {
      failure = errorCopy(error);
    } finally {
      busy = false;
      await poll();
      render();
    }
  });
  $("cancel").addEventListener("click", async () => {
    if (busy || !state?.upgrade?.canCancel) return;
    busy = true;
    render();
    try {
      await api("upgrade/cancel", {});
    } catch (error) {
      failure = errorCopy(error);
    } finally {
      busy = false;
      await poll();
    }
  });
  $("check").addEventListener("click", async () => {
    if (busy) return;
    if (state?.phase === "installing") {
      await poll();
      return;
    }
    await inspect(
      review?.directory
        ? { directory: review.directory }
        : $("path").value.trim()
          ? { directory: $("path").value.trim() }
          : {},
    );
  });
  $("connection").addEventListener("click", async () => {
    if (busy) return;
    if (keyLoaded) {
      $("key").type = $("key").type === "password" ? "text" : "password";
      render();
      return;
    }
    busy = true;
    render();
    try {
      const value = await api("connection", {});
      $("key").value = value.operatorToken;
      keyLoaded = true;
      $("key").type = "text";
    } catch (error) {
      failure = errorCopy(error);
    } finally {
      busy = false;
      render();
      if (keyLoaded) {
        $("key").focus();
        $("key").select();
      }
    }
  });
  let localeSave = Promise.resolve(),
    restoringLocale = false;
  language.addEventListener("change", () => {
    render();
    if (restoringLocale) return;
    const locale = language.value;
    localeSave = localeSave
      .catch(() => {})
      .then(() => api("locale", { locale }))
      .catch((error) => {
        failure = errorCopy(error);
        render();
      });
  });
  window.addEventListener("pagehide", () => {
    alive = false;
    clearTimeout(timer);
  });
  return {
    async start() {
      freshForm.hidden = true;
      try {
        const support = await api("upgrade");
        if (!support.available) {
          select(false);
          return;
        }
        freshAvailable = support.freshAvailable !== false;
        $("existing").hidden = false;
        const current = await api("state");
        if (words[current.uiLocale]) {
          restoringLocale = true;
          language.value = current.uiLocale;
          language.dispatchEvent(new Event("change"));
          restoringLocale = false;
        }
        if (current.operation === "upgrade" && current.upgrade) {
          state = current;
          review = current.upgrade;
          select(true);
          render();
          if (current.phase === "installing") void poll();
        } else await inspect({}, true);
      } catch (error) {
        select(true);
        failure = errorCopy(error);
        render();
      }
    },
  };
};
