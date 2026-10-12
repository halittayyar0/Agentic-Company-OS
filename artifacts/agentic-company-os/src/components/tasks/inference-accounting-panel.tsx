import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { useDocumentVisible } from "@/hooks/use-page-activity";
import { loadInferenceAccountingCopy } from "@/lib/inference-accounting-copy";
import {
  applySavedInferenceUsage,
  getInferenceAccountingSnapshot,
} from "@/lib/inference-accounting-api";
import { setupMessages } from "@/lib/i18n";

function paragraph(content: ReactNode, muted = false) {
  return (
    <p className={muted ? "text-muted-foreground" : "leading-6"}>{content}</p>
  );
}

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
  const client = useQueryClient(),
    guard = useRef(false),
    alive = useRef(true);
  const [applying, setApplying] = useState<string | null>(null),
    [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
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
    if (
      !query.isError &&
      query.data?.status === "clear" &&
      scopeType === "task"
    )
      void client.invalidateQueries({
        queryKey: ["task-response-retry", scopeId],
      });
  }, [query.data?.status, query.isError, scopeType, scopeId, client]);
  const c = copy.data,
    snapshot = query.data;
  const apply = async (attemptId: string) => {
    if (guard.current || !c) return;
    guard.current = true;
    setApplying(attemptId);
    setRecoveryNotice(null);
    try {
      const outcome = await applySavedInferenceUsage(
        scopeType,
        scopeId,
        attemptId,
      );
      if (!alive.current) return;
      setRecoveryNotice(outcome === "applied" ? c[2] : c[3]);
    } catch {
      if (alive.current) setRecoveryNotice(c[4]);
    } finally {
      guard.current = false;
      if (alive.current) {
        setApplying(null);
        void query.refetch({ cancelRefetch: false });
      }
    }
  };
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
  const [
    recover,
    recoverHelp,
    ,
    ,
    ,
    title,
    clear,
    pending,
    recovery_required,
    pendingHelp,
    recoveryHelp,
    clearHelp,
    inspect,
    error,
    observed,
    request,
    tokens,
    lowerBound,
    complete,
    unknownUsage,
    unknownCost,
    more,
    states,
  ] = c;
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
        {title}
        <span className="mt-1 block font-normal text-muted-foreground">
          {query.isError
            ? error
            : snapshot
              ? { clear, pending, recovery_required }[snapshot.status]
              : t("loadingScreen")}
        </span>
      </summary>
      <div className="mt-3 min-w-0 space-y-3">
        {recoveryNotice && (
          <p role="status" className="break-words leading-6">
            {recoveryNotice}
          </p>
        )}
        {query.isError && <p role="alert">{error}</p>}
        {snapshot && (
          <>
            <p role="status" className="leading-6">
              {snapshot.status === "pending"
                ? pendingHelp
                : snapshot.status === "recovery_required"
                  ? recoveryHelp
                  : clearHelp}
            </p>
            {paragraph(
              <>
                {observed}:{" "}
                <time dateTime={new Date(snapshot.observedAt).toISOString()}>
                  {new Date(snapshot.observedAt).toLocaleString(locale)}
                </time>
              </>,
              true,
            )}
            {snapshot.attempts.some((a) => a.savedEvidenceAvailable) &&
              paragraph(recoverHelp)}
            <ul className="space-y-3" aria-label={title}>
              {snapshot.attempts.map((a) => (
                <li
                  key={a.id}
                  className="min-w-0 space-y-2 rounded-control border p-3"
                >
                  <p className="font-medium">{states[a.state]}</p>
                  <bdi className="block break-words">
                    {a.provider} · {a.modelId}
                  </bdi>
                  <p className="break-all font-mono">
                    {request}: <bdi>{a.id}</bdi>
                  </p>
                  {paragraph(
                    a.usage
                      ? `${a.usage.usageReported ? complete : lowerBound}: ${a.usage.totalTokens.toLocaleString(locale)} ${tokens}`
                      : unknownUsage,
                  )}
                  {paragraph(
                    a.usage?.reportedCostUsd != null ? (
                      <bdi>USD {a.usage.reportedCostUsd}</bdi>
                    ) : (
                      unknownCost
                    ),
                    true,
                  )}
                  {a.savedEvidenceAvailable && (
                    <Button
                      variant="outline"
                      className="min-h-11 h-auto max-w-full whitespace-normal text-start"
                      disabled={!!applying || query.isError || query.isFetching}
                      aria-busy={applying === a.id}
                      onClick={() => void apply(a.id)}
                    >
                      {applying === a.id ? t("loadingScreen") : recover}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {snapshot.hasMore && paragraph(more, true)}
          </>
        )}
        <Button
          variant="outline"
          className="min-h-11 max-w-full whitespace-normal"
          disabled={query.isFetching}
          aria-busy={query.isFetching}
          onClick={() => void query.refetch({ cancelRefetch: false })}
        >
          {inspect}
        </Button>
      </div>
    </details>
  );
}
