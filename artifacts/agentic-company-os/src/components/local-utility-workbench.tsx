import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  auditCsv,
  auditJson,
  compareLists,
  formatQuickReport,
  quickToolExamples,
  quickToolTranslations,
  type CsvAudit,
  type JsonAudit,
  type ListComparison,
  type QuickToolMode,
} from "../../../../site/quick-tools.mjs";

const MAX_BYTES = 256 * 1024;
const appCopy = {
  en: {
    title: "Get a useful result now",
    intro:
      "Check a small file or compare lists, even before connecting an AI model.",
    privacy:
      "These checks run in this browser tab. Your input is not sent to the server or a model.",
    provider: "Model settings for agent work",
    fileRead: "The local file could not be read. Try pasting its text.",
  },
  tr: {
    title: "Şimdi faydalı bir sonuç al",
    intro:
      "Yapay zekâ modeli bağlamadan da küçük bir dosyayı denetle veya listeleri karşılaştır.",
    privacy:
      "Bu kontroller bu tarayıcı sekmesinde çalışır. Girdi sunucuya veya modele gönderilmez.",
    provider: "Ajan işleri için model ayarları",
    fileRead: "Yerel dosya okunamadı. Metnini yapıştırmayı dene.",
  },
  de: {
    title: "Jetzt ein nützliches Ergebnis erhalten",
    intro:
      "Prüfe eine kleine Datei oder vergleiche Listen, auch ohne verbundenes KI-Modell.",
    privacy:
      "Diese Prüfungen laufen in diesem Browser-Tab. Deine Eingabe wird nicht an Server oder Modell gesendet.",
    provider: "Modelleinstellungen für Agentenarbeit",
    fileRead:
      "Die lokale Datei konnte nicht gelesen werden. Füge den Text ein.",
  },
  ru: {
    title: "Получите полезный результат сейчас",
    intro:
      "Проверьте небольшой файл или сравните списки без подключения модели ИИ.",
    privacy:
      "Проверки выполняются в этой вкладке. Ввод не отправляется на сервер или модели.",
    provider: "Настройки модели для работы агентов",
    fileRead: "Не удалось прочитать локальный файл. Попробуйте вставить текст.",
  },
  "zh-CN": {
    title: "现在就获得有用的结果",
    intro: "即使尚未连接 AI 模型，也可检查小文件或比较列表。",
    privacy: "检查在当前浏览器标签页运行。输入不会发送到服务器或模型。",
    provider: "代理工作的模型设置",
    fileRead: "无法读取本地文件，请尝试粘贴文本。",
  },
  "zh-TW": {
    title: "現在就取得有用的結果",
    intro: "即使尚未連接 AI 模型，也可檢查小檔案或比較清單。",
    privacy: "檢查在目前瀏覽器分頁執行。輸入不會傳送到伺服器或模型。",
    provider: "代理工作的模型設定",
    fileRead: "無法讀取本機檔案，請嘗試貼上文字。",
  },
  ar: {
    title: "احصل على نتيجة مفيدة الآن",
    intro: "افحص ملفاً صغيراً أو قارن القوائم حتى قبل ربط نموذج ذكاء اصطناعي.",
    privacy:
      "تجري هذه الفحوص في علامة تبويب المتصفح. لا يُرسل الإدخال إلى الخادم أو النموذج.",
    provider: "إعدادات النموذج لعمل الوكلاء",
    fileRead: "تعذّرت قراءة الملف المحلي. جرّب لصق النص.",
  },
} as const;

type Audit =
  | { mode: "csv"; data: CsvAudit }
  | { mode: "json"; data: JsonAudit }
  | { mode: "lists"; data: ListComparison };

