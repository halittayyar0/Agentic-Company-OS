import type {
  AgentStatus,
  ModelTier,
  TaskPriority,
  TaskStatus,
} from "@workspace/api-client-react";
import { isLocale, type Locale } from "./i18n";

function currentLocale(): Locale {
  if (typeof document === "undefined") return "tr";
  const language = document.documentElement.lang;
  return isLocale(language) ? language : "tr";
}

function relativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  locale: Locale,
): string {
  return new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
    style: "short",
  }).format(value, unit);
}

export function timeAgo(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const locale = currentLocale();
  if (locale !== "tr") {
    if (seconds < 5) return relativeTime(0, "second", locale);
    if (seconds < 60) return relativeTime(-seconds, "second", locale);
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return relativeTime(-minutes, "minute", locale);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return relativeTime(-hours, "hour", locale);
    const days = Math.floor(hours / 24);
    if (days < 7) return relativeTime(-days, "day", locale);
    return date.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }
  if (seconds < 5) return "şimdi";
  if (seconds < 60) return `${seconds}s önce`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}sa önce`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}g önce`;
  return date.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

export function timeFromNow(
  input: string | Date,
  now: number | Date = Date.now(),
): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const nowMs = typeof now === "number" ? now : now.getTime();
  const seconds = Math.ceil((date.getTime() - nowMs) / 1000);
  const locale = currentLocale();
  if (locale !== "tr") {
    if (!Number.isFinite(seconds) || seconds <= 5)
      return relativeTime(0, "second", locale);
    if (seconds < 60) return relativeTime(seconds, "second", locale);
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return relativeTime(minutes, "minute", locale);
    const hours = Math.ceil(minutes / 60);
    if (hours < 24) return relativeTime(hours, "hour", locale);
    const days = Math.ceil(hours / 24);
    if (days < 7) return relativeTime(days, "day", locale);
    return date.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }

  if (!Number.isFinite(seconds) || seconds <= 5) return "şimdi";
  if (seconds < 60) return `${seconds}s sonra`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}dk sonra`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}sa sonra`;
  const days = Math.ceil(hours / 24);
  if (days < 7) return `${days}g sonra`;
  return date.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export const TIER_META: Record<
  ModelTier,
  { label: string; className: string }
> = {
  economy: {
    label: "Ekonomik",
    className:
      "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/25",
  },
  standard: {
    label: "Standart",
    className: "text-sky-700 dark:text-sky-300 bg-sky-500/10 border-sky-500/25",
  },
  premium: {
    label: "Premium",
    className:
      "text-violet-700 dark:text-violet-300 bg-violet-500/10 border-violet-500/25",
  },
  reasoning: {
    label: "Muhakeme",
    className:
      "text-amber-800 dark:text-amber-300 bg-amber-500/10 border-amber-500/25",
  },
};

export const PROVIDER_META: Record<
  string,
  { label: string; short: string; dotClass: string }
> = {
  replit: {
    label: "Yerleşik Filo",
    short: "Replit AI",
    dotClass: "bg-emerald-400",
  },
  openrouter: {
    label: "OpenRouter Ağı",
    short: "OpenRouter",
    dotClass: "bg-violet-400",
  },
  openai: {
    label: "OpenAI Doğrudan",
    short: "OpenAI",
    dotClass: "bg-sky-400",
  },
  ollama: {
    label: "Ollama Yerel",
    short: "Ollama",
    dotClass: "bg-amber-400",
  },
};

export const AGENT_STATUS_META: Record<
  AgentStatus,
  { label: string; dot: string; pillClass: string }
> = {
  idle: {
    label: "Boşta",
    dot: "bg-slate-400",
    pillClass:
      "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-400/20",
  },
  working: {
    label: "Çalışıyor",
    dot: "bg-emerald-400",
    pillClass:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-400/25",
  },
  blocked: {
    label: "Beklemede",
    dot: "bg-amber-400",
    pillClass:
      "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-400/25",
  },
  archived: {
    label: "Arşiv",
    dot: "bg-zinc-600",
    pillClass:
      "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
  },
};

