import { useState, type ReactNode } from "react";
import { ArrowRight, Languages } from "lucide-react";
import { useLocale } from "./locale-provider";
import {
  directionForLocale,
  LANGUAGE_OPTIONS,
  setupMessages,
  type Locale,
} from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageSetup({ children }: { children: ReactNode }) {
  const { selected } = useLocale();
  return selected ? children : <LanguageSelection />;
}

function LanguageSelection() {
  const { setLocale } = useLocale();
  const [choice, setChoice] = useState<Locale>("tr");

  return (
    <main
      dir={directionForLocale(choice)}
      lang={choice}
      className="flex min-h-screen items-center justify-center bg-background px-[16px] py-10 text-foreground [overflow-wrap:anywhere] sm:px-8"
    >
      <div className="min-w-0 w-full max-w-2xl rounded-panel border border-border bg-card px-[24px] py-6 shadow-[0_22px_70px_-45px_hsl(var(--foreground)/0.4)] sm:p-10">
        <div className="flex size-12 items-center justify-center rounded-control bg-primary/10 text-primary">
          <Languages size={24} aria-hidden />
        </div>
        <p className="mt-7 text-sm font-semibold text-primary">
          Agentic Company OS
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
          {messagesForChoice(choice).chooseLanguage}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          {messagesForChoice(choice).setupDescription}
        </p>
        {choice !== "tr" ? (
          <p className="mt-3 max-w-xl text-xs leading-5 text-muted-foreground">
            {messagesForChoice(choice).translationPreview}
          </p>
        ) : null}
        <div
          className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2"
          role="radiogroup"
          aria-label={messagesForChoice(choice).language}
        >
          {LANGUAGE_OPTIONS.map((option, index) => (
            <button
              key={option.code}
              type="button"
              role="radio"
              aria-checked={choice === option.code}
              tabIndex={choice === option.code ? 0 : -1}
              lang={option.code}
              dir={option.code === "ar" ? "rtl" : "ltr"}
              onClick={() => setChoice(option.code)}
              onKeyDown={(event) => {
                const direction =
                  event.key === "ArrowRight" || event.key === "ArrowDown"
                    ? 1
                    : event.key === "ArrowLeft" || event.key === "ArrowUp"
                      ? -1
                      : 0;
                const nextIndex =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? LANGUAGE_OPTIONS.length - 1
                      : direction
                        ? (index + direction + LANGUAGE_OPTIONS.length) %
                          LANGUAGE_OPTIONS.length
                        : null;
                if (nextIndex === null) return;
                event.preventDefault();
                setChoice(LANGUAGE_OPTIONS[nextIndex].code);
                const radios =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '[role="radio"]',
                  );
                radios?.[nextIndex]?.focus();
              }}
              className={cn(
                "flex min-h-16 min-w-0 items-center justify-between gap-[16px] rounded-control border px-[16px] py-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-4 sm:px-4",
                choice === option.code
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border hover:border-primary/50 hover:bg-background",
              )}
            >
              <span className="min-w-0">
                <span className="block text-base font-semibold">
                  {option.nativeName}
                </span>
                <span lang="en" className="block text-xs text-muted-foreground">
                  {option.englishName}
                </span>
              </span>
              <span
                className={cn(
                  "size-[16px] shrink-0 rounded-full border-2",
                  choice === option.code
                    ? "border-primary bg-primary shadow-[inset_0_0_0_3px_hsl(var(--card))]"
                    : "border-input",
                )}
                aria-hidden
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setLocale(choice)}
          className="mt-8 inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-2 rounded-control bg-primary px-[20px] py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-5"
        >
          {messagesForChoice(choice).continue}
          <ArrowRight size={17} className="rtl:rotate-180" aria-hidden />
        </button>
      </div>
    </main>
  );
}

function messagesForChoice(locale: Locale) {
  return setupMessages[locale];
}
