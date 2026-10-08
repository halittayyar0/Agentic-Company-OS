import type { WorkspaceLocale } from "./workspace-locale";
const copy = {
  tr: {
    admission: "Codex görev kabulü",
    workspace: "Codex çalışma alanı",
    interrupted:
      "Başlatılan Codex turu güvenle tamamlanmış olarak kaydedilemedi. Devam etmeden önce gözlenen işlemleri, kullanım kaydını ve dosyaları incele; belirsiz işi otomatik tekrarlama.",
    description:
      "İsteğe bağlı Codex çalışma ortamında bu görevin bir kodlama turunu çalıştırır. Kurulum ve çalışma alanı yalıtımı çıkarım başlamadan doğrulanır; desteklenmiyorsa durur. Tamamlanan tur teslimatın doğrulandığı anlamına gelmez.",
    invalid:
      "Yalnızca yapılacak işi içeren prompt alanını ver. Çalışma alanını, hesabı ve izinleri sunucu belirler.",
    unavailable:
      "Bu görev için Codex çalışma ortamı kullanılamıyor. Desteklenmeyen kurulum veya değişen yetkiyle devam edilmedi.",
    completed:
      "Codex kodlama turu sona erdi. Dosyaları ve gerekli kontrolleri inceleyerek teslimatı ayrıca doğrula.",
  },
  en: {
    admission: "Codex task admission",
    workspace: "Codex workspace",
    interrupted:
      "The started Codex turn could not be safely checkpointed. Inspect observed actions, usage and files before continuing; do not automatically repeat uncertain work.",
    description:
      "Run one coding turn for this task in the optional Codex runtime. Installation and workspace containment are checked before inference; unsupported setups stop. An ended turn does not verify the deliverable.",
    invalid:
      "Provide only the prompt describing the work. The server selects the workspace, account and permissions.",
    unavailable:
      "The Codex runtime is unavailable for this task. Execution stopped for an unsupported setup or changed authority.",
    completed:
      "The Codex coding turn ended. Inspect the files and required checks to verify the deliverable separately.",
  },
  de: {
    admission: "Codex-Aufgabenzulassung",
    workspace: "Codex-Arbeitsbereich",
    interrupted:
      "Der gestartete Codex-Schritt konnte nicht sicher abgeschlossen gespeichert werden. Prüfe beobachtete Aktionen, Nutzung und Dateien, bevor du fortfährst; wiederhole unklare Arbeit nicht automatisch.",
    description:
      "Führt einen Programmierschritt für diese Aufgabe in der optionalen Codex-Laufzeit aus. Installation und Arbeitsbereich-Isolation werden vor der Inferenz geprüft; nicht unterstützte Systeme werden gestoppt. Ein beendeter Schritt bestätigt kein Ergebnis.",
    invalid:
      "Gib nur den Prompt für die Arbeit an. Der Server bestimmt Arbeitsbereich, Konto und Berechtigungen.",
    unavailable:
      "Die Codex-Laufzeit ist für diese Aufgabe nicht verfügbar. Eine nicht unterstützte Umgebung oder geänderte Berechtigung hat die Ausführung gestoppt.",
    completed:
      "Der Codex-Programmierschritt ist beendet. Prüfe die Dateien und erforderlichen Tests, um das Ergebnis gesondert zu bestätigen.",
  },
  ru: {
    admission: "Допуск задачи Codex",
    workspace: "Рабочая область Codex",
    interrupted:
      "Начатый этап Codex не удалось надёжно сохранить как завершённый. Перед продолжением проверьте наблюдаемые действия, расход и файлы; не повторяйте автоматически работу с неопределённым результатом.",
    description:
      "Выполняет один этап работы с кодом для этой задачи в дополнительной среде Codex. Установка и изоляция рабочей области проверяются до запроса к модели; неподдерживаемая среда останавливается. Завершение этапа не подтверждает результат.",
    invalid:
      "Передайте только prompt с описанием работы. Сервер выбирает рабочую область, аккаунт и разрешения.",
    unavailable:
      "Среда Codex недоступна для этой задачи. Выполнение остановлено из-за неподдерживаемой установки или изменения разрешений.",
    completed:
      "Этап работы Codex с кодом завершён. Проверьте файлы и необходимые тесты, чтобы отдельно подтвердить результат.",
  },
  "zh-CN": {
    admission: "Codex 任务准入",
    workspace: "Codex 工作区",
    interrupted:
      "已启动的 Codex 轮次无法安全保存为已完成。继续前请检查已观察到的操作、用量和文件；不要自动重复结果不确定的工作。",
    description:
      "在可选的 Codex 运行环境中为此任务执行一轮编码。调用模型前会检查安装与工作区隔离；不支持的环境会停止。编码轮次结束不代表交付结果已经验证。",
    invalid: "请仅提供描述工作的 prompt。工作区、账户和权限由服务器确定。",
    unavailable:
      "此任务无法使用 Codex 运行环境。由于环境不受支持或权限发生变化，执行已停止。",
    completed:
      "Codex 编码轮次已结束。请检查文件并执行必要检查，单独验证交付结果。",
  },
  "zh-TW": {
    admission: "Codex 任務准入",
    workspace: "Codex 工作區",
    interrupted:
      "已啟動的 Codex 輪次無法安全儲存為已完成。繼續前請檢查已觀察到的操作、用量和檔案；不要自動重複結果不確定的工作。",
    description:
      "在選用的 Codex 執行環境中為此任務執行一輪編碼。呼叫模型前會檢查安裝與工作區隔離；不支援的環境會停止。編碼輪次結束不代表交付結果已經驗證。",
    invalid: "請僅提供描述工作的 prompt。工作區、帳戶與權限由伺服器決定。",
    unavailable:
      "此任務無法使用 Codex 執行環境。由於環境不受支援或權限發生變化，執行已停止。",
    completed:
      "Codex 編碼輪次已結束。請檢查檔案並執行必要檢查，另外驗證交付結果。",
  },
  ar: {
    admission: "قبول مهمة Codex",
    workspace: "مساحة عمل Codex",
    interrupted:
      "تعذّر حفظ جولة Codex التي بدأت على أنها مكتملة بأمان. راجع الإجراءات المرصودة والاستخدام والملفات قبل المتابعة؛ لا تكرر تلقائيًا عملاً نتيجته غير مؤكدة.",
    description:
      "يشغّل جولة برمجة واحدة لهذه المهمة في بيئة Codex الاختيارية. يُتحقق من التثبيت وعزل مساحة العمل قبل طلب النموذج؛ تتوقف البيئات غير المدعومة. انتهاء الجولة لا يعني التحقق من النتيجة النهائية.",
    invalid:
      "قدّم حقل prompt فقط لوصف العمل. يحدد الخادم مساحة العمل والحساب والصلاحيات.",
    unavailable:
      "بيئة Codex غير متاحة لهذه المهمة. توقف التنفيذ بسبب بيئة غير مدعومة أو تغيّر الصلاحيات.",
    completed:
      "انتهت جولة برمجة Codex. افحص الملفات والاختبارات المطلوبة للتحقق من النتيجة النهائية بشكل منفصل.",
  },
} as const;
export const getCodexTaskCopy = (locale: WorkspaceLocale) => copy[locale];
