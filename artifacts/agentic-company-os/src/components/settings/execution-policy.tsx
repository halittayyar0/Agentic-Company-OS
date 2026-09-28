import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getExecutionPolicy,
  updateExecutionPolicy,
  type ExecutionPolicy,
  type CustomExecutionPermissions,
} from "@workspace/api-client-react";
import { useLocale } from "../i18n/locale-provider";
import { Button } from "../ui/button";

const text = {
  tr: [
    "Ajan erişimi",
    "Salt okunur",
    "Onaylı çalışma",
    "Tam erişim",
    "Özel",
    "Dosya değişiklikleri",
    "Komut çalıştırma",
    "Tarayıcı işlemleri",
    "Ekip ve görev oluşturma",
    "Yükseltilmiş komutlar",
    "Kaydet",
    "Kaydediliyor…",
    "İzinler kaydedildi.",
    "İzinler yüklenemedi veya değişti. Yenile ve yeniden dene.",
    "Yenile",
    "Tam erişim, uygun bekleyen işlemleri de otomatik onaylar. Ajan izinleri, işletim sistemi sınırları ve acil durdurma geçerliliğini korur.",
    "İnceleme ve planlama yapılabilir. Dosya değişiklikleri ve komutlar engellenir.",
    "Korunan işlemler tek kullanımlık onayla yürütülür.",
  ],
  en: [
    "Agent access",
    "Read only",
    "Approval mode",
    "Full access",
    "Custom",
    "File changes",
    "Run commands",
    "Browser actions",
    "Create teams and tasks",
    "Elevated commands",
    "Save",
    "Saving…",
    "Permissions saved.",
    "Permissions could not be loaded or have changed. Refresh and retry.",
    "Refresh",
    "Full access also authorizes eligible queued actions automatically. Agent permissions, operating-system limits and emergency stop still apply.",
    "Inspect and plan. File changes and commands are blocked.",
    "Protected actions use single-use approval.",
  ],
  de: [
    "Agentenzugriff",
    "Nur lesen",
    "Mit Genehmigung",
    "Vollzugriff",
    "Benutzerdefiniert",
    "Dateiänderungen",
    "Befehle ausführen",
    "Browseraktionen",
    "Teams und Aufgaben erstellen",
    "Erhöhte Befehle",
    "Speichern",
    "Wird gespeichert…",
    "Berechtigungen gespeichert.",
    "Berechtigungen konnten nicht geladen werden oder wurden geändert. Aktualisieren und erneut versuchen.",
    "Aktualisieren",
    "Vollzugriff genehmigt auch geeignete wartende Aktionen automatisch. Agentenrechte, Betriebssystemgrenzen und Not-Aus gelten weiterhin.",
    "Prüfen und planen. Dateiänderungen und Befehle sind gesperrt.",
    "Geschützte Aktionen benötigen eine einmalige Genehmigung.",
  ],
  ru: [
    "Доступ агентов",
    "Только чтение",
    "С подтверждением",
    "Полный доступ",
    "Настроить",
    "Изменение файлов",
    "Выполнение команд",
    "Действия браузера",
    "Создание команд и задач",
    "Команды с повышенными правами",
    "Сохранить",
    "Сохранение…",
    "Права сохранены.",
    "Не удалось загрузить права или они изменились. Обновите и повторите.",
    "Обновить",
    "Полный доступ также автоматически разрешает подходящие действия в очереди. Права агентов, ограничения ОС и аварийная остановка сохраняются.",
    "Просмотр и планирование. Изменения файлов и команды заблокированы.",
    "Защищённые действия требуют одноразового разрешения.",
  ],
  "zh-CN": [
    "智能体权限",
    "只读",
    "审批模式",
    "完全访问",
    "自定义",
    "修改文件",
    "执行命令",
    "浏览器操作",
    "创建团队和任务",
    "提权命令",
    "保存",
    "正在保存…",
    "权限已保存。",
    "无法加载权限或权限已更改。请刷新重试。",
    "刷新",
    "完全访问也会自动批准符合条件的排队操作。智能体权限、操作系统限制和紧急停止仍然有效。",
    "可以检查和规划。文件修改和命令被禁止。",
    "受保护的操作需要一次性批准。",
  ],
  "zh-TW": [
    "代理權限",
    "唯讀",
    "核准模式",
    "完整存取",
    "自訂",
    "修改檔案",
    "執行命令",
    "瀏覽器操作",
    "建立團隊和任務",
    "提升權限命令",
    "儲存",
    "正在儲存…",
    "權限已儲存。",
    "無法載入權限或權限已變更。請重新整理後再試。",
    "重新整理",
    "完整存取也會自動核准符合條件的佇列操作。代理權限、作業系統限制和緊急停止仍然有效。",
    "可以檢查和規劃。檔案修改和命令被禁止。",
    "受保護的操作需要一次性核准。",
  ],
  ar: [
    "صلاحيات الوكلاء",
    "قراءة فقط",
    "وضع الموافقة",
    "وصول كامل",
    "مخصص",
    "تعديل الملفات",
    "تنفيذ الأوامر",
    "إجراءات المتصفح",
    "إنشاء الفرق والمهام",
    "أوامر بصلاحيات مرتفعة",
    "حفظ",
    "جارٍ الحفظ…",
    "تم حفظ الصلاحيات.",
    "تعذر تحميل الصلاحيات أو تم تغييرها. حدّث وحاول مجددًا.",
    "تحديث",
    "يوافق الوصول الكامل تلقائيًا أيضًا على الإجراءات المؤهلة في قائمة الانتظار. تبقى صلاحيات الوكلاء وحدود نظام التشغيل والإيقاف الطارئ سارية.",
    "الفحص والتخطيط متاحان. تعديل الملفات والأوامر محظوران.",
    "تتطلب الإجراءات المحمية موافقة للاستخدام مرة واحدة.",
  ],
} as const;
const queryKey = ["settings", "execution-policy"];
const customKeys = [
  "files",
  "terminal",
  "browser",
  "delegation",
  "sudo",
] as const;
const emptyCustom: CustomExecutionPermissions = {
  files: false,
  terminal: false,
  browser: false,
  delegation: false,
  sudo: false,
};