export const TASK_STATUS_META: Record<
  TaskStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Kuyrukta",
    className:
      "text-slate-700 dark:text-slate-300 bg-slate-500/10 border-slate-400/20",
  },
  planning: {
    label: "Planlanıyor",
    className: "text-sky-700 dark:text-sky-300 bg-sky-500/10 border-sky-400/25",
  },
  in_progress: {
    label: "Sürüyor",
    className:
      "text-blue-700 dark:text-blue-300 bg-blue-500/10 border-blue-400/30",
  },
  awaiting_approval: {
    label: "Onay Bekliyor",
    className:
      "text-amber-800 dark:text-amber-300 bg-amber-500/10 border-amber-400/25",
  },
  blocked: {
    label: "Engelli",
    className:
      "text-orange-800 dark:text-orange-300 bg-orange-500/10 border-orange-400/25",
  },
  completed: {
    label: "Tamamlandı",
    className:
      "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-400/25",
  },
  failed: {
    label: "Başarısız",
    className:
      "text-rose-700 dark:text-rose-300 bg-rose-500/10 border-rose-400/25",
  },
  cancelled: {
    label: "İptal",
    className:
      "text-zinc-700 dark:text-zinc-400 bg-zinc-500/10 border-zinc-400/20",
  },
};

const TASK_STATUS_LABELS = {
  tr: {
    pending: "Kuyrukta",
    planning: "Planlanıyor",
    in_progress: "Sürüyor",
    awaiting_approval: "Onay Bekliyor",
    blocked: "Engelli",
    completed: "Tamamlandı",
    failed: "Başarısız",
    cancelled: "İptal",
  },
  en: {
    pending: "Queued",
    planning: "Planning",
    in_progress: "In progress",
    awaiting_approval: "Awaiting approval",
    blocked: "Blocked",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  },
  de: {
    pending: "In Warteschlange",
    planning: "In Planung",
    in_progress: "In Bearbeitung",
    awaiting_approval: "Wartet auf Freigabe",
    blocked: "Blockiert",
    completed: "Abgeschlossen",
    failed: "Fehlgeschlagen",
    cancelled: "Abgebrochen",
  },
  ru: {
    pending: "В очереди",
    planning: "Планирование",
    in_progress: "Выполняется",
    awaiting_approval: "Ожидает одобрения",
    blocked: "Заблокировано",
    completed: "Завершено",
    failed: "Ошибка",
    cancelled: "Отменено",
  },
  "zh-CN": {
    pending: "排队中",
    planning: "规划中",
    in_progress: "进行中",
    awaiting_approval: "等待批准",
    blocked: "已阻塞",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  },
  "zh-TW": {
    pending: "佇列中",
    planning: "規劃中",
    in_progress: "進行中",
    awaiting_approval: "等待核准",
    blocked: "已阻塞",
    completed: "已完成",
    failed: "失敗",
    cancelled: "已取消",
  },
  ar: {
    pending: "في الانتظار",
    planning: "قيد التخطيط",
    in_progress: "جارٍ التنفيذ",
    awaiting_approval: "بانتظار الموافقة",
    blocked: "متوقف",
    completed: "مكتمل",
    failed: "فشل",
    cancelled: "ملغى",
  },
} satisfies Record<Locale, Record<TaskStatus, string>>;

export function taskStatusLabel(
  status: TaskStatus,
  locale: Locale = currentLocale(),
): string {
  return TASK_STATUS_LABELS[locale][status];
}

export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; className: string }
> = {
  low: {
    label: "Düşük",
    className: "text-slate-700 dark:text-slate-400 border-slate-500/30",
  },
  normal: {
    label: "Normal",
    className: "text-sky-700 dark:text-sky-300 border-sky-400/30",
  },
  high: {
    label: "Yüksek",
    className: "text-amber-800 dark:text-amber-300 border-amber-400/40",
  },
  urgent: {
    label: "Acil",
    className:
      "text-rose-700 dark:text-rose-300 border-rose-400/50 animate-pulse",
  },
};

export const ACTIVITY_TYPE_ICON_HINT: Record<string, string> = {
  task_created: "Proje oluşturuldu",
  task_delegated: "Çalışma devredildi",
  task_status_changed: "Durum değişti",
  subagent_created: "Alt ajan kuruldu",
  progress_update: "İlerleme",
  judge_review: "Denetim",
  approval_requested: "Onay talebi",
  approval_resolved: "Onay kararı",
  vm_command: "Terminal",
  vm_file: "Dosya sistemi",
  note: "Not",
  error: "Hata",
};
