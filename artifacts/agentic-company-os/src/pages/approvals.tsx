import { useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetOrgSummaryQueryKey,
  getGetTaskQueryKey,
  getListAgentsQueryKey,
  getListApprovalsQueryKey,
  getListTasksQueryKey,
  useListAgents,
  useListApprovals,
  useResolveApproval,
  type ApprovalRequest,
  type ApprovalStatus,
} from "@workspace/api-client-react";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useClock } from "@/hooks/use-clock";
import { directionForLocale, type Locale } from "@/lib/i18n";
import { loadApprovalCopy, type ApprovalCopy } from "@/lib/approval-copy";
import {
  approvalExpired,
  hasReviewableScope,
  approvalReviewFingerprint,
  approvalErrorCopy,
} from "@/lib/approval-review";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const statuses: ApprovalStatus[] = ["pending", "approved", "rejected"];
const dateLabel = (value: string | null | undefined, locale: Locale) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export default function Approvals() {
  const { locale, t } = useLocale();
  const copy = useQuery({
    queryKey: ["approval-copy", locale],
    queryFn: () => loadApprovalCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return (
      <section
        className="rounded-xl border bg-card p-6"
        role={copy.isError ? "alert" : "status"}
      >
        <p>{copy.isError ? t("approvalCopyError") : t("loadingScreen")}</p>
        {copy.isError && (
          <Button className="mt-4" onClick={() => window.location.reload()}>
            {t("checkAgain")}
          </Button>
        )}
      </section>
    );
  return <ApprovalInbox copy={copy.data} locale={locale} />;
}

function ApprovalInbox({
  copy: c,
  locale,
}: {
  copy: ApprovalCopy;
  locale: Locale;
}) {
  const [tab, setTab] = useState<ApprovalStatus>("pending");
  const [cursors, setCursors] = useState<number[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [confirmation, setConfirmation] = useState<ApprovalRequest | null>(
    null,
  );
  const [digest, setDigest] = useState("");
  const [failure, setFailure] = useState<keyof ApprovalCopy | null>(null);
  const [result, setResult] = useState<"approved" | "rejected" | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [resolving, setResolving] = useState(false);
  const busy = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const confirmationInput = useRef<HTMLInputElement>(null);
  const now = useClock(1000).getTime();
  const ops = useOpsControl();
  const client = useQueryClient();
  const params = { status: tab, limit: PAGE_SIZE, beforeId: cursors.at(-1) };
  const requests = useListApprovals(params, {
    query: {
      queryKey: getListApprovalsQueryKey(params),
      retry: false,
      refetchInterval: 5000,
      refetchOnWindowFocus: "always",
    },
  });
  const agents = useListAgents(
    { includeInactive: true },
    {
      query: {
        queryKey: getListAgentsQueryKey({ includeInactive: true }),
        retry: false,
      },
    },
  );
  const mutation = useResolveApproval();
  const blocked = needsRefresh || requests.isError || resolving;
  const safetyCopy =
    ops.isLoading || ops.isError ? c.safetyUnknown : c.safetyStopped;
  const currentConfirmation = requests.data?.find(
    (request) => request.id === confirmation?.id,
  );
  const changed = Boolean(
    confirmation &&
    (!currentConfirmation ||
      approvalReviewFingerprint(currentConfirmation) !==
        approvalReviewFingerprint(confirmation)),
  );
  const closeConfirmation = () => {
    setConfirmation(null);
    setDigest("");
  };
  const refresh = async () => {
    const fresh = await requests.refetch();
    if (fresh.isSuccess) {
      setFailure(null);
      setNeedsRefresh(false);
    }
    ops.refetch();
  };
  async function decide(
    approval: ApprovalRequest,
    decision: "approved" | "rejected",
    enteredDigest?: string,
  ) {
    if (busy.current || blocked) return;
    const live = requests.data?.find((request) => request.id === approval.id);
    if (
      !live ||
      live.status !== "pending" ||
      approvalReviewFingerprint(live) !== approvalReviewFingerprint(approval)
    ) {
      setFailure("changedError");
      setNeedsRefresh(true);
      return;
    }
    if (
      decision === "approved" &&
      (ops.controlsBlocked ||
        approvalExpired(live, Date.now()) ||
        !hasReviewableScope(live) ||
        live.consumedAt)
    )
      return;
    busy.current = true;
    setResolving(true);
    setFailure(null);
    setResult(null);
    try {
      await mutation.mutateAsync({
        approvalId: live.id,
        data: {
          decision,
          locale,
          note: notes[live.id] || undefined,
          ...(decision === "approved"
            ? { expectedArgsHash: live.scope?.argsHash ?? null }
            : {}),
          ...(enteredDigest ? { confirmation: enteredDigest } : {}),
        },
      });
      setResult(decision);
      closeConfirmation();
      setNotes((previous) => {
        const next = { ...previous };
        delete next[live.id];
        return next;
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: getListApprovalsQueryKey() }),
        client.invalidateQueries({ queryKey: getGetOrgSummaryQueryKey() }),
        client.invalidateQueries({ queryKey: getListTasksQueryKey() }),
        client.invalidateQueries({ queryKey: getGetTaskQueryKey(live.taskId) }),
      ]);
    } catch (error) {
      setFailure(approvalErrorCopy(error));
      setNeedsRefresh(true);
    } finally {
      busy.current = false;
      setResolving(false);
    }
  }
  const expiry = confirmation ? approvalExpired(confirmation, now) : false;
  const canConfirm = Boolean(
    confirmation &&
    !blocked &&
    !changed &&
    !ops.controlsBlocked &&
    !expiry &&
    hasReviewableScope(confirmation) &&
    !confirmation.consumedAt &&
    digest.trim().toLowerCase() ===
      confirmation.scope?.argsHash.slice(0, 8).toLowerCase(),
  );
  const emptyTitle =
    tab === "pending"
      ? c.emptyPending
      : tab === "approved"
        ? c.emptyApproved
        : c.emptyRejected;
  const emptyHelp =
    tab === "pending"
      ? c.emptyPendingHelp
      : tab === "approved"
        ? c.emptyApprovedHelp
        : c.emptyRejectedHelp;
  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-8 [overflow-wrap:anywhere]">
      <header className="border-b pb-5">
        <p className="text-sm font-medium text-primary">{c.eyebrow}</p>
        <h1
          ref={heading}
          tabIndex={-1}
          className="mt-1 text-3xl font-semibold tracking-tight focus-visible:outline-none"
        >
          {c.title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          {c.description}
        </p>
      </header>
      {result && (
        <section role="status" className="rounded-xl border bg-card p-4">
          <h2 className="font-semibold">
            {result === "approved" ? c.approvedSaved : c.rejectedSaved}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {result === "approved" ? c.approvedHelp : c.rejectedHelp}
          </p>
        </section>
      )}
      {failure && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 p-4 text-sm leading-6"
        >
          {c[failure]}
        </p>
      )}
      {ops.controlsBlocked && tab === "pending" && (
        <p role="status" className="rounded-xl border p-4 text-sm leading-6">
          {safetyCopy}
        </p>
      )}
      <Tabs
        value={tab}
        dir={directionForLocale(locale)}
        onValueChange={(value) => {
          if (resolving) return;
          setTab(value as ApprovalStatus);
          setCursors([]);
          setResult(null);
        }}
      >
        <TabsList
          aria-label={c.title}
          className="grid h-auto w-full grid-cols-3 gap-1"
        >
          {statuses.map((status) => (
            <TabsTrigger
              key={status}
              value={status}
              disabled={resolving}
              className="min-h-11 whitespace-normal px-2 py-2 text-sm"
            >
              {c[status]}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="my-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {c.shown}:{" "}
            {requests.data
              ? new Intl.NumberFormat(locale).format(requests.data.length)
              : "—"}
          </p>
          <Button
            variant="outline"
            className="h-auto min-h-11 whitespace-normal"
            disabled={resolving || requests.isFetching}
            onClick={() => void refresh()}
          >
            {c.retry}
          </Button>
        </div>
        <TabsContent value={tab} className="space-y-4">
          {requests.isError && requests.data && (
            <p role="alert" className="rounded-xl border p-4 text-sm leading-6">
              {c.stale}
            </p>
          )}
          {requests.isLoading ? (
            <p role="status" className="rounded-xl border bg-card p-6">
              {c.loading}
            </p>
          ) : requests.isError && !requests.data ? (
            <p role="alert" className="rounded-xl border p-6">
              {c.loadError}
            </p>
          ) : requests.data?.length === 0 ? (
            <section className="rounded-xl border bg-card p-6 text-center">
              <h2 className="font-semibold">
                {cursors.length ? c.emptyPage : emptyTitle}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {cursors.length ? c.newer : emptyHelp}
              </p>
            </section>
          ) : (
            requests.data?.map((approval) => {
              const agent = agents.data?.find(
                (candidate) => candidate.id === approval.agentId,
              );
              const host = approval.scope?.toolName === "vm_run_sudo_command";
              const expired = approvalExpired(approval, now);
              const invalidScope = !hasReviewableScope(approval);
              const amount =
                approval.amountUsd === null ? null : Number(approval.amountUsd);
              return (
                <article
                  key={approval.id}
                  aria-labelledby={`approval-${approval.id}`}
                  className={cn(
                    "min-w-0 rounded-xl border bg-card p-4 sm:p-5",
                    host && "border-destructive/40",
                  )}
                >
                  <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-xs font-medium",
                          host ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {host ? c.hostCategory : c[approval.category]}
                      </p>
                      <h2
                        id={`approval-${approval.id}`}
                        className="mt-1 text-lg font-semibold"
                      >
                        <bdi>{host ? c.hostTitle : approval.title}</bdi>
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <bdi>{dateLabel(approval.createdAt, locale)}</bdi> ·{" "}
                        {c[approval.status]}
                      </p>
                    </div>
                    <Link
                      href={`/agents/${approval.agentId}`}
                      className="flex min-h-11 max-w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="text-muted-foreground">
                        {c.requester}
                      </span>
                      <bdi>
                        {agent?.name ??
                          `${c.unknownRequester} #${approval.agentId}`}
                      </bdi>
                    </Link>
                  </div>
                  {host ? (
                    <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm leading-6">
                      <p className="font-medium">{c.hostWarning}</p>
                      <p className="mt-2 text-muted-foreground">
                        {c.hostDetails}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        <bdi>{approval.description}</bdi>
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {c.source}
                      </p>
                    </div>
                  )}
                  {approval.scope ? (
                    <ScopeDetails
                      approval={approval}
                      copy={c}
                      locale={locale}
                      now={now}
                    />
                  ) : (
                    <p className="mt-4 rounded-lg border p-3 text-xs leading-5 text-muted-foreground">
                      {c.unscoped}
                    </p>
                  )}
                  {amount !== null && Number.isFinite(amount) && amount > 0 && (
                    <p className="mt-4 text-lg font-semibold">
                      <bdi>
                        {new Intl.NumberFormat(locale, {
                          style: "currency",
                          currency: "USD",
                        }).format(amount)}
                      </bdi>
                    </p>
                  )}
                  <Link
                    href={`/projects/${approval.taskId}`}
                    className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {c.task} · #{approval.taskId}
                    <ArrowRight
                      aria-hidden
                      size={15}
                      className="rtl:rotate-180"
                    />
                  </Link>
                  {approval.decisionNote && (
                    <div className="mt-3 rounded-lg border p-3">
                      <h3 className="text-xs font-medium">{c.note}</h3>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                        <bdi>
                          {approval.status === "rejected" &&
                          expired &&
                          /^(Sudo approval expired|Approval expired)$/.test(
                            approval.decisionNote,
                          )
                            ? c.expired
                            : approval.decisionNote}
                        </bdi>
                      </p>
                    </div>
                  )}
                  {approval.status === "pending" && (
                    <div className="mt-4 space-y-3 border-t pt-4">
                      {invalidScope && (
                        <p className="text-sm leading-6 text-destructive">
                          {c.missingScope}
                        </p>
                      )}
                      <label
                        htmlFor={`note-${approval.id}`}
                        className="block text-sm font-medium"
                      >
                        {c.note} · #{approval.id}
                      </label>
                      <Textarea
                        id={`note-${approval.id}`}
                        placeholder={c.notePlaceholder}
                        maxLength={2000}
                        rows={2}
                        value={notes[approval.id] ?? ""}
                        disabled={resolving}
                        onChange={(event) =>
                          setNotes((previous) => ({
                            ...previous,
                            [approval.id]: event.target.value,
                          }))
                        }
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="outline"
                          className="h-auto min-h-11 whitespace-normal"
                          disabled={blocked}
                          onClick={() => void decide(approval, "rejected")}
                        >
                          {c.reject}
                        </Button>
                        <Button
                          className="h-auto min-h-11 whitespace-normal"
                          disabled={
                            blocked ||
                            expired ||
                            invalidScope ||
                            Boolean(approval.consumedAt) ||
                            ops.controlsBlocked
                          }
                          onClick={(event) => {
                            if (host) {
                              opener.current = event.currentTarget;
                              setConfirmation(approval);
                              setDigest("");
                            } else void decide(approval, "approved");
                          }}
                        >
                          {expired ? c.expired : c.approve}
                        </Button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
          <nav
            aria-label={c.title}
            className="flex flex-wrap justify-between gap-3"
          >
            <Button
              variant="outline"
              className="h-auto min-h-11 whitespace-normal"
              disabled={!cursors.length || resolving || requests.isFetching}
              onClick={() => setCursors((previous) => previous.slice(0, -1))}
            >
              {c.newer}
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-11 whitespace-normal"
              disabled={
                requests.data?.length !== PAGE_SIZE ||
                resolving ||
                requests.isFetching ||
                requests.isError
              }
              onClick={() => {
                if (requests.data?.length)
                  setCursors((previous) => [
                    ...previous,
                    Math.min(...requests.data!.map((request) => request.id)),
                  ]);
              }}
            >
              {c.older}
            </Button>
          </nav>
        </TabsContent>
      </Tabs>
      {resolving && (
        <p role="status" className="text-sm">
          {c.saving}
        </p>
      )}
      <AlertDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open && !resolving) closeConfirmation();
        }}
      >
        <AlertDialogContent
          dir={directionForLocale(locale)}
          className="max-w-xl [overflow-wrap:anywhere]"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            confirmationInput.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (opener.current?.isConnected) opener.current.focus();
            else heading.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-start gap-2">
              <ShieldAlert
                aria-hidden
                size={20}
                className="mt-1 shrink-0 text-destructive"
              />
              {c.hostConfirm}
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-6">
              {c.hostWarning}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmation && (
            <>
              <ScopeDetails
                approval={confirmation}
                copy={c}
                locale={locale}
                now={now}
              />
              <p className="text-sm leading-6">
                {c.confirmInstruction}{" "}
                <bdi className="font-mono font-semibold">
                  {confirmation.scope?.argsHash.slice(0, 8)}
                </bdi>
              </p>
              <label className="block space-y-2">
                <span className="text-sm font-medium">{c.confirmInput}</span>
                <Input
                  ref={confirmationInput}
                  dir="ltr"
                  maxLength={8}
                  autoComplete="off"
                  spellCheck={false}
                  value={digest}
                  onChange={(event) => setDigest(event.target.value)}
                  disabled={resolving}
                  className="min-h-11 font-mono"
                />
              </label>
              {(changed ||
                ops.controlsBlocked ||
                expiry ||
                requests.isError ||
                failure) && (
                <p role="alert" className="text-sm leading-6 text-destructive">
                  {changed
                    ? c.changedError
                    : expiry
                      ? c.expiredError
                      : ops.controlsBlocked
                        ? safetyCopy
                        : requests.isError
                          ? c.stale
                          : failure
                            ? c[failure]
                            : ""}
                </p>
              )}
              {(needsRefresh || requests.isError) && (
                <Button
                  variant="outline"
                  disabled={resolving || requests.isFetching}
                  onClick={() => void refresh()}
                >
                  {c.retry}
                </Button>
              )}
            </>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-auto min-h-11 whitespace-normal"
              disabled={resolving}
              onClick={closeConfirmation}
            >
              {c.cancel}
            </AlertDialogCancel>
            <Button
              disabled={!canConfirm}
              className="h-auto min-h-11 whitespace-normal"
              onClick={() =>
                confirmation &&
                void decide(
                  confirmation,
                  "approved",
                  digest.trim().toLowerCase(),
                )
              }
            >
              {resolving ? c.saving : c.confirmSubmit}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ScopeDetails({
  approval,
  copy: c,
  locale,
  now,
}: {
  approval: ApprovalRequest;
  copy: ApprovalCopy;
  locale: Locale;
  now: number;
}) {
  const scope = approval.scope;
  if (!scope) return null;
  const expired = approvalExpired(approval, now);
  const closed = Boolean(approval.consumedAt || approval.status === "rejected");
  return (
    <section className="mt-4 min-w-0 rounded-lg border bg-background p-3 text-xs leading-5 sm:p-4">
      <h3 className="font-semibold">{c.scope}</h3>
      <dl className="mt-3 grid min-w-0 gap-x-4 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted-foreground">{c.tool}</dt>
        <dd dir="ltr" className="min-w-0 font-mono [overflow-wrap:anywhere]">
          {scope.toolName}
        </dd>
        <dt className="text-muted-foreground">{c.target}</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere]">
          <bdi>{scope.target ?? "—"}</bdi>
        </dd>
        <dt className="text-muted-foreground">{c.hash}</dt>
        <dd dir="ltr" className="min-w-0 font-mono [overflow-wrap:anywhere]">
          {scope.argsHash}
        </dd>
        <dt className="text-muted-foreground">{c.expires}</dt>
        <dd className={cn("min-w-0", expired && "text-destructive")}>
          {expired && `${c.expired} · `}
          <bdi>
            {approval.expiresAt
              ? dateLabel(approval.expiresAt, locale)
              : c.noExpiry}
          </bdi>
        </dd>
      </dl>
      <h4 className="mt-3 font-medium">{c.preview}</h4>
      {closed ? (
        <p className="mt-1 text-muted-foreground">{c.closedPreview}</p>
      ) : (
        <pre
          dir={scope.toolName === "vm_run_sudo_command" ? "ltr" : "auto"}
          className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border bg-card p-3 font-mono text-xs leading-5 [overflow-wrap:anywhere]"
        >
          {scope.preview || c.missingScope}
        </pre>
      )}
      {approval.consumedAt && (
        <p className="mt-3 text-muted-foreground">
          {c.consumed}: <bdi>{dateLabel(approval.consumedAt, locale)}</bdi>.{" "}
          {c.consumedHelp}
        </p>
      )}
    </section>
  );
}
