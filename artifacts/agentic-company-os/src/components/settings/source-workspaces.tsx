import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, listAgents } from "@workspace/api-client-react";
import { useLocale } from "../i18n/locale-provider";
import { Button } from "../ui/button";

const copy = {
  tr: [
    "Kaynak kodunu geliştir",
    "Ajanın ayrı bir kopyada çalışır. Kontroller geçen sürümü asıl kaynağa uygula; gerekirse geri al.",
    "Kaynak klasörü",
    "Ajan",
    "Ne değişsin?",
    "Çalışma kopyası oluştur",
    "Değişiklikler",
    "İncele",
    "Kontrol komutları (JSON)",
    "Kontrolleri çalıştır",
    "Geçen sürümü uygula",
    "Geri al",
    "Yenile",
    "İşlem sürüyor…",
    "İşlem tamamlandı.",
    "İşlem tamamlanamadı. Kayıtları yenile ve sonucu incele.",
    "Henüz kaynak değişikliği yok.",
    "Kaynak uygulandıktan sonra kurulumu yeniden başlat. Bu işlem çalışan uygulamayı veya veritabanı değişikliklerini geri almaz.",
    "Kontroller her biri en fazla 20 dakika sürebilir. Sekmeyi açık tut; bağlantı kesilirse sonucu yenile, işlemi tekrar gönderme.",
    "Son kontrol çıktısı",
    "Durum",
    "Ajan seç",
    "Taslak",
    "Kontrol ediliyor",
    "Kontrol geçti",
    "Uygulanıyor",
    "Uygulandı",
    "Geri alınıyor",
    "Geri alındı",
    "Başarısız",
    "Sonuç belirsiz",
    "Hazırlanıyor",
  ],
  en: [
    "Improve source code",
    "Your agent works in a separate copy. Apply the checked version to the original source, with rollback available.",
    "Source folder",
    "Agent",
    "What should change?",
    "Create working copy",
    "Changes",
    "Inspect",
    "Check commands (JSON)",
    "Run checks",
    "Apply checked version",
    "Roll back",
    "Refresh",
    "Working…",
    "Action completed.",
    "Action could not finish. Refresh the records and inspect the outcome.",
    "No source changes yet.",
    "Restart the installation after applying source changes. This action does not roll back the running application or database migrations.",
    "Each check can take up to 20 minutes. Keep this tab open; if disconnected, refresh the outcome instead of resubmitting.",
    "Latest check output",
    "Status",
    "Choose an agent",
    "Draft",
    "Checking",
    "Checks passed",
    "Applying",
    "Applied",
    "Rolling back",
    "Rolled back",
    "Failed",
    "Outcome unknown",
    "Preparing",
  ],
  de: [
    "Quellcode verbessern",
    "Dein Agent arbeitet in einer separaten Kopie. Übernimm die geprüfte Version in den ursprünglichen Quellcode und mache sie bei Bedarf rückgängig.",
    "Quellordner",
    "Agent",
    "Was soll sich ändern?",
    "Arbeitskopie erstellen",
    "Änderungen",
    "Prüfen",
    "Prüfbefehle (JSON)",
    "Prüfungen starten",
    "Geprüfte Version übernehmen",
    "Rückgängig machen",
    "Aktualisieren",
    "Wird bearbeitet…",
    "Aktion abgeschlossen.",
    "Aktion nicht abgeschlossen. Aktualisiere die Einträge und prüfe das Ergebnis.",
    "Noch keine Quellcodeänderungen.",
    "Starte die Installation nach der Übernahme neu. Laufende Anwendung und Datenbankmigrationen werden dadurch nicht zurückgesetzt.",
    "Jede Prüfung kann bis zu 20 Minuten dauern. Lass den Tab offen; nach Verbindungsabbruch das Ergebnis aktualisieren, nicht erneut senden.",
    "Letzte Prüfausgabe",
    "Status",
    "Agent auswählen",
    "Entwurf",
    "Wird geprüft",
    "Prüfungen bestanden",
    "Wird übernommen",
    "Übernommen",
    "Wird rückgängig gemacht",
    "Rückgängig gemacht",
    "Fehlgeschlagen",
    "Ergebnis unklar",
    "Wird vorbereitet",
  ],
  ru: [
    "Улучшить исходный код",
    "Агент работает в отдельной копии. Примените проверенную версию к исходному коду с возможностью отмены.",
    "Папка исходного кода",
    "Агент",
    "Что изменить?",
    "Создать рабочую копию",
    "Изменения",
    "Просмотреть",
    "Команды проверки (JSON)",
    "Запустить проверки",
    "Применить проверенную версию",
    "Отменить",
    "Обновить",
    "Выполняется…",
    "Действие завершено.",
    "Не удалось завершить действие. Обновите записи и проверьте результат.",
    "Изменений кода пока нет.",
    "После применения кода перезапустите установку. Это действие не отменяет работающую версию приложения или миграции базы данных.",
    "Каждая проверка может занять до 20 минут. Оставьте вкладку открытой; при разрыве соединения обновите результат, не отправляйте действие повторно.",
    "Вывод последней проверки",
    "Состояние",
    "Выберите агента",
    "Черновик",
    "Проверяется",
    "Проверки пройдены",
    "Применяется",
    "Применено",
    "Отменяется",
    "Отменено",
    "Ошибка",
    "Результат неизвестен",
    "Подготовка",
  ],
  "zh-CN": [
    "改进源代码",
    "智能体在独立副本中工作。将通过检查的版本应用到原始代码，也可回滚。",
    "源代码文件夹",
    "智能体",
    "需要更改什么？",
    "创建工作副本",
    "更改",
    "查看",
    "检查命令（JSON）",
    "运行检查",
    "应用已检查的版本",
    "回滚",
    "刷新",
    "处理中…",
    "操作已完成。",
    "操作未完成。请刷新记录并检查结果。",
    "尚无源代码更改。",
    "应用代码后请重新启动安装。此操作不会回滚正在运行的应用或数据库迁移。",
    "每项检查最多需要20分钟。请保持此标签页打开；连接断开后刷新结果，不要重复提交。",
    "最近的检查输出",
    "状态",
    "选择智能体",
    "草稿",
    "检查中",
    "检查通过",
    "应用中",
    "已应用",
    "回滚中",
    "已回滚",
    "失败",
    "结果未知",
    "准备中",
  ],
  "zh-TW": [
    "改進原始碼",
    "智慧體在獨立副本中工作。將通過檢查的版本套用到原始碼，也可回復。",
    "原始碼資料夾",
    "智慧體",
    "需要變更什麼？",
    "建立工作副本",
    "變更",
    "檢視",
    "檢查命令（JSON）",
    "執行檢查",
    "套用已檢查的版本",
    "回復",
    "重新整理",
    "處理中…",
    "操作已完成。",
    "操作未完成。請重新整理記錄並檢查結果。",
    "尚無原始碼變更。",
    "套用程式碼後請重新啟動安裝。此操作不會回復正在執行的應用程式或資料庫遷移。",
    "每項檢查最多需要20分鐘。請保持此分頁開啟；連線中斷後重新整理結果，請勿重複提交。",
    "最近的檢查輸出",
    "狀態",
    "選擇智慧體",
    "草稿",
    "檢查中",
    "檢查通過",
    "套用中",
    "已套用",
    "回復中",
    "已回復",
    "失敗",
    "結果未知",
    "準備中",
  ],
  ar: [
    "تحسين الشيفرة المصدرية",
    "يعمل وكيلك في نسخة منفصلة. طبّق النسخة التي اجتازت الفحوص على المصدر الأصلي مع إمكانية التراجع.",
    "مجلد المصدر",
    "الوكيل",
    "ما التغيير المطلوب؟",
    "إنشاء نسخة عمل",
    "التغييرات",
    "عرض",
    "أوامر الفحص (JSON)",
    "تشغيل الفحوص",
    "تطبيق النسخة المفحوصة",
    "تراجع",
    "تحديث",
    "جارٍ العمل…",
    "اكتمل الإجراء.",
    "تعذر إكمال الإجراء. حدّث السجلات وتحقق من النتيجة.",
    "لا توجد تغييرات مصدرية بعد.",
    "أعد تشغيل التثبيت بعد تطبيق المصدر. لا يتراجع هذا الإجراء عن التطبيق قيد التشغيل أو ترحيلات قاعدة البيانات.",
    "قد يستغرق كل فحص 20 دقيقة. أبقِ علامة التبويب مفتوحة؛ عند انقطاع الاتصال حدّث النتيجة ولا ترسل الإجراء مجددًا.",
    "مخرجات الفحص الأخير",
    "الحالة",
    "اختر وكيلاً",
    "مسودة",
    "جارٍ الفحص",
    "اجتازت الفحوص",
    "جارٍ التطبيق",
    "تم التطبيق",
    "جارٍ التراجع",
    "تم التراجع",
    "فشل",
    "النتيجة غير معروفة",
    "جارٍ التحضير",
  ],
} as const;
type Change = {
  id: string;
  agentId: number;
  sourcePath: string;
  request: string;
  state: string;
  revision: number;
  baseCommit: string;
  candidateCommit: string | null;
  error: string | null;
  check: {
    output: string;
    passed: boolean;
    command: string[];
    commands?: string[][];
  } | null;
  diff?: string;
  status?: string;
};
const states = [
  "draft",
  "checking",
  "verified",
  "applying",
  "applied",
  "rolling_back",
  "rolled_back",
  "failed",
  "unknown",
  "preparing",
];
const initialCommands = JSON.stringify(
  [
    ["pnpm", "--dir", "{workspace}", "install", "--frozen-lockfile"],
    ["pnpm", "--dir", "{workspace}", "run", "typecheck"],
    ["pnpm", "--dir", "{workspace}", "test"],
  ],
  null,
  2,
);
const inputClass =
  "w-full min-h-11 rounded-lg border bg-background px-3 py-2 text-sm";