export function ExecutionPolicySettings() {
  const { locale } = useLocale();
  const c = text[locale];
  const client = useQueryClient();
  const policy = useQuery({
    queryKey,
    queryFn: () => getExecutionPolicy(),
    retry: false,
  });
  const [mode, setMode] = useState<ExecutionPolicy["mode"]>("approval");
  const [custom, setCustom] = useState<CustomExecutionPermissions>(emptyCustom);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"saved" | "error" | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (policy.data) {
      setMode(policy.data.mode);
      setCustom(policy.data.custom ?? emptyCustom);
    }
  }, [policy.data]);
  async function save() {
    if (inFlight.current || !policy.data) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const saved = await updateExecutionPolicy({
        mode,
        expectedRevision: policy.data.revision,
        ...(mode === "custom" ? { custom } : {}),
      });
      client.setQueryData(queryKey, saved);
      setNotice("saved");
    } catch {
      setNotice("error");
      await policy.refetch();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="space-y-4 rounded-panel border bg-card p-4 sm:p-6"
      aria-labelledby="execution-policy-title"
    >
      <h2 id="execution-policy-title" className="text-lg font-semibold">
        {c[0]}
      </h2>
      {policy.data ? (
        <>
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">{c[0]}</legend>
            {(["read_only", "approval", "full_access", "custom"] as const).map(
              (value, index) => (
                <label
                  key={value}
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <input
                    type="radio"
                    name="execution-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => {
                      setMode(value);
                      setNotice(null);
                    }}
                    className="size-4 accent-primary"
                  />
                  <span>{c[index + 1]}</span>
                </label>
              ),
            )}
          </fieldset>
          <p className="text-sm text-muted-foreground">
            {mode === "full_access"
              ? c[15]
              : mode === "read_only"
                ? c[16]
                : c[17]}
          </p>
          {mode === "custom" && (
            <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">{c[4]}</legend>
              {customKeys.map((key, index) => (
                <label key={key} className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={custom[key]}
                    onChange={(event) =>
                      setCustom({ ...custom, [key]: event.target.checked })
                    }
                    className="size-4 accent-primary"
                  />
                  {c[index + 5]}
                </label>
              ))}
            </fieldset>
          )}
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? c[11] : c[10]}
          </Button>
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {policy.isError ? c[13] : c[11]}
        </p>
      )}
      {(notice || policy.isError) && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 text-sm"
        >
          <span>{notice === "saved" ? c[12] : c[13]}</span>
          {notice !== "saved" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void policy.refetch()}
            >
              {c[14]}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
