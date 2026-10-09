import type { PlanInferenceError } from "@workspace/ai-server";
import type { WorkspaceLocale } from "../workspace-locale";

// Operator guidance belongs to the application's authored locales. Upstream
// error messages are never copied into task history or activity.
const guidance: Record<
  WorkspaceLocale,
  readonly [string, string, string, string]
> = {
  tr: [
    "ChatGPT plan kotası görevi durdurdu. Sıfırlanma zamanı bilinmiyor. Ayarlar'dan bağlantıyı kontrol edip açıkça yeniden deneyin, ardından görevi sürdürün.",
    "ChatGPT plan kotası beklemeyi gerektiriyor. Görev tamamlanmadı; bildirilen bekleme süresinden sonra yeniden denenecek.",
    "ChatGPT bağlantısı veya seçilen model bu isteği çalıştıramıyor. Ayarlar'dan hesabı, model seçimini ve plan iznini kontrol edip görevi sürdürün.",
    "ChatGPT tamamlanmış bir yanıt döndürmedi. Görev durduruldu. Son durumu inceleyip görevi açıkça sürdürün; istek otomatik tekrarlanmayacak.",
  ],
  en: [
    "ChatGPT plan quota paused this task. Its reset time is unknown. Check the connection and explicitly retry in Settings, then resume the task.",
    "ChatGPT plan quota requires waiting. This task is not complete; it will retry after the reported waiting period.",
    "The ChatGPT connection or selected model cannot run this request. Check the account, model selection and plan permission in Settings, then resume the task.",
    "ChatGPT did not return a completed response. This task is paused. Review its latest state and explicitly resume; the request will not repeat automatically.",
  ],
  de: [
    "Das ChatGPT-Plankontingent hat diese Aufgabe angehalten. Der Rücksetzzeitpunkt ist unbekannt. Prüfe die Verbindung und versuche es in den Einstellungen ausdrücklich erneut. Setze dann die Aufgabe fort.",
    "Das ChatGPT-Plankontingent erfordert eine Wartezeit. Diese Aufgabe ist nicht abgeschlossen; sie wird nach der gemeldeten Wartezeit erneut versucht.",
    "Die ChatGPT-Verbindung oder das ausgewählte Modell kann diese Anfrage nicht ausführen. Prüfe Konto, Modellauswahl und Planberechtigung in den Einstellungen und setze dann die Aufgabe fort.",
    "ChatGPT hat keine abgeschlossene Antwort geliefert. Diese Aufgabe ist angehalten. Prüfe den letzten Stand und setze sie ausdrücklich fort; die Anfrage wird nicht automatisch wiederholt.",
  ],
  ru: [
    "Лимит плана ChatGPT приостановил задачу. Время сброса неизвестно. Проверьте подключение и явно повторите попытку в настройках, затем возобновите задачу.",
    "Лимит плана ChatGPT требует ожидания. Задача не завершена; попытка повторится после указанного периода ожидания.",
    "Подключение ChatGPT или выбранная модель не могут выполнить запрос. Проверьте аккаунт, модель и разрешение на использование плана в настройках, затем возобновите задачу.",
    "ChatGPT не вернул завершённый ответ. Задача приостановлена. Проверьте её последнее состояние и явно возобновите; запрос не будет повторён автоматически.",
  ],
  "zh-CN": [
    "ChatGPT 套餐额度限制暂停了此任务，重置时间未知。请在设置中检查连接并明确选择重试，然后恢复任务。",
    "ChatGPT 套餐额度限制需要等待。此任务尚未完成，将在服务方报告的等待时间后重试。",
    "ChatGPT 连接或所选模型无法执行此请求。请在设置中检查账户、所选模型及套餐使用权限，然后恢复任务。",
    "ChatGPT 未返回完整完成的响应。此任务已暂停。请检查最新状态并明确选择恢复；请求不会自动重复。",
  ],
  "zh-TW": [
    "ChatGPT 方案額度限制暫停了此任務，重設時間未知。請在設定中檢查連線並明確選擇重試，然後恢復任務。",
    "ChatGPT 方案額度限制需要等待。此任務尚未完成，將在服務方回報的等待時間後重試。",
    "ChatGPT 連線或所選模型無法執行此請求。請在設定中檢查帳戶、所選模型及方案使用權限，然後恢復任務。",
    "ChatGPT 未傳回完整完成的回應。此任務已暫停。請檢查最新狀態並明確選擇恢復；請求不會自動重複。",
  ],
  ar: [
    "أوقف حد استخدام خطة ChatGPT هذه المهمة مؤقتًا. وقت إعادة التعيين غير معروف. تحقق من الاتصال وأعد المحاولة صراحةً في الإعدادات، ثم استأنف المهمة.",
    "يتطلب حد استخدام خطة ChatGPT الانتظار. لم تكتمل هذه المهمة؛ ستُعاد المحاولة بعد فترة الانتظار التي أبلغت بها الخدمة.",
    "لا يستطيع اتصال ChatGPT أو النموذج المحدد تنفيذ هذا الطلب. تحقق من الحساب والنموذج وإذن استخدام الخطة في الإعدادات، ثم استأنف المهمة.",
    "لم يُرجع ChatGPT استجابة مكتملة. أُوقفت هذه المهمة مؤقتًا. راجع آخر حالة واستأنفها صراحةً؛ لن يتكرر الطلب تلقائيًا.",
  ],
};

export function planTaskRecoveryMessage(
  failure: PlanInferenceError,
  locale: WorkspaceLocale,
): string {
  const copy = guidance[locale];
  if (failure.kind === "quota") return copy[failure.retryAt === null ? 0 : 1];
  if (
    [
      "sign_in_required",
      "permission",
      "account_changed",
      "unsupported",
    ].includes(failure.kind)
  )
    return copy[2];
  return copy[3];
}