export function LocalUtilityWorkbench() {
  const { locale } = useLocale();
  const copy = appCopy[locale];
  const words = quickToolTranslations[locale] ?? quickToolTranslations.en;
  const word = (key: string) =>
    words[key] ?? quickToolTranslations.en[key] ?? key;
  const [mode, setMode] = useState<QuickToolMode>("csv");
  const [csv, setCsv] = useState("");
  const [json, setJson] = useState("");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const result = audit
    ? audit.mode === "csv"
      ? formatQuickReport("csv", audit.data, locale)
      : audit.mode === "json"
        ? formatQuickReport("json", audit.data, locale)
        : formatQuickReport("lists", audit.data, locale)
    : null;

  const resetFeedback = () => {
    setAudit(null);
    setError("");
    setStatus("");
  };
  const useExample = () => {
    if (mode === "csv") setCsv(quickToolExamples.csv);
    if (mode === "json") setJson(quickToolExamples.json);
    if (mode === "lists") {
      setFirst(quickToolExamples.lists[0]);
      setSecond(quickToolExamples.lists[1]);
    }
    resetFeedback();
  };
  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    resetFeedback();
    if (file.size > MAX_BYTES) {
      setError("fileSize");
      return;
    }
    const selectedMode = mode;
    try {
      const content = await file.text();
      if (selectedMode === "csv") setCsv(content);
      if (selectedMode === "json") setJson(content);
    } catch {
      setError("fileRead");
    }
  };
  const run = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetFeedback();
    try {
      if (mode === "csv") setAudit({ mode, data: auditCsv(csv) });
      if (mode === "json") setAudit({ mode, data: auditJson(json) });
      if (mode === "lists")
        setAudit({ mode, data: compareLists(first, second) });
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "empty";
      setError(code === "size" ? "fileSize" : code in words ? code : "empty");
    }
  };
  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([`${result.summary}\n\n${result.report}\n`], {
        type: "text/plain;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `agentic-${mode}-report.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("downloaded");
  };
  return (
    <section
      id="utility-workbench"
      aria-labelledby="utility-workbench-title"
      className="min-w-0 space-y-5 rounded-panel border border-border bg-card p-5 sm:p-7"
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <h2 id="utility-workbench-title" className="text-xl font-semibold">
            {copy.title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {copy.intro}
          </p>
        </div>
        <Link
          href="/settings"
          className="inline-flex min-h-11 items-center self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {copy.provider}
        </Link>
      </div>
      <p className="border-s-2 border-primary ps-3 text-sm leading-6 text-muted-foreground">
        {copy.privacy}
      </p>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={`${word("csvTab")} / ${word("jsonTab")} / ${word("listsTab")}`}
      >
        {(["csv", "json", "lists"] as const).map((choice) => (
          <Button
            key={choice}
            type="button"
            variant={mode === choice ? "default" : "outline"}
            aria-pressed={mode === choice}
            onClick={() => {
              setMode(choice);
              resetFeedback();
            }}
          >
            {word(`${choice}Tab`)}
          </Button>
        ))}
      </div>
      <form onSubmit={run} className="space-y-4">
        {mode === "csv" ? (
          <label className="block space-y-2 text-sm font-medium">
            <span>{word("csvLabel")}</span>
            <textarea
              aria-label={word("csvLabel")}
              value={csv}
              onChange={(event) => {
                setCsv(event.target.value);
                resetFeedback();
              }}
              rows={7}
              spellCheck={false}
              className="min-h-40 w-full min-w-0 rounded-control border border-border bg-background p-3 font-mono text-sm leading-6"
            />
          </label>
        ) : mode === "json" ? (
          <label className="block space-y-2 text-sm font-medium">
            <span>{word("jsonLabel")}</span>
            <textarea
              aria-label={word("jsonLabel")}
              value={json}
              onChange={(event) => {
                setJson(event.target.value);
                resetFeedback();
              }}
              rows={7}
              spellCheck={false}
              className="min-h-40 w-full min-w-0 rounded-control border border-border bg-background p-3 font-mono text-sm leading-6"
            />
          </label>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["listALabel", first, setFirst],
                ["listBLabel", second, setSecond],
              ] as const
            ).map(([label, value, setter]) => (
              <label
                key={label}
                className="block min-w-0 space-y-2 text-sm font-medium"
              >
                <span>{word(label)}</span>
                <textarea
                  aria-label={word(label)}
                  value={value}
                  onChange={(event) => {
                    setter(event.target.value);
                    resetFeedback();
                  }}
                  rows={7}
                  spellCheck={false}
                  className="min-h-40 w-full min-w-0 rounded-control border border-border bg-background p-3 font-mono text-sm leading-6"
                />
              </label>
            ))}
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {mode !== "lists" ? (
            <label className="min-w-0 flex-1 text-sm text-muted-foreground">
              <span>{word("chooseFile")}</span>
              <input
                type="file"
                accept={
                  mode === "csv"
                    ? ".csv,text/csv,text/plain"
                    : ".json,application/json,text/plain"
                }
                onChange={(event) => void chooseFile(event)}
                className="mt-2 block w-full min-w-0 text-sm"
              />
            </label>
          ) : null}
          <Button type="button" variant="outline" onClick={useExample}>
            {word("sample")}
          </Button>
          <Button type="submit">{word("run")}</Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {word("limit")}
        </p>
      </form>
      {error ? (
        <p
          role="alert"
          className="rounded-control border-s-2 border-destructive bg-destructive/5 p-3 text-sm"
        >
          {error === "fileRead" ? copy.fileRead : word(error)}
        </p>
      ) : null}
      {result ? (
        <div className="space-y-3 border-t border-border pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">{word("resultTitle")}</h3>
              <p
                role="status"
                aria-live="polite"
                className="mt-1 text-sm text-muted-foreground"
              >
                {result.summary}
              </p>
            </div>
            <Button type="button" variant="outline" onClick={download}>
              {word("download")}
            </Button>
          </div>
          <pre
            className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-control bg-muted p-4 text-xs leading-6"
            dir="auto"
          >
            {result.report.length > 12000
              ? `${result.report.slice(0, 12000)}\n…`
              : result.report}
          </pre>
          <p role="status" aria-live="polite" className="text-sm">
            {status ? word(status) : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}
