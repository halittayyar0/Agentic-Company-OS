import { useId } from "react";
import { LANGUAGE_OPTIONS, isLocale } from "@/lib/i18n";
import { useLocale } from "./locale-provider";

/** Allows reviewing translated instructions without leaving an unsaved form. */
export function LanguageSelect({ disabled = false }: { disabled?: boolean }) {
  const id = useId();
  const { locale, setLocale, changingLocale, t } = useLocale();
  return (
    <label
      htmlFor={id}
      className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground"
    >
      {t("language")}
      <select
        id={id}
        value={locale}
        disabled={disabled || changingLocale}
        onChange={(event) => {
          if (isLocale(event.target.value)) setLocale(event.target.value);
        }}
        className="min-h-11 max-w-full rounded-control border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {LANGUAGE_OPTIONS.map((option) => (
          <option key={option.code} value={option.code} lang={option.code}>
            {option.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}
