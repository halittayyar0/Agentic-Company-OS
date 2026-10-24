import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTaskResultReview,
  type ApprovalRequest,
  type ApprovalDecisionInput,
} from "@workspace/api-client-react";
import { useLocale } from "../i18n/locale-provider";
import { LanguagePackStatus } from "../i18n/language-pack-status";
import { useOpsControl } from "../ops/ops-control-provider";
import { Button } from "../ui/button";
import { getAuthStatus } from "../../lib/auth";
import { loadTaskResultReviewCopy } from "../../lib/task-result-review-copy";
import { readTaskResultReview } from "../../lib/task-result-review-input";
import { useClock } from "../../hooks/use-clock";
const ResultTable = lazy(() => import("./result-table"));

export default function OperatorResultReview({
  approval,
  approvalFingerprint,
  blocked,
  onBusyChange,
  onRefresh,
  onResolved,
  onClose,
  closeLabel,
  resolve,
}: {
  approval: ApprovalRequest;
  approvalFingerprint: string;
  blocked: boolean;
  onBusyChange: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
  onResolved: (message: string) => Promise<void>;
  onClose: () => void;
  closeLabel: string;
  resolve: (data: ApprovalDecisionInput) => Promise<ApprovalRequest>;
}) {
  const { locale } = useLocale(),
    id = useId(),
    now = useClock(1000).getTime();
  const copy = useQuery({
    queryKey: ["task-result-review-copy", locale],
    queryFn: () => loadTaskResultReviewCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  const auth = useQuery({
    queryKey: ["auth-status"],
    queryFn: getAuthStatus,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
  const credentialReady =
    !auth.isError &&
    auth.data?.enabled === true &&
    auth.data.authenticated === true &&
    (auth.data.sessionExpiresAt === null ||
      Date.parse(auth.data.sessionExpiresAt) > now);
  const metadata = approval.resultReview;
  const available =
    approval.scope?.toolName === "operator_confirm_task_result" &&
    metadata?.kind === "task_result" &&
    metadata.available === true &&
    /^[a-f0-9]{64}$/u.test(metadata.proposalHash ?? "") &&
    metadata.proposalHash === approval.scope.argsHash &&
    Number.isSafeInteger(metadata.cycleNumber) &&
    Number(metadata.cycleNumber) >= 0 &&
    approval.status === "pending" &&
    approval.consumedAt === null &&
    Date.parse(approval.expiresAt ?? "") > now;
  const review = useQuery({
    queryKey: ["task-result-review", approval.id, metadata?.proposalHash],
    queryFn: () => getTaskResultReview(approval.id, { cache: "no-store" }),
    enabled: credentialReady && available && !blocked,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    gcTime: 0,
  });
  const value =
    !review.isError && credentialReady
      ? readTaskResultReview(review.data, approval, now)
      : null;
  const fingerprint = approvalFingerprint;
  const reviewKey = `${fingerprint}:${review.dataUpdatedAt}`;
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [failed, setFailed] = useState(false),
    [saving, setSaving] = useState(false);
  const busy = useRef(false),
    client = useQueryClient(),
    ops = useOpsControl();
  useEffect(() => {
    setAcknowledged(null);
  }, [fingerprint, review.dataUpdatedAt, review.isFetching, credentialReady]);
  useEffect(() => {
    if (!credentialReady)
      client.removeQueries({ queryKey: ["task-result-review", approval.id] });
  }, [credentialReady, approval.id, client]);
  const checked = acknowledged === reviewKey && !!value && !review.isFetching;
  const canConfirm =
    checked &&
    !blocked &&
    !saving &&
    !failed &&
    !ops.controlsBlocked &&
    !auth.isFetching;
  async function refresh() {
    if (busy.current) return;
    setAcknowledged(null);
    const credentials = await auth.refetch();
    await onRefresh();
    if (
      credentials.isSuccess &&
      credentials.data.enabled &&
      credentials.data.authenticated &&
      available
    ) {
      const fresh = await review.refetch();
      if (
        fresh.isSuccess &&
        readTaskResultReview(fresh.data, approval, Date.now())
      )
        setFailed(false);
    }
  }
  async function decide(decision: "approved" | "rejected") {
    if (
      busy.current ||
      blocked ||
      failed ||
      !credentialReady ||
      auth.isFetching ||
      !copy.data ||
      (decision === "approved" && !canConfirm)
    )
      return;
    const exact = readTaskResultReview(review.data, approval, Date.now());
    if (decision === "approved" && !exact) return;
    busy.current = true;
    setSaving(true);
    onBusyChange(true);
    setAcknowledged(null);
    try {
      const currentAuth = await auth.refetch();
      if (
        !currentAuth.isSuccess ||
        !currentAuth.data.enabled ||
        !currentAuth.data.authenticated ||
        (currentAuth.data.sessionExpiresAt !== null &&
          Date.parse(currentAuth.data.sessionExpiresAt) <= Date.now())
      )
        throw Error("unconfirmed");
      const saved = await resolve({
        decision,
        locale,
        ...(decision === "approved"
          ? { expectedArgsHash: exact!.proposalHash, confirmTaskResult: true }
          : {}),
      });
      if (
        saved.id !== approval.id ||
        saved.status !== decision ||
        (decision === "approved" && !saved.consumedAt)
      )
        throw Error("unconfirmed");
      client.removeQueries({ queryKey: ["task-result-review", approval.id] });
      await onResolved(
        decision === "approved" ? copy.data.confirmed : copy.data.rejected,
      );
      onClose();
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }
  if (!copy.data)
    return (
      <LanguagePackStatus
        error={copy.isError}
        onRetry={() => window.location.reload()}
      />
    );
  const c = copy.data;
  return (
    <section
      aria-label={c.title}
      className="mt-4 min-w-0 space-y-4 border-t border-border pt-4 text-sm leading-relaxed [overflow-wrap:anywhere]"
    >
      <h3 className="font-semibold">{c.title}</h3>
      <p className="text-muted-foreground">{c.help}</p>
      {!credentialReady && (
        <p role="status">{auth.isFetching ? c.loading : c.auth}</p>
      )}
      {credentialReady &&
        (review.isFetching ? (
          <p role="status">{c.loading}</p>
        ) : (
          !value && <p role="alert">{c.unavailable}</p>
        ))}
      {value && (
        <>
          <p className="rounded-control border border-attention/40 p-3 text-attention-foreground">
            {c[value.judgeReasonCode]}
          </p>
          <dl className="space-y-2">
            <div>
              <dt className="font-medium">{c.digest}</dt>
              <dd dir="ltr" className="break-all font-mono text-xs">
                {value.proposalHash}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">{c.cycle}: </dt>
              <dd className="inline">
                {new Intl.NumberFormat(locale).format(value.cycleNumber)}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">{c.expires}: </dt>
              <dd className="inline">
                <bdi>
                  {new Intl.DateTimeFormat(locale, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZoneName: "short",
                  }).format(new Date(value.expiresAt))}
                </bdi>
              </dd>
            </div>
          </dl>
          <Suspense fallback={<p role="status">{c.loading}</p>}>
            <ResultTable
              content={value.resultSummary}
              format={value.resultFormat}
              label={c.title}
            />
          </Suspense>
          {!!value.requirements.length && (
            <div>
              <h4 className="font-medium">{c.requirements}</h4>
              <ul className="mt-2 space-y-1">
                {value.requirements.map((item) => (
                  <li key={item.tool}>
                    <bdi dir="ltr" className="font-mono text-xs">
                      {item.tool}
                    </bdi>{" "}
                    · {c.satisfied}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {failed && (
        <p role="alert" className="text-destructive">
          {c.error}
        </p>
      )}
      {ops.controlsBlocked && <p role="status">{c.safety}</p>}
      <label htmlFor={id} className="flex min-h-11 items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={
            !value ||
            blocked ||
            saving ||
            failed ||
            review.isFetching ||
            !credentialReady
          }
          onChange={(event) =>
            setAcknowledged(event.target.checked ? reviewKey : null)
          }
          className="mt-1 size-5 shrink-0 accent-primary"
        />
        <span>{c.acknowledge}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="h-auto min-h-11 max-w-full whitespace-normal"
          disabled={saving}
          onClick={() => {
            client.removeQueries({
              queryKey: ["task-result-review", approval.id],
            });
            onClose();
          }}
        >
          {closeLabel}
        </Button>
        <Button
          variant="outline"
          className="h-auto min-h-11 max-w-full whitespace-normal"
          disabled={saving || auth.isFetching || review.isFetching}
          onClick={() => void refresh()}
        >
          {c.refresh}
        </Button>
        <Button
          variant="outline"
          className="h-auto min-h-11 max-w-full whitespace-normal"
          disabled={
            saving ||
            blocked ||
            failed ||
            !credentialReady ||
            auth.isFetching ||
            approval.status !== "pending"
          }
          aria-busy={saving}
          onClick={() => void decide("rejected")}
        >
          {c.reject}
        </Button>
        <Button
          className="h-auto min-h-11 max-w-full whitespace-normal"
          disabled={!canConfirm}
          aria-busy={saving}
          onClick={() => void decide("approved")}
        >
          {c.confirm}
        </Button>
      </div>
    </section>
  );
}
