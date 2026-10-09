import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { useDocumentVisible } from "@/hooks/use-page-activity";
import { loadInferenceAccountingCopy } from "@/lib/inference-accounting-copy";
import { getInferenceAccountingSnapshot } from "@/lib/inference-accounting-api";
import { setupMessages } from "@/lib/i18n";

export default function InferenceAccountingPanel({
  scopeType,
  scopeId,
}: {
  scopeType: "task" | "agent";
  scopeId: number;
}) {
  const { locale, t } = useLocale(),
    visible = useDocumentVisible();
  const [open, setOpen] = useState(false);
  const copy = useQuery({
    queryKey: ["inference-accounting-copy", locale],
    queryFn: () => loadInferenceAccountingCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  const query = useQuery({
    queryKey: ["inference-accounting", scopeType, scopeId],
    queryFn: ({ signal }) =>
      getInferenceAccountingSnapshot(scopeType, scopeId, signal),
    enabled: visible && !!copy.data,
    retry: false,
    refetchInterval: visible ? (open ? 5000 : 30000) : false,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    if (query.isError || (query.data && query.data.status !== "clear"))
      setOpen(true);
  }, [query.data?.status, query.isError]);
  const c = copy.data,
    snapshot = query.data;
  if (!c)
    return (
      <section
        data-inference-accounting
        className="min-w-0 rounded-panel border bg-card p-4"
        role={copy.isError ? "alert" : "status"}
      >
        <p>
          {copy.isError
            ? setupMessages[locale].languageFileError
            : t("loadingScreen")}
        </p>
        {copy.isError && (
          <Button className="mt-2 min-h-11" onClick={() => void copy.refetch()}>
            {t("checkAgain")}
          </Button>
        )}
      </section>
    );
  return (
    <details
      data-inference-accounting
      data-accounting-status={
        query.isError ? "unverified" : (snapshot?.status ?? "loading")
      }
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mx-auto mt-4 min-w-0 max-w-[1680px] rounded-panel border bg-card p-4 text-sm sm:p-5"
    >
      <summary className="min-h-11 cursor-pointer break-words rounded-control font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        {c.title}
        <span className="mt-1 block font-normal text-muted-foreground">
          {query.isError
            ? c.error
            : snapshot
              ? c[snapshot.status]
              : t("loadingScreen")}
        </span>
      </summary>
      <div className="mt-3 min-w-0 space-y-3">
        {query.isError && <p role="alert">{c.error}</p>}
        {snapshot && (
          <>
            <p role="status" className="leading-6">
              {snapshot.status === "pending"
                ? c.pendingHelp
                : snapshot.status === "recovery_required"
                  ? c.recoveryHelp
                  : c.clearHelp}
            </p>
            <p className="text-muted-foreground">
              {c.observed}:{" "}
              <time dateTime={new Date(snapshot.observedAt).toISOString()}>
                {new Date(snapshot.observedAt).toLocaleString(locale)}
              </time>
            </p>
            <ul className="space-y-3" aria-label={c.title}>
              {snapshot.attempts.map((a) => (
                <li
                  key={a.id}
                  className="min-w-0 space-y-2 rounded-control border p-3"
                >
                  <p className="font-medium">{c.states[a.state]}</p>
                  <p className="break-words">
                    <bdi>
                      {a.provider} · {a.modelId}
                    </bdi>
                  </p>
                  <dl className="min-w-0">
                    <dt className="text-muted-foreground">{c.request}</dt>
                    <dd className="break-all font-mono">
                      <bdi>{a.id}</bdi>
                    </dd>
                  </dl>
                  <p>
                    {a.usage
                      ? `${a.usage.usageReported ? c.complete : c.lowerBound}: ${a.usage.totalTokens.toLocaleString(locale)} ${c.tokens}`
                      : c.unknownUsage}
                  </p>
                  <p className="text-muted-foreground">
                    {a.usage?.reportedCostUsd !== null &&
                    a.usage?.reportedCostUsd !== undefined ? (
                      <bdi>USD {a.usage.reportedCostUsd}</bdi>
                    ) : (
                      c.unknownCost
                    )}
                  </p>
                </li>
              ))}
            </ul>
            {snapshot.hasMore && (
              <p className="text-muted-foreground">{c.more}</p>
            )}
          </>
        )}
        <Button
          variant="outline"
          className="min-h-11 max-w-full whitespace-normal"
          disabled={query.isFetching}
          aria-busy={query.isFetching}
          onClick={() => void query.refetch({ cancelRefetch: false })}
        >
          {c.inspect}
        </Button>
      </div>
    </details>
  );
}
