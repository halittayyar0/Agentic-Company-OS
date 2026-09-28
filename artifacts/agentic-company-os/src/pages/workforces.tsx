import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getListAgentsQueryKey,
  getListTasksQueryKey,
  getGetOrgSummaryQueryKey,
  getListWorkforceBlueprintsQueryKey,
  useInstallWorkforceBlueprint,
  useListAgents,
  useListWorkforceBlueprints,
  type WorkforceInstallation,
  type TaskAutonomyMode,
} from "@workspace/api-client-react";
import { ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { loadWorkforceCopy, type WorkforceCopy } from "@/lib/workforce-copy";
import {
  readWorkforceIntent,
  saveWorkforceIntent,
  clearWorkforceIntent,
  workforceRejection,
  type WorkforceIntent,
} from "@/lib/workforce-installation";
import { directionForLocale, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export default function WorkforcesPage() {
  const { locale, t } = useLocale();
  const copy = useQuery({
    queryKey: ["workforce-copy", locale],
    queryFn: () => loadWorkforceCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return (
      <section
        role={copy.isError ? "alert" : "status"}
        className="rounded-xl border bg-card p-6"
      >
        <p>{copy.isError ? t("workforceCopyError") : t("loadingScreen")}</p>
        {copy.isError && (
          <Button className="mt-4" onClick={() => window.location.reload()}>
            {t("checkAgain")}
          </Button>
        )}
      </section>
    );
  return <WorkforceStudio copy={copy.data} locale={locale} />;
}

function WorkforceStudio({
  copy: c,
  locale,
}: {
  copy: WorkforceCopy;
  locale: Locale;
}) {
  const queryClient = useQueryClient();
  const ops = useOpsControl();
  const [intent, setIntent] = useState<WorkforceIntent | null>(
    readWorkforceIntent,
  );
  // A pending request keeps the catalog language it was reviewed in.
  const catalogLocale = intent?.data.locale ?? locale;
  const catalog = useListWorkforceBlueprints(
    { locale: catalogLocale },
    {
      query: {
        queryKey: getListWorkforceBlueprintsQueryKey({ locale: catalogLocale }),
        refetchOnWindowFocus: "always",
        retry: false,
      },
    },
  );
  const agents = useListAgents(
    { includeInactive: false },
    {
      query: {
        queryKey: getListAgentsQueryKey({ includeInactive: false }),
        refetchOnWindowFocus: "always",
        retry: false,
      },
    },
  );
  const mutation = useInstallWorkforceBlueprint();
  const busy = useRef(false);
  const receiptRef = useRef<HTMLElement>(null);
  const [selectedKey, setSelectedKey] = useState(intent?.blueprintKey ?? "");
  const [managerId, setManagerId] = useState<number | null>(
    intent?.data.managerAgentId ?? null,
  );
  const [outcome, setOutcome] = useState(intent?.data.outcome ?? "");
  const [mode, setMode] = useState<TaskAutonomyMode>(
    intent?.data.autonomyMode ?? "finite",
  );
  const [cadence, setCadence] = useState(
    String(intent?.data.cadenceSeconds ?? 3600),
  );
  const [receipt, setReceipt] = useState<WorkforceInstallation | null>(null);
  const [failure, setFailure] = useState<keyof WorkforceCopy | null>(null);
  const managers = (agents.data ?? []).filter(
    (agent) => agent.isActive && agent.permissions.canCreateSubAgents,
  );
  const selected =
    catalog.data?.find((blueprint) => blueprint.key === selectedKey) ??
    catalog.data?.[0];
  const frozen = Boolean(intent || receipt || mutation.isPending);
  const invalidOutcome = outcome.trim().length > 0 && outcome.trim().length < 3;
  const stale = catalog.isError || agents.isError;
  const managerValid = managers.some((manager) => manager.id === managerId);
  const canInstall = Boolean(
    selected &&
    managerValid &&
    !invalidOutcome &&
    !stale &&
    !ops.controlsBlocked &&
    !frozen,
  );
  useEffect(() => {
    if (frozen || managerValid) return;
    setManagerId(
      (managers.find((agent) => agent.templateKey === "ceo") ?? managers[0])
        ?.id ?? null,
    );
  }, [agents.data, managerValid, frozen]);
  useEffect(() => {
    if (receipt) {
      // Only release recovery once the result has actually mounted. A late
      // response after navigation must remain recoverable on the next visit.
      clearWorkforceIntent();
      receiptRef.current?.focus();
    }
  }, [receipt]);
  const refresh = () => {
    void catalog.refetch();
    void agents.refetch();
    ops.refetch();
  };

  async function install() {
    if (busy.current || receipt || (!intent && !canInstall)) return;
    let request = intent;
    if (!request && selected && managerId !== null) {
      request = {
        blueprintKey: selected.key,
        data: {
          requestId: crypto.randomUUID(),
          locale,
          blueprintVersion: selected.version,
          managerAgentId: managerId,
          ...(outcome.trim()
            ? {
                outcome: outcome.trim(),
                autonomyMode: mode,
                ...(mode === "continuous"
                  ? { cadenceSeconds: Number(cadence) }
                  : {}),
              }
            : {}),
        },
      };
      if (!saveWorkforceIntent(request)) {
        setFailure("storageError");
        return;
      }
      setIntent(request);
    }
    if (!request) return;
    busy.current = true;
    setFailure(null);
    try {
      const created = await mutation.mutateAsync(request);
      setIntent(null);
      setReceipt(created);
      void queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      void queryClient.invalidateQueries({
        queryKey: getGetOrgSummaryQueryKey(),
      });
    } catch (error) {
      const rejection = workforceRejection(error);
      if (rejection) {
        clearWorkforceIntent();
        setIntent(null);
        setFailure(rejection);
        refresh();
      }
      // An uncertain outcome retains its exact request ID and payload for recovery.
    } finally {
      busy.current = false;
    }
  }

  const selectClass =
    "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
  const initialError =
    (!catalog.data && catalog.isError) || (!agents.data && agents.isError);
  const loading = catalog.isLoading || agents.isLoading;
  return (
    <div className="min-w-0 space-y-5 pb-8 [overflow-wrap:anywhere]">
      <header className="border-b pb-5">
        <p className="text-sm font-medium text-primary">{c.eyebrow}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
          {c.title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          {c.description}
        </p>
      </header>
      {intent && !mutation.isPending && (
        <section
          role="alert"
          className="rounded-xl border border-primary/40 bg-card p-4"
        >
          <p className="text-sm leading-6">{c.unknown}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            <bdi>
              {intent.blueprintKey}@{intent.data.blueprintVersion}
            </bdi>
          </p>
          {intent.data.outcome && (
            <p className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-sm">
              <bdi>{intent.data.outcome}</bdi>
            </p>
          )}
          <Button
            className="mt-3 h-auto min-h-11 whitespace-normal"
            onClick={() => void install()}
          >
            {c.recover}
          </Button>
        </section>
      )}
      {failure && (
        <section
          role="alert"
          className="rounded-xl border border-destructive/40 p-4 text-sm leading-6"
        >
          {c[failure]}
        </section>
      )}
      {receipt && (
        <section
          ref={receiptRef}
          tabIndex={-1}
          aria-labelledby="workforce-receipt"
          className="rounded-xl border border-primary/40 bg-card p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h2
            id="workforce-receipt"
            className="flex items-center gap-2 font-semibold"
          >
            <CheckCircle2 size={18} aria-hidden />
            {c.receipt}
          </h2>
          <p className="mt-2 text-sm">{c.installed}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <bdi>
              {receipt.blueprintKey}@{receipt.version}
            </bdi>
          </p>
          <div className="my-4 grid gap-2 sm:grid-cols-2">
            {receipt.agents.map((agent) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="flex min-h-11 items-center gap-3 rounded-lg border p-3 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <AgentAvatar agent={agent} size="xs" />
                <span className="min-w-0 flex-1">
                  <bdi>{agent.name}</bdi>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    <bdi>{agent.role}</bdi>
                  </span>
                </span>
                <ArrowRight
                  aria-hidden
                  size={16}
                  className="shrink-0 rtl:rotate-180"
                />
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {receipt.task && (
              <Button asChild className="h-auto min-h-11 whitespace-normal">
                <Link href={`/projects/${receipt.task.id}`}>
                  {c.openTask} · #{receipt.task.id}
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              className="h-auto min-h-11 whitespace-normal"
              onClick={() => {
                setReceipt(null);
                setOutcome("");
                setFailure(null);
              }}
            >
              {c.another}
            </Button>
          </div>
        </section>
      )}
      {loading ? (
        <div role="status" className="rounded-xl border bg-card p-6">
          {c.loading}
        </div>
      ) : initialError ? (
        <div role="alert" className="rounded-xl border p-6">
          <p>{c.loadError}</p>
          <Button onClick={refresh} className="mt-4">
            {c.retry}
          </Button>
        </div>
      ) : !selected ? (
        <div role="status" className="rounded-xl border p-6">
          {c.empty}
        </div>
      ) : (
        <>
          {stale && (
            <div role="alert" className="rounded-lg border p-4 text-sm">
              <p>{c.stale}</p>
              <Button variant="outline" onClick={refresh} className="mt-3">
                {c.retry}
              </Button>
            </div>
          )}
          <nav aria-label={c.library} className="grid gap-3 md:grid-cols-3">
            {catalog.data!.map((blueprint) => (
              <button
                type="button"
                key={blueprint.key}
                disabled={frozen}
                aria-pressed={selected.key === blueprint.key}
                onClick={() => setSelectedKey(blueprint.key)}
                className={cn(
                  "min-w-0 rounded-xl border bg-card p-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                  selected.key === blueprint.key
                    ? "border-primary bg-primary/5"
                    : "hover:bg-secondary",
                )}
              >
                <span className="block text-sm font-semibold">
                  <bdi>{blueprint.name}</bdi>
                </span>
                <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                  {blueprint.tagline}
                </span>
                <span className="mt-3 block text-xs text-muted-foreground">
                  {c.roles}: {blueprint.members.length} ·{" "}
                  {c[blueprint.orchestration]}
                </span>
              </button>
            ))}
          </nav>
          <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section
              aria-labelledby="selected-workforce-name"
              className="min-w-0 rounded-xl border bg-card p-4 sm:p-6"
            >
              <p className="text-xs text-muted-foreground">
                <bdi>
                  {selected.key}@{selected.version}
                </bdi>
              </p>
              <h2
                id="selected-workforce-name"
                className="mt-2 text-2xl font-semibold tracking-tight"
              >
                <bdi>{selected.name}</bdi>
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {selected.description}
              </p>
              <a
                href="#workforce-setup"
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden"
              >
                {c.configure}
                <ArrowRight size={16} aria-hidden className="rtl:rotate-180" />
              </a>
              <div className="my-6 grid gap-4 border-y py-5 sm:grid-cols-2">
                {(
                  [
                    [c.recommended, selected.recommendedFor],
                    [c.triggers, selected.triggerLabels],
                  ] as const
                ).map(([label, values]) => (
                  <div key={label}>
                    <h3 className="text-sm font-medium">{label}</h3>
                    <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                      {values.map((value) => (
                        <li key={value}>{value}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <h3 className="font-semibold">{c.structure}</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {selected.members.map((member) => (
                  <article
                    key={member.key}
                    className="min-w-0 rounded-lg border bg-background p-4"
                  >
                    <p className="text-xs font-medium text-primary">
                      {member.level === "lead" ? c.manager : c.expert}
                    </p>
                    <h4 className="mt-2 text-sm font-semibold">
                      <bdi>{member.name}</bdi>
                    </h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <bdi>{member.role}</bdi>
                    </p>
                    <p className="mt-3 text-sm leading-6">{member.mission}</p>
                    <p className="mt-3 border-t pt-3 text-xs leading-5 text-muted-foreground">
                      {c.reportsTo}:{" "}
                      <bdi>
                        {selected.members.find(
                          (candidate) => candidate.key === member.reportsToKey,
                        )?.name ?? c.selectedManager}
                      </bdi>
                    </p>
                    <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                      {member.capabilities.map((capability) => (
                        <li key={capability}>{capability}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
              <h3 className="mt-6 font-semibold">{c.handoffs}</h3>
              <ol className="mt-3 space-y-3">
                {selected.handoffs.map((handoff) => (
                  <li
                    key={`${handoff.fromKey}/${handoff.toKey}/${handoff.mode}`}
                    className="rounded-lg border p-4"
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-sm font-medium">
                      <bdi>
                        {selected.members.find(
                          (member) => member.key === handoff.fromKey,
                        )?.name ?? handoff.fromKey}
                      </bdi>
                      <ArrowRight
                        aria-hidden
                        size={16}
                        className="text-primary rtl:rotate-180"
                      />
                      <bdi>
                        {selected.members.find(
                          (member) => member.key === handoff.toKey,
                        )?.name ?? handoff.toKey}
                      </bdi>
                    </div>
                    <p className="mt-3 text-xs font-medium text-primary">
                      {c[handoff.mode]}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {handoff.instruction}
                    </p>
                  </li>
                ))}
              </ol>
              {!selected.handoffs.length && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {c.noHandoffs}
                </p>
              )}
            </section>
            <section
              id="workforce-setup"
              aria-labelledby="workforce-setup-title"
              className="min-w-0 scroll-mt-20 rounded-xl border bg-card p-4 sm:p-5 xl:sticky xl:top-4"
            >
              <h2 id="workforce-setup-title" className="text-lg font-semibold">
                {c.setup}
              </h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void install();
                }}
                className="mt-4 space-y-5"
              >
                <fieldset disabled={frozen} className="min-w-0 space-y-5">
                  <div className="space-y-2">
                    <label
                      htmlFor="workforce-manager"
                      className="block text-sm font-medium"
                    >
                      {c.manager}
                    </label>
                    <select
                      id="workforce-manager"
                      dir={directionForLocale(locale)}
                      className={selectClass}
                      value={managerId ?? ""}
                      onChange={(event) =>
                        setManagerId(Number(event.target.value))
                      }
                      aria-describedby="workforce-manager-help"
                    >
                      {!managerValid && (
                        <option value={managerId ?? ""}>
                          {intent ? `#${managerId}` : c.noManagers}
                        </option>
                      )}
                      {managers.map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.name} · {manager.role}
                        </option>
                      ))}
                    </select>
                    <p
                      id="workforce-manager-help"
                      className="text-xs leading-5 text-muted-foreground"
                    >
                      {c.managerHelp}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="workforce-outcome"
                      className="block text-sm font-medium"
                    >
                      {c.outcome}
                    </label>
                    <Textarea
                      id="workforce-outcome"
                      value={outcome}
                      maxLength={8000}
                      onChange={(event) => setOutcome(event.target.value)}
                      rows={5}
                      placeholder={c.outcomePlaceholder}
                      aria-invalid={invalidOutcome}
                      aria-describedby="workforce-outcome-help"
                    />
                    <p
                      id="workforce-outcome-help"
                      className={cn(
                        "text-xs leading-5",
                        invalidOutcome
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {invalidOutcome ? c.outcomeInvalid : c.outcomeHelp}
                    </p>
                  </div>
                  {outcome.trim() && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        {(["finite", "continuous"] as const).map((value) => (
                          <Button
                            key={value}
                            type="button"
                            variant={mode === value ? "default" : "outline"}
                            className="h-auto min-h-11 whitespace-normal"
                            aria-pressed={mode === value}
                            onClick={() => setMode(value)}
                          >
                            {c[value]}
                          </Button>
                        ))}
                      </div>
                      {mode === "continuous" && (
                        <div className="space-y-2">
                          <label
                            htmlFor="workforce-cadence"
                            className="block text-sm font-medium"
                          >
                            {c.cadence}
                          </label>
                          <select
                            id="workforce-cadence"
                            className={selectClass}
                            value={cadence}
                            onChange={(event) => setCadence(event.target.value)}
                            dir={directionForLocale(locale)}
                          >
                            {(
                              [
                                ["3600", "hour"],
                                ["14400", "fourHours"],
                                ["86400", "day"],
                                ["604800", "week"],
                              ] as const
                            ).map(([value, key]) => (
                              <option key={value} value={value}>
                                {c[key]}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </fieldset>
                <ul className="space-y-2 border-t pt-4 text-xs leading-5 text-muted-foreground">
                  {[c.scope, c.approval, c.atomic].map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
                {ops.controlsBlocked && (
                  <div role="status" className="text-sm leading-6">
                    <p>
                      {ops.isLoading || ops.isError
                        ? c.safetyUnknown
                        : c.stopped}
                    </p>
                    {ops.isError && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={ops.refetch}
                        className="mt-2"
                      >
                        {c.retry}
                      </Button>
                    )}
                  </div>
                )}
                <Button
                  type="submit"
                  disabled={!canInstall}
                  className="h-auto min-h-11 w-full whitespace-normal"
                  aria-busy={mutation.isPending}
                >
                  {mutation.isPending ? (
                    <>
                      <LoaderCircle
                        aria-hidden
                        size={16}
                        className="me-2 motion-safe:animate-spin"
                      />
                      {c.installing}
                    </>
                  ) : outcome.trim() ? (
                    c.installStart
                  ) : (
                    c.install
                  )}
                </Button>
              </form>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