export function SourceWorkspaceSettings() {
  const { locale } = useLocale(),
    c = copy[locale];
  const [opened, setOpened] = useState(false),
    [sourcePath, setSource] = useState(""),
    [agentId, setAgent] = useState(""),
    [request, setRequest] = useState("");
  const [selected, setSelected] = useState<Change | null>(null),
    [commands, setCommands] = useState(initialCommands),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<number | null>(null);
  const active = useRef(false),
    requestId = useRef<string | null>(null);
  const changes = useQuery({
    queryKey: ["source-changes"],
    queryFn: () => customFetch<Change[]>("/api/source-changes"),
    enabled: opened,
    retry: false,
  });
  const agents = useQuery({
    queryKey: ["source-change-agents"],
    queryFn: () => listAgents(),
    enabled: opened,
    retry: false,
  });
  async function act(action: () => Promise<Change>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const row = await action();
      setSelected(row);
      setNotice(14);
      await changes.refetch();
    } catch {
      setNotice(15);
      await changes.refetch();
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  const post = (url: string, body: unknown) =>
    customFetch<Change>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const status = (row: Change) => c[22 + states.indexOf(row.state)] ?? c[30];
  return (
    <details
      className="space-y-4 rounded-panel border bg-card p-4 sm:p-6"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary className="cursor-pointer py-2 text-lg font-semibold">
        {c[0]}
      </summary>
      <p className="text-sm text-muted-foreground">{c[1]}</p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          requestId.current ??= crypto.randomUUID();
          void act(() =>
            post("/api/source-changes", {
              id: requestId.current,
              agentId: Number(agentId),
              sourcePath,
              request,
            }),
          );
        }}
      >
        <label className="block space-y-1">
          <span>{c[2]}</span>
          <input
            className={inputClass}
            value={sourcePath}
            required
            maxLength={2048}
            dir="ltr"
            disabled={busy}
            onChange={(event) => {
              setSource(event.target.value);
              requestId.current = null;
            }}
          />
        </label>
        <label className="block space-y-1">
          <span>{c[3]}</span>
          <select
            className={inputClass}
            value={agentId}
            required
            disabled={busy}
            onChange={(event) => {
              setAgent(event.target.value);
              requestId.current = null;
            }}
          >
            <option value="">{c[21]}</option>
            {agents.data
              ?.filter(
                (agent) => agent.isActive && agent.permissions?.canUseTerminal,
              )
              .map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span>{c[4]}</span>
          <textarea
            className={inputClass}
            required
            maxLength={4000}
            value={request}
            disabled={busy}
            onChange={(event) => {
              setRequest(event.target.value);
              requestId.current = null;
            }}
          />
        </label>
        <Button disabled={busy || !agentId} type="submit">
          {busy ? c[13] : c[5]}
        </Button>
      </form>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{c[6]}</h3>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            void changes.refetch();
            if (selected)
              void act(() =>
                customFetch<Change>(`/api/source-changes/${selected.id}`),
              );
          }}
        >
          {c[12]}
        </Button>
      </div>
      {(changes.isError || agents.isError) && <p role="alert">{c[15]}</p>}
      {changes.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">{c[16]}</p>
      )}
      <ul className="space-y-2">
        {changes.data?.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm">{row.request}</p>
              <p className="text-xs text-muted-foreground">{status(row)}</p>
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  customFetch<Change>(`/api/source-changes/${row.id}`),
                )
              }
            >
              {c[7]}
            </Button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">
            {c[20]}: {status(selected)}
          </p>
          <p className="text-xs break-all" dir="ltr">
            {selected.sourcePath}
          </p>
          {selected.error && (
            <code className="block text-xs" dir="ltr">
              {selected.error}
            </code>
          )}
          {selected.diff !== undefined && (
            <pre
              className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs"
              dir="ltr"
            >
              {selected.diff || selected.status}
            </pre>
          )}
          {["draft", "verified"].includes(selected.state) && (
            <>
              <label className="block space-y-1">
                <span>{c[8]}</span>
                <textarea
                  className={inputClass + " min-h-40 font-mono"}
                  dir="ltr"
                  value={commands}
                  disabled={busy}
                  onChange={(event) => setCommands(event.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">{c[18]}</p>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    post(`/api/source-changes/${selected.id}/check`, {
                      expectedRevision: selected.revision,
                      command: JSON.parse(commands),
                    }),
                  )
                }
              >
                {c[9]}
              </Button>
            </>
          )}
          {selected.check && (
            <details>
              <summary className="cursor-pointer py-2 text-sm">{c[19]}</summary>
              <pre
                dir="ltr"
                className="max-h-72 overflow-auto whitespace-pre-wrap bg-muted p-3 text-xs"
              >
                {JSON.stringify(
                  selected.check.commands ?? [selected.check.command],
                ) +
                  "\n" +
                  selected.check.output}
              </pre>
            </details>
          )}
          <p className="text-xs text-muted-foreground">{c[17]}</p>
          {selected.state === "verified" && (
            <Button
              disabled={busy}
              onClick={() =>
                void act(() =>
                  post(`/api/source-changes/${selected.id}/apply`, {
                    expectedRevision: selected.revision,
                  }),
                )
              }
            >
              {c[10]}
            </Button>
          )}
          {selected.state === "applied" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  post(`/api/source-changes/${selected.id}/rollback`, {
                    expectedRevision: selected.revision,
                  }),
                )
              }
            >
              {c[11]}
            </Button>
          )}
        </div>
      )}
      {notice !== null && (
        <p role={notice === 15 ? "alert" : "status"} className="text-sm">
          {c[notice]}
        </p>
      )}
    </details>
  );
}
