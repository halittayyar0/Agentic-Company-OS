import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";

const words = {
  tr: "Kişisel skill ve araçlar|Yeni oluştur|Kimlik (user- ile başlar)|Başlık|Açıklama|Tür|Skill|Araç|Talimatlar|Temel araç|Sabit girdiler (JSON)|Kaydet|İptal|Düzenle|Etkin|Devre dışı|Dışa aktar|JSON içe aktar|Kaydedilemedi. Bilgileri kontrol et; güncel sürüm yeniden yüklendi.|Kaydedildi.|Araç paketleri|Değişiklikleri kaydet|Veri|Belgeler|Web|Kod|Planlama|Kişisel araçlar, seçtiğin yerleşik işlemi sabit girdilerle çalıştırır. Skill talimatları ek yetki vermez.|Henüz kişisel araç yok.",
  en: "Personal skills and tools|Create new|ID (starts with user-)|Title|Description|Type|Skill|Tool|Instructions|Underlying tool|Fixed inputs (JSON)|Save|Cancel|Edit|Enabled|Disabled|Export|Import JSON|Could not save. Check the input; the latest version was reloaded.|Saved.|Tool packs|Save changes|Data|Documents|Web|Code|Planning|Personal tools run a selected built-in operation with fixed inputs. Skill instructions grant no extra permissions.|No personal capabilities yet.",
  de: "Persönliche Skills und Werkzeuge|Neu erstellen|ID (beginnt mit user-)|Titel|Beschreibung|Typ|Skill|Werkzeug|Anweisungen|Basiswerkzeug|Feste Eingaben (JSON)|Speichern|Abbrechen|Bearbeiten|Aktiviert|Deaktiviert|Exportieren|JSON importieren|Speichern fehlgeschlagen. Eingaben prüfen; aktuelle Version wurde geladen.|Gespeichert.|Werkzeugpakete|Änderungen speichern|Daten|Dokumente|Web|Code|Planung|Persönliche Werkzeuge führen eine integrierte Operation mit festen Eingaben aus. Skill-Anweisungen gewähren keine zusätzlichen Rechte.|Noch keine persönlichen Erweiterungen.",
  ru: "Личные навыки и инструменты|Создать|ID (начинается с user-)|Название|Описание|Тип|Навык|Инструмент|Инструкции|Базовый инструмент|Фиксированные параметры (JSON)|Сохранить|Отмена|Изменить|Включено|Отключено|Экспорт|Импорт JSON|Не удалось сохранить. Проверьте данные; загружена актуальная версия.|Сохранено.|Наборы инструментов|Сохранить изменения|Данные|Документы|Веб|Код|Планирование|Личные инструменты выполняют встроенную операцию с фиксированными параметрами. Инструкции навыка не дают дополнительных прав.|Личных расширений пока нет.",
  "zh-CN":
    "个人技能和工具|新建|标识（以 user- 开头）|标题|描述|类型|技能|工具|说明|基础工具|固定输入（JSON）|保存|取消|编辑|已启用|已禁用|导出|导入 JSON|无法保存。请检查输入；已重新加载最新版本。|已保存。|工具包|保存更改|数据|文档|网页|代码|规划|个人工具使用固定输入运行所选内置操作。技能说明不会授予额外权限。|暂无个人扩展。",
  "zh-TW":
    "個人技能和工具|新增|識別碼（以 user- 開頭）|標題|描述|類型|技能|工具|說明|基礎工具|固定輸入（JSON）|儲存|取消|編輯|已啟用|已停用|匯出|匯入 JSON|無法儲存。請檢查輸入；已重新載入最新版本。|已儲存。|工具套件|儲存變更|資料|文件|網頁|程式碼|規劃|個人工具使用固定輸入執行所選內建操作。技能說明不會授予額外權限。|尚無個人擴充功能。",
  ar: "المهارات والأدوات الشخصية|إنشاء جديد|المعرّف (يبدأ بـ user-)|العنوان|الوصف|النوع|مهارة|أداة|التعليمات|الأداة الأساسية|مدخلات ثابتة (JSON)|حفظ|إلغاء|تعديل|مفعّل|معطّل|تصدير|استيراد JSON|تعذر الحفظ. تحقق من البيانات؛ أُعيد تحميل أحدث إصدار.|تم الحفظ.|حزم الأدوات|حفظ التغييرات|البيانات|المستندات|الويب|البرمجة|التخطيط|تشغّل الأدوات الشخصية عملية مدمجة بمدخلات ثابتة. لا تمنح تعليمات المهارة صلاحيات إضافية.|لا توجد إضافات شخصية بعد.",
};
type Manifest =
  | {
      schemaVersion: 1;
      id: string;
      title: string;
      description: string;
      kind: "skill";
      instructions: string;
    }
  | {
      schemaVersion: 1;
      id: string;
      title: string;
      description: string;
      kind: "tool";
      tool: string;
      defaults: Record<string, unknown>;
    };
