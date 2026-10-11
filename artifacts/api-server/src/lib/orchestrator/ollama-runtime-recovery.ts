import type { WorkspaceLocale } from "../workspace-locale";

const guidance: Record<WorkspaceLocale, readonly [string, string]> = {
  en: [
    "This model requires a newer Ollama server. Update that server, then check the connection in Settings; this task will retry automatically.",
    "This model's required Ollama version could not be verified. Check the connection in Settings; this task will retry automatically.",
  ],
  tr: [
    "Bu model daha yeni bir Ollama sunucusu gerektiriyor. Sunucuyu güncelleyip Ayarlar'dan bağlantıyı kontrol edin; görev otomatik olarak yeniden denenecek.",
    "Bu modelin gerektirdiği Ollama sürümü doğrulanamadı. Ayarlar'dan bağlantıyı kontrol edin; görev otomatik olarak yeniden denenecek.",
  ],
  de: [
    "Dieses Modell benötigt einen neueren Ollama-Server. Aktualisiere diesen Server und prüfe die Verbindung in den Einstellungen; die Aufgabe wird automatisch erneut versucht.",
    "Die erforderliche Ollama-Version dieses Modells konnte nicht bestätigt werden. Prüfe die Verbindung in den Einstellungen; die Aufgabe wird automatisch erneut versucht.",
  ],
  ru: [
    "Этой модели требуется более новый сервер Ollama. Обновите сервер и проверьте подключение в настройках; задача будет повторена автоматически.",
    "Не удалось проверить требуемую этой моделью версию Ollama. Проверьте подключение в настройках; задача будет повторена автоматически.",
  ],
  "zh-CN": [
    "此模型需要更新的 Ollama 服务器。请更新该服务器，然后在设置中检查连接；任务将自动重试。",
    "无法验证此模型所需的 Ollama 版本。请在设置中检查连接；任务将自动重试。",
  ],
  "zh-TW": [
    "此模型需要更新的 Ollama 伺服器。請更新該伺服器，然後在設定中檢查連線；任務將自動重試。",
    "無法驗證此模型所需的 Ollama 版本。請在設定中檢查連線；任務將自動重試。",
  ],
  ar: [
    "يتطلب هذا النموذج خادم Ollama أحدث. حدّث الخادم، ثم تحقق من الاتصال في الإعدادات؛ ستُعاد محاولة المهمة تلقائيًا.",
    "تعذّر التحقق من إصدار Ollama الذي يتطلبه هذا النموذج. تحقق من الاتصال في الإعدادات؛ ستُعاد محاولة المهمة تلقائيًا.",
  ],
};

export function ollamaRuntimeRecoveryMessage(
  code: string | undefined,
  locale: WorkspaceLocale,
): string | null {
  if (code === "model_update_required") return guidance[locale][0];
  if (code === "model_runtime_unverified") return guidance[locale][1];
  return null;
}
