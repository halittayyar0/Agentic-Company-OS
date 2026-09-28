import { useLocale } from "./i18n/locale-provider";
import { Button } from "./ui/button";
import type { PagerSnapshot, RecordPager } from "../lib/record-history";

export function HistoryControls<T>({
  history,
  copy,
}: {
  history: PagerSnapshot<T> & { pager: RecordPager<T>; limit: number };
  copy?: { error: string; stale: string; retry: string; loading: string };
}) {
  const { t, locale } = useLocale();
  const { page, pending, error, trail, pager, limit } = history;
  const number = new Intl.NumberFormat(locale);
  const historical = page?.beforeId !== null && page !== null;
  return (
    <nav aria-label={t("historyPages")} className="space-y-3 py-3">
      <p
        className="text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {pending
          ? (copy?.loading ?? t("historyLoading"))
          : page
            ? t("historyWindow")
                .replace("{page}", number.format(trail.length + 1))
                .replace("{count}", number.format(page.records.length))
                .replace("{limit}", number.format(limit))
            : ""}
      </p>
      {historical && (
        <p className="text-xs text-muted-foreground">{t("historyPaused")}</p>
      )}
      {error && (
        <div role="alert" className="space-y-2 text-sm">
          <p>{copy ? (page ? copy.stale : copy.error) : t("historyError")}</p>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={pending}
            onClick={() => void pager.retry()}
          >
            {copy?.retry ?? t("checkAgain")}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="h-auto min-h-11 whitespace-normal"
          disabled={pending || !trail.length}
          onClick={() => void pager.newer()}
        >
          {t("historyNewer")}
        </Button>
        <Button
          variant="outline"
          className="h-auto min-h-11 whitespace-normal"
          disabled={pending || !page?.nextBeforeId}
          onClick={() => void pager.older()}
        >
          {t("historyOlder")}
        </Button>
        <Button
          variant="outline"
          className="h-auto min-h-11 whitespace-normal"
          disabled={pending || (!historical && !error)}
          onClick={() => void pager.latest()}
        >
          {t("historyLatest")}
        </Button>
      </div>
    </nav>
  );
}