type Entry = {
  id: string;
  revision: number;
  enabled: boolean;
  manifest: Manifest;
};
type Packs = { enabledPacks: string[]; revision: number };
const packIds = ["data", "documents", "web", "code", "planning"];
const operations = [
  "calculate",
  "analyze_text",
  "compare_text",
  "inspect_json",
  "profile_csv",
  "convert_datetime",
  "inspect_url",
  "hash_text",
  "csv_filter",
  "csv_sort",
  "csv_dedupe",
  "csv_join",
  "csv_to_json",
  "json_to_csv",
  "json_diff",
  "json_format",
  "render_report",
  "fill_template",
  "markdown_outline",
  "compare_page_text",
];
const fieldClass =
  "min-h-11 w-full rounded-xl border border-border bg-background p-3 text-base focus-visible:ring-2 focus-visible:ring-primary";
const call = <T,>(path: string, data?: unknown) =>
  customFetch<T>(
    `/api/skills/${path}`,
    data === undefined
      ? {}
      : {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
export function ExtensionLibrary() {
  const { locale, t } = useLocale(),
    c = words[locale].split("|"),
    cache = useQueryClient();
  const list = useQuery({
    queryKey: ["personal-capabilities"],
    queryFn: () => call<Entry[]>("extensions"),
    retry: false,
  });
  const packs = useQuery({
    queryKey: ["capability-packs"],
    queryFn: () => call<Packs>("packs"),
    retry: false,
  });
  const [selected, setSelected] = useState<string[] | null>(null),
    [draft, setDraft] = useState<Manifest | null>(null),
    [revision, setRevision] = useState(0),
    [defaults, setDefaults] = useState("{}"),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(false);
  const flight = useRef(false);
  async function mutate(operation: () => Promise<unknown>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setNotice(c[19]);
      setError(false);
      setDraft(null);
      setSelected(null);
    } catch {
      setNotice(c[18]);
      setError(true);
    } finally {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["personal-capabilities"] }),
        cache.invalidateQueries({ queryKey: ["capability-packs"] }),
        cache.invalidateQueries({ queryKey: ["capability-catalog"] }),
      ]);
      setBusy(false);
      flight.current = false;
    }
  }
  function edit(row?: Entry) {
    setDraft(
      row?.manifest ?? {
        schemaVersion: 1,
        id: "user-",
        title: "",
        description: "",
        kind: "skill",
        instructions: "",
      },
    );
    setRevision(row?.revision ?? 0);
    setDefaults(
      JSON.stringify(
        row?.manifest.kind === "tool" ? row.manifest.defaults : {},
        null,
        2,
      ),
    );
    setNotice("");
  }
  return (
    <section
      aria-labelledby="personal-capabilities-title"
      className="space-y-5 rounded-panel border border-border bg-card p-5 sm:p-7"
    >
      <h2 id="personal-capabilities-title" className="text-xl font-semibold">
        {c[0]}
      </h2>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        {c[27]}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy} onClick={() => edit()}>
          {c[1]}
        </Button>
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-border px-4 text-sm">
          {c[17]}
          <input
            aria-label={c[17]}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              try {
                if (file.size > 16000) throw Error();
                const value = JSON.parse(await file.text()) as Manifest;
                if (
                  value.schemaVersion !== 1 ||
                  !/^user-[a-z0-9][a-z0-9-]{0,59}$/u.test(value.id) ||
                  !["skill", "tool"].includes(value.kind)
                )
                  throw Error();
                setDraft(value);
                setRevision(
                  list.data?.find((row) => row.id === value.id)?.revision ?? 0,
                );
                setDefaults(
                  JSON.stringify(
                    value.kind === "tool" ? value.defaults : {},
                    null,
                    2,
                  ),
                );
              } catch {
                setNotice(c[18]);
                setError(true);
              }
            }}
          />
        </label>
      </div>
      {notice && <p role={error ? "alert" : "status"}>{notice}</p>}
      {(list.isError || packs.isError) && (
        <div role="alert">
          <p>{c[18]}</p>
          <Button
            variant="outline"
            onClick={() => {
              void list.refetch();
              void packs.refetch();
            }}
          >
            {t("checkAgain")}
          </Button>
        </div>
      )}
      {draft && (
        <form
          className="grid gap-4 rounded-xl border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(async () => {
              const manifest =
                draft.kind === "tool"
                  ? { ...draft, defaults: JSON.parse(defaults) }
                  : draft;
              return call("extensions", {
                manifest,
                expectedRevision: revision,
                enabled:
                  list.data?.find((row) => row.id === draft.id)?.enabled ??
                  true,
              });
            });
          }}
        >
          {(["id", "title", "description"] as const).map((key, index) => (
            <label key={key} className="space-y-2 text-sm">
              <span>{c[index + 2]}</span>
              <input
                className={fieldClass}
                required
                value={draft[key]}
                maxLength={
                  key === "description" ? 2000 : key === "title" ? 120 : 65
                }
                readOnly={key === "id" && revision > 0}
                disabled={busy}
                onChange={(event) =>
                  setDraft({ ...draft, [key]: event.target.value })
                }
              />
            </label>
          ))}
          <label className="space-y-2 text-sm">
            <span>{c[5]}</span>
            <select
              className={fieldClass}
              value={draft.kind}
              disabled={busy}
              onChange={(event) => {
                const base = {
                  schemaVersion: 1 as const,
                  id: draft.id,
                  title: draft.title,
                  description: draft.description,
                };
                setDraft(
                  event.target.value === "skill"
                    ? { ...base, kind: "skill", instructions: "" }
                    : {
                        ...base,
                        kind: "tool",
                        tool: "calculate",
                        defaults: {},
                      },
                );
              }}
            >
              <option value="skill">{c[6]}</option>
              <option value="tool">{c[7]}</option>
            </select>
          </label>
          {draft.kind === "skill" ? (
            <label className="space-y-2 text-sm">
              <span>{c[8]}</span>
              <textarea
                className={fieldClass}
                rows={6}
                required
                maxLength={8000}
                disabled={busy}
                value={draft.instructions}
                onChange={(event) =>
                  setDraft({ ...draft, instructions: event.target.value })
                }
              />
            </label>
          ) : (
            <>
              <label className="space-y-2 text-sm">
                <span>{c[9]}</span>
                <select
                  className={fieldClass}
                  disabled={busy}
                  value={draft.tool}
                  onChange={(event) =>
                    setDraft({ ...draft, tool: event.target.value })
                  }
                >
                  {operations.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span>{c[10]}</span>
                <textarea
                  dir="ltr"
                  className={fieldClass}
                  rows={4}
                  maxLength={8000}
                  disabled={busy}
                  value={defaults}
                  onChange={(event) => setDefaults(event.target.value)}
                />
              </label>
            </>
          )}
          <div className="flex gap-3">
            <Button disabled={busy} type="submit">
              {c[11]}
            </Button>
            <Button
              disabled={busy}
              type="button"
              variant="outline"
              onClick={() => setDraft(null)}
            >
              {c[12]}
            </Button>
          </div>
        </form>
      )}
      {!list.data ? (
        <p role="status">{t("loadingScreen")}</p>
      ) : list.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{c[28]}</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.data.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-4 py-4"
            >
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">{row.manifest.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {row.manifest.description}
                </p>
                <small>{row.id}</small>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => edit(row)}
                >
                  {c[13]}
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  aria-pressed={row.enabled}
                  onClick={() =>
                    void mutate(() =>
                      call("extensions", {
                        manifest: row.manifest,
                        enabled: !row.enabled,
                        expectedRevision: row.revision,
                      }),
                    )
                  }
                >
                  {row.enabled ? c[14] : c[15]}
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void mutate(async () => {
                      const manifest = await call<Manifest>(
                        `extensions/${encodeURIComponent(row.id)}/export`,
                      );
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(manifest, null, 2)], {
                          type: "application/json",
                        }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${row.id}.json`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    })
                  }
                >
                  {c[16]}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {packs.data && (
        <fieldset className="space-y-3 border-t border-border pt-5">
          <legend className="pt-5 font-semibold">{c[20]}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {packIds.map((id, index) => (
              <label
                key={id}
                className="flex min-h-11 items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="size-5"
                  disabled={busy}
                  checked={(selected ?? packs.data!.enabledPacks).includes(id)}
                  onChange={(event) => {
                    const current = selected ?? packs.data!.enabledPacks;
                    setSelected(
                      event.target.checked
                        ? [...current, id]
                        : current.filter((key) => key !== id),
                    );
                  }}
                />
                {c[22 + index]}
              </label>
            ))}
          </div>
          <Button
            disabled={busy || selected === null}
            variant="outline"
            onClick={() =>
              void mutate(() =>
                call("packs", {
                  enabledPacks: selected,
                  expectedRevision: packs.data!.revision,
                }),
              )
            }
          >
            {c[21]}
          </Button>
        </fieldset>
      )}
    </section>
  );
}
