import type { Locale } from "./i18n";

const APPROACH_LABELS = {
  tr: "Çalışma yaklaşımı",
  en: "Work approach",
  de: "Arbeitsansatz",
  ru: "Подход к работе",
  "zh-CN": "工作方式",
  "zh-TW": "工作方式",
  ar: "أسلوب العمل",
} satisfies Record<Locale, string>;

export function composeProjectBrief(
  outcome: string,
  locale: Locale,
  modeLabel: string,
  instruction: string,
): string {
  return `${outcome}\n\n${APPROACH_LABELS[locale]} — ${modeLabel}: ${instruction}`;
}

export function splitProjectBrief(brief: string): {
  outcome: string;
  approach: string | null;
} {
  let lastMarker = -1;
  let lastSeparator = "";
  for (const label of new Set(Object.values(APPROACH_LABELS))) {
    const separator = `\n\n${label} — `;
    const marker = brief.lastIndexOf(separator);
    if (marker > lastMarker) {
      lastMarker = marker;
      lastSeparator = separator;
    }
  }
  if (lastMarker < 0) return { outcome: brief, approach: null };

  const outcome = brief.slice(0, lastMarker).trim();
  const instruction = brief.slice(lastMarker + lastSeparator.length);
  const labelEnd = instruction.indexOf(":");
  const approach =
    labelEnd > 0 ? instruction.slice(0, labelEnd).trim() || null : null;
  return { outcome: outcome || brief, approach };
}
