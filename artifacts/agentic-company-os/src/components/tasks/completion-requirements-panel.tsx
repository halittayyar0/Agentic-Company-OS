import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { Link } from "wouter";
import { useLocale } from "@/components/i18n/locale-provider";
import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { Button } from "@/components/ui/button";
import { controlPlaneFetch } from "@/lib/auth";
import { loadCompletionRequirementsCopy } from "@/lib/completion-requirements-copy";
import { completionSnapshotView } from "@/lib/completion-requirements-view";
import type { CompletionRequirement } from "@/lib/completion-requirements-input";

export default function CompletionRequirementsPanel({
  taskId,
  requirements,
}: {
  taskId: number;
  requirements: CompletionRequirement[];
}) {
  const { locale, t } = useLocale();
  const copy = useQuery({
    queryKey: ["completion-requirements-copy", locale],
    queryFn: () => loadCompletionRequirementsCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  const state = useQuery({
    queryKey: ["task-completion-requirements", taskId],
    queryFn: async () => {
      const result = completionSnapshotView(
        await controlPlaneFetch<unknown>(
          `/api/tasks/${taskId}/completion-requirements`,
          {
            method: "GET",
            signal: AbortSignal.timeout(20_000),
            cache: "no-store",
          },
        ),
        taskId,
      );
      if (
        !result ||
        result.requirements.length !== requirements.length ||
        requirements.some(
          (item) =>
            !result.requirements.some(
              (row) => row.kind === item.kind && row.tool === item.tool,
            ),
        )
      )
        throw Error("invalid_completion_snapshot");
      return result;
    },
    enabled: requirements.length > 0,
    refetchInterval: 5_000,
    retry: false,
  });
  if (!requirements.length) return null;
  if (!copy.data)
    return (
      <LanguagePackStatus
        error={copy.isError}
        className="mt-4"
        onRetry={() => void copy.refetch()}
      />
    );
  const c = copy.data;
  const snapshot = state.isError || state.isFetching ? null : state.data;
  return (
    <section
      aria-labelledby="completion-condition-status-title"
      className="mt-4 min-w-0 space-y-3 rounded-panel border border-border bg-card p-4 text-sm leading-6 [overflow-wrap:anywhere]"
    >
      <h2 id="completion-condition-status-title" className="font-semibold">
        {c.title}
      </h2>
      <p className="text-muted-foreground">{c.sourceHelp}</p>
      {state.isFetching ? (
        <p role="status">{c.loading}</p>
      ) : state.isError ? (
        <p role="alert">{c.loadError}</p>
      ) : snapshot ? (
        <>
          <p>
            {c.cycle}{" "}
            {new Intl.NumberFormat(locale).format(snapshot.cycleNumber + 1)}
          </p>
          <ul className="space-y-3">
            {snapshot.requirements.map((item) => (
              <li key={item.tool} className="flex min-w-0 items-start gap-3">
                {item.satisfied ? (
                  <CheckCircle2
                    aria-hidden
                    className="mt-1 size-4 shrink-0 text-primary"
                  />
                ) : (
                  <Circle
                    aria-hidden
                    className="mt-1 size-4 shrink-0 text-muted-foreground"
                  />
                )}
                <div className="min-w-0">
                  <p className="font-medium">
                    {c.labels[item.tool] ?? c.other}
                  </p>
                  <bdi className="text-xs text-muted-foreground">
                    {item.tool}
                  </bdi>
                  <p>{item.satisfied ? c.satisfied : c.missing}</p>
                  {!item.available && (
                    <p className="text-attention">{c.unavailableActive}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {c.observed}:{" "}
            <time dateTime={snapshot.observedAt}>
              {new Date(snapshot.observedAt).toLocaleString(locale)}
            </time>
          </p>
        </>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 h-auto max-w-full whitespace-normal"
          disabled={state.isFetching}
          onClick={() => void state.refetch()}
        >
          {c.retry}
        </Button>
        <Link
          href="/settings"
          className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
        >
          {t("settings")}
        </Link>
      </div>
    </section>
  );
}
