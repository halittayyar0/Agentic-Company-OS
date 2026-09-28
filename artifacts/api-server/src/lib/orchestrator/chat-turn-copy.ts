import type { WorkspaceLocale } from "../workspace-locale";

type Copy = {
  provider: string;
  empty: string;
  toolLimit: string;
  unknown: string;
  deferred: string;
  approval: string;
  roundLimit: string;
  scope: string;
};
// These are system notices. Model replies and quoted tool evidence keep their source text.
const copy: Record<WorkspaceLocale, Copy> = {
  tr: {
    provider:
      "Model çağrısı tamamlanamadı. Önceki araç işlemleri gerçekleşmiş olabilir; yeni bir istek göndermeden önce kayıtları inceleyin.",
    empty:
      "Model kullanılabilir bir yanıt döndürmedi. Önceki araç işlemleri gerçekleşmiş olabilir.",
    toolLimit:
      "Araç çağrısı sınırı aşıldı. Bu gruptaki çağrılar çalıştırılmadı; önceki işlemler için kayıtları inceleyin.",
    unknown:
      "İşlemin sonucu doğrulanamadı. Otomatik tekrar ve sonraki araç çağrıları durduruldu. Devam etmeden önce Operations üzerinden sonucu uzlaştırın.",
    deferred:
      "Aynı işlem başka bir worker tarafından yürütülüyor. Sonraki araç çağrıları durduruldu; yeni bir istek göndermeden önce işlem kaydını inceleyin.",
    approval:
      "Onay aracıyla ilgili kayıt aşağıdadır. Gerçek durumu Onaylar sayfasından kontrol edin.",
    roundLimit:
      "Bu sohbetin araç turu sınırına ulaşıldı. İşin tamamlandığı doğrulanmadı. Devam etmeden önce görevleri ve işlem kayıtlarını inceleyin.",
    scope: "Kapsam sınırı nedeniyle çalıştırılmayan araçlar:",
  },
  en: {
    provider:
      "The model call did not complete. Earlier tool actions may have taken effect; review the records before sending a new request.",
    empty:
      "The model returned no usable reply. Earlier tool actions may have taken effect.",
    toolLimit:
      "The tool call limit was exceeded. This batch was not executed; review the records for earlier actions.",
    unknown:
      "The action outcome could not be confirmed. Automatic retries and further tool calls stopped. Reconcile the outcome in Operations before continuing.",
    deferred:
      "Another worker is handling the same action. Further tool calls stopped; review its receipt before sending a new request.",
    approval:
      "The approval tool record follows. Check Approvals for its actual status.",
    roundLimit:
      "This chat reached its tool round limit. Completion of the work is unconfirmed. Review tasks and action records before continuing.",
    scope: "Tools blocked by the requested scope:",
  },
  de: {
    provider:
      "Der Modellaufruf wurde nicht abgeschlossen. Frühere Werkzeugaktionen können bereits wirksam sein; prüfen Sie die Aufzeichnungen vor einer neuen Anfrage.",
    empty:
      "Das Modell hat keine nutzbare Antwort geliefert. Frühere Werkzeugaktionen können bereits wirksam sein.",
    toolLimit:
      "Das Limit für Werkzeugaufrufe wurde überschritten. Diese Gruppe wurde nicht ausgeführt; prüfen Sie die Aufzeichnungen früherer Aktionen.",
    unknown:
      "Das Ergebnis der Aktion konnte nicht bestätigt werden. Automatische Wiederholungen und weitere Werkzeugaufrufe wurden gestoppt. Klären Sie das Ergebnis unter Betrieb, bevor Sie fortfahren.",
    deferred:
      "Ein anderer Worker bearbeitet dieselbe Aktion. Weitere Werkzeugaufrufe wurden gestoppt; prüfen Sie den Vorgangsbeleg vor einer neuen Anfrage.",
    approval:
      "Es folgt der Eintrag des Freigabewerkzeugs. Prüfen Sie den tatsächlichen Status unter Freigaben.",
    roundLimit:
      "Das Rundenlimit für Werkzeuge in diesem Chat wurde erreicht. Der Abschluss der Arbeit ist unbestätigt. Prüfen Sie Aufgaben und Vorgänge, bevor Sie fortfahren.",
    scope: "Aufgrund des angeforderten Umfangs blockierte Werkzeuge:",
  },
  ru: {
    provider:
      "Вызов модели не завершён. Предыдущие действия инструментов могли выполниться; проверьте записи перед новым запросом.",
    empty:
      "Модель не вернула пригодного ответа. Предыдущие действия инструментов могли выполниться.",
    toolLimit:
      "Превышен лимит вызовов инструментов. Эта группа не выполнена; проверьте записи предыдущих действий.",
    unknown:
      "Результат действия не подтверждён. Автоматические повторы и дальнейшие вызовы инструментов остановлены. Уточните результат в разделе операций перед продолжением.",
    deferred:
      "Другой рабочий процесс выполняет это действие. Дальнейшие вызовы остановлены; проверьте запись операции перед новым запросом.",
    approval:
      "Ниже приведена запись инструмента согласования. Проверьте фактический статус в разделе согласований.",
    roundLimit:
      "Достигнут лимит раундов инструментов для этого чата. Завершение работы не подтверждено. Проверьте задачи и записи операций перед продолжением.",
    scope: "Инструменты, заблокированные ограничениями запроса:",
  },
  "zh-CN": {
    provider:
      "模型调用未完成。先前的工具操作可能已经生效；发送新请求前请查看记录。",
    empty: "模型未返回可用的回复。先前的工具操作可能已经生效。",
    toolLimit: "已超出工具调用上限。本批调用未执行；请查看先前操作的记录。",
    unknown:
      "无法确认操作结果。自动重试和后续工具调用已停止。继续前请在运行管理中核实结果。",
    deferred:
      "另一个工作进程正在处理同一操作。后续工具调用已停止；发送新请求前请查看操作回执。",
    approval: "以下为审批工具记录。请在审批页面查看实际状态。",
    roundLimit:
      "此对话已达到工具轮次上限。工作是否完成尚未确认。继续前请查看任务和操作记录。",
    scope: "因请求范围限制而被阻止的工具：",
  },
  "zh-TW": {
    provider:
      "模型呼叫未完成。先前的工具操作可能已經生效；傳送新請求前請查看紀錄。",
    empty: "模型未傳回可用的回覆。先前的工具操作可能已經生效。",
    toolLimit: "已超出工具呼叫上限。本批呼叫未執行；請查看先前操作的紀錄。",
    unknown:
      "無法確認操作結果。自動重試及後續工具呼叫已停止。繼續前請在執行管理中核實結果。",
    deferred:
      "另一個工作程序正在處理相同操作。後續工具呼叫已停止；傳送新請求前請查看操作回執。",
    approval: "以下為核准工具紀錄。請在核准頁面查看實際狀態。",
    roundLimit:
      "此對話已達工具回合上限。工作是否完成尚未確認。繼續前請查看任務和操作紀錄。",
    scope: "因請求範圍限制而遭封鎖的工具：",
  },
  ar: {
    provider:
      "لم يكتمل استدعاء النموذج. قد تكون إجراءات الأدوات السابقة قد نُفذت؛ راجع السجلات قبل إرسال طلب جديد.",
    empty:
      "لم يُرجع النموذج رداً قابلاً للاستخدام. قد تكون إجراءات الأدوات السابقة قد نُفذت.",
    toolLimit:
      "تم تجاوز حد استدعاءات الأدوات. لم تُنفذ هذه المجموعة؛ راجع سجلات الإجراءات السابقة.",
    unknown:
      "تعذر تأكيد نتيجة الإجراء. توقفت المحاولات التلقائية واستدعاءات الأدوات اللاحقة. تحقق من النتيجة في العمليات قبل المتابعة.",
    deferred:
      "تنفذ عملية عاملة أخرى الإجراء نفسه. توقفت استدعاءات الأدوات اللاحقة؛ راجع سجل الإجراء قبل إرسال طلب جديد.",
    approval:
      "فيما يلي سجل أداة الموافقة. تحقق من الحالة الفعلية في صفحة الموافقات.",
    roundLimit:
      "وصلت هذه المحادثة إلى الحد الأقصى لجولات الأدوات. لم يُؤكد اكتمال العمل. راجع المهام وسجلات الإجراءات قبل المتابعة.",
    scope: "الأدوات المحظورة بسبب نطاق الطلب:",
  },
};
export const chatTurnCopy = (locale: WorkspaceLocale): Copy => copy[locale];
