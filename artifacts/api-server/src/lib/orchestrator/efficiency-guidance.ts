import type { WorkspaceLocale } from "../workspace-locale";

const guidance: Record<WorkspaceLocale, string> = {
  tr: "Küçük işi kendin tamamla. Yalnızca ayrı bir teslimatı bağımsız üretecekse görev delege et; mevcut uygun ajanı yeniden kullan. Yeni ajan oluşturmayı ilerleme sayma. Önce ilgili rehberi bul ve yalnız gereken bölümü oku. Değişmemiş dosya ve araç sonuçlarını tekrar isteme; kısa kanıt ve dosya yollarını koru. Sürekli sorumlulukta bir döngünün sonucunu doğrula, complete_task ile döngüyü kapat ve sonraki zamanı zamanlayıcıya bırak. Beklerken model çağrısı üretmek için yapay alt görevler oluşturma. Bütçede durmak tamamlanmak değildir; eksik sonucu ve devam için gerekeni açıkça kaydet.",
  en: "Complete small work yourself. Delegate only an independent deliverable and reuse a suitable existing agent. Creating agents is not progress. Discover the relevant guide and read only what you need. Reuse unchanged observations; retain concise evidence and file paths. For recurring work, verify one cycle, close it with complete_task and let the scheduler wait for the next due time. Do not create artificial subtasks to poll while waiting. A budget stop is not completion: record the remaining work and what is needed to continue.",
  de: "Erledige kleine Aufgaben selbst. Delegiere nur unabhängige Ergebnisse und nutze passende vorhandene Agenten. Neue Agenten sind kein Fortschritt. Lies nur relevante Anleitungen und verwende unveränderte Beobachtungen erneut. Bewahre kurze Nachweise und Dateipfade auf. Prüfe bei wiederkehrender Arbeit einen Durchlauf, schließe ihn mit complete_task ab und überlasse die Wartezeit dem Scheduler. Erzeuge keine künstlichen Unteraufgaben zum Abfragen. Ein Budgetstopp ist kein Abschluss; dokumentiere die verbleibende Arbeit.",
  ru: "Небольшую работу выполняй самостоятельно. Делегируй только независимый результат, используя подходящего существующего агента. Создание агентов не считается прогрессом. Читай только нужные руководства и используй неизменившиеся наблюдения повторно. Сохраняй краткие доказательства и пути файлов. Для регулярной работы проверь результат цикла, заверши его через complete_task и предоставь ожидание планировщику. Не создавай фиктивные подзадачи для опроса. Остановка по бюджету не означает завершение: запиши оставшуюся работу.",
  "zh-CN":
    "小任务由自己完成。仅为独立交付成果委派任务，并优先复用合适的现有代理。创建代理不等于进展。只阅读相关指南，复用未变化的观察结果，保留简短证据和文件路径。定期任务应验证本轮结果，通过 complete_task 结束本轮，再由调度器等待下次执行。不要为了轮询而创建虚假子任务。预算耗尽不等于任务完成；记录未完成工作和继续所需条件。",
  "zh-TW":
    "小任務由自己完成。僅為獨立交付成果委派任務，並優先重用合適的現有代理。建立代理不等於進展。只閱讀相關指南，重用未變更的觀察結果，保留簡短證據與檔案路徑。定期任務應驗證本輪結果，透過 complete_task 結束本輪，再由排程器等待下次執行。不要為了輪詢而建立虛假子任務。預算耗盡不等於任務完成；記錄未完成工作與繼續所需條件。",
  ar: "أنجز المهام الصغيرة بنفسك. فوّض فقط مخرجات مستقلة وأعد استخدام وكيل مناسب موجود. إنشاء الوكلاء ليس تقدماً. اقرأ الأدلة المطلوبة فقط وأعد استخدام الملاحظات التي لم تتغير، مع حفظ أدلة موجزة ومسارات الملفات. في العمل المتكرر، تحقق من نتيجة الدورة وأنهِها عبر complete_task واترك انتظار الموعد التالي للمجدول. لا تنشئ مهام فرعية وهمية للاستطلاع. التوقف بسبب الميزانية ليس إكمالاً؛ سجّل العمل المتبقي ومتطلبات المتابعة.",
};

export function efficiencyGuidance(locale: WorkspaceLocale): string {
  return `<execution_efficiency>\n${guidance[locale]}\n</execution_efficiency>`;
}
