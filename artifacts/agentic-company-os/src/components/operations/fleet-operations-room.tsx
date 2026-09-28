import { useOperationsCopy } from "./operations-copy-context";
import React from "react";
import {
  Boxes,
  CircleAlert,
  Database,
  RefreshCw,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import type { OperationsRuntimeInstance } from "@workspace/api-client-react";

import type { OperationsRoomModel } from "../../lib/operations-view-model";
import { cn } from "../../lib/utils";
import { OperationsSummaryStrip } from "./operations-summary-strip";
import { RuntimeTruthBadge } from "./runtime-truth-badge";
import { TwentyFourHourRing } from "./twenty-four-hour-ring";

const INSTANCE_STATE_CLASS: Record<string, string> = {
  healthy: "bg-emerald-600 dark:bg-emerald-400",
  draining: "bg-amber-500",
  stale: "bg-rose-600 dark:bg-rose-400",
  stopped: "bg-foreground/25",
};

export function FleetOperationsRoom({
  model,
  instances,
  instancesGeneratedAt,
  instancesTruncated = false,
  instancesLoading = false,
  instancesUnavailable = false,
  now,
  refreshing = false,
  refreshFailed = false,
  onRefresh,
}: {
  model: OperationsRoomModel;
  instances: OperationsRuntimeInstance[];
  instancesGeneratedAt?: string;
  instancesTruncated?: boolean;
  instancesLoading?: boolean;
  instancesUnavailable?: boolean;
  now: Date;
  refreshing?: boolean;
  refreshFailed?: boolean;
  onRefresh?: () => void;
}) {
  const {
    copy: c,
    t,
    number,
    time,
    duration,
    state: stateLabel,
  } = useOperationsCopy();

  return (
    <div className="mx-auto max-w-[1720px] space-y-4 [overflow-wrap:anywhere]">
      <header className="relative overflow-hidden border border-border/75 bg-card">
        <div
          className="absolute inset-y-0 start-0 w-1 bg-primary"
          aria-hidden
        />
        <div className="flex min-h-12 flex-wrap items-center gap-3 border-b border-border/75 px-5 py-2 sm:px-7">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-primary">
            <ServerCog size={12} aria-hidden />
            {t("command")}
          </span>
          <span className="font-mono text-[12px] text-muted-foreground">
            {t("cursor", { id: model.cursor })}
          </span>
          <a
            href="/projects"
            className="ms-auto inline-flex min-h-11 items-center text-[12px] font-semibold text-muted-foreground hover:text-foreground"
          >
            {t("projects")}
          </a>
          {onRefresh ? (
            <button
              type="button"
              onClick={() => !refreshing && onRefresh()}
              aria-disabled={refreshing}
              aria-busy={refreshing}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-border bg-background/50 px-2.5 text-[12px] font-semibold text-muted-foreground hover:border-primary/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-wait md:min-h-11"
            >
              <RefreshCw
                size={12}
                className={cn(
                  refreshing && "animate-spin motion-reduce:animate-none",
                )}
                aria-hidden
              />
              {t("refresh")}
            </button>
          ) : null}
        </div>
        <div className="grid gap-7 px-6 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">
              {t("fleetEyebrow")}
            </p>
            <h1 className="mt-2 font-serif text-4xl font-medium tracking-[-0.055em] sm:text-6xl">
              {t("fleetTitle")}
            </h1>
            <p className="mt-3 max-w-3xl text-xs leading-5 text-muted-foreground sm:text-sm sm:leading-6">
              {t("fleetHelp")}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <RuntimeTruthBadge
              truth={model.truth}
              snapshotStale={refreshFailed}
            />
            <span className="text-[12px] text-muted-foreground">
              {t("snapshot", { time: time(model.generatedAt) })}
            </span>
          </div>
        </div>
        {refreshFailed ? (
          <p
            className="flex items-start gap-2 border-t border-amber-600/20 bg-amber-600/[0.06] px-5 py-3 text-[12px] leading-4 text-amber-800 dark:text-amber-200 sm:px-7"
            role="status"
          >
            <CircleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>{c.stale}</span>
          </p>
        ) : null}
      </header>

      <OperationsSummaryStrip model={model} now={now} />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <TwentyFourHourRing ring={model.healthRing} />
        <section
          aria-labelledby="operation-pressure-title"
          className="border border-border/75 bg-card"
        >
          <header className="border-b border-border/75 px-5 py-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("pressureEyebrow")}
            </p>
            <h2
              id="operation-pressure-title"
              className="mt-1 font-serif text-2xl font-medium tracking-[-0.04em]"
            >
              {t("pressureTitle")}
            </h2>
          </header>
          <dl className="grid divide-y divide-border/75 sm:grid-cols-3 sm:divide-y-0">
            <div className="p-4">
              <dt className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {t("reserved")}
              </dt>
              <dd className="mt-2 font-mono text-2xl font-semibold">
                {number.format(model.operationCounts.reserved)}
              </dd>
            </div>
            <div className="p-4">
              <dt className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {t("state_running")}
              </dt>
              <dd className="mt-2 font-mono text-2xl font-semibold">
                {number.format(model.operationCounts.running)}
              </dd>
            </div>
            <div
              className={cn(
                "p-4",
                model.operationCounts.unresolvedUnknown > 0 &&
                  "bg-rose-600/[0.06]",
              )}
            >
              <dt className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {t("unknownResult")}
              </dt>
              <dd className="mt-2 font-mono text-2xl font-semibold">
                {number.format(model.operationCounts.unresolvedUnknown)}
              </dd>
            </div>
          </dl>
          <p className="flex items-start gap-2 border-t border-border/75 px-5 py-3 text-[12px] leading-4 text-muted-foreground">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden />
            {t("noReplayHelp")}
          </p>
        </section>
      </div>

      <section
        aria-labelledby="runtime-fleet-title"
        className="border border-border/75 bg-card"
      >
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/75 px-5 py-4">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("fleetProcesses")}
            </p>
            <h2
              id="runtime-fleet-title"
              className="mt-1 font-serif text-2xl font-medium tracking-[-0.04em]"
            >
              {t("runtimeTitle")}
            </h2>
          </div>
          <p className="text-[12px] text-muted-foreground">
            {t("processCount", { count: number.format(instances.length) })}
          </p>
        </header>
        {instancesGeneratedAt && (
          <p className="px-5 py-3 text-xs text-muted-foreground">
            {t("snapshot", { time: time(instancesGeneratedAt) })}
          </p>
        )}
        {instancesTruncated && (
          <p className="px-5 pb-3 text-xs text-attention-foreground">
            {c.limited}
          </p>
        )}
        {instancesUnavailable ? (
          <div
            className="flex items-start gap-2 px-5 py-8 text-sm text-amber-800 dark:text-amber-200"
            role="status"
          >
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            {t("instancesError")}
          </div>
        ) : null}
        {instancesLoading ? (
          <div
            className="px-5 py-10 text-center text-sm text-muted-foreground"
            role="status"
          >
            {t("instancesLoading")}
          </div>
        ) : instances.length ? (
          <div className="grid gap-px bg-border/75 sm:grid-cols-2 xl:grid-cols-3">
            {instances.map((instance) => (
              <article key={instance.id} className="min-w-0 bg-card p-4">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      INSTANCE_STATE_CLASS[instance.effectiveState] ??
                        "bg-muted-foreground/45",
                    )}
                    aria-hidden
                  />
                  <strong
                    dir="ltr"
                    className="min-w-0 break-all font-mono text-[12px]"
                  >
                    {instance.id}
                  </strong>
                  <span className="ms-auto border border-border bg-secondary/60 px-1.5 py-0.5 text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    {stateLabel(instance.role)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                  <span>
                    {t("persisted", {
                      state: stateLabel(instance.persistedState),
                    })}
                  </span>
                  <span className="font-semibold text-foreground">
                    {t("effective", {
                      state: stateLabel(instance.effectiveState),
                    })}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/75 pt-3 font-mono text-[12px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Database size={10} aria-hidden /> v{instance.buildVersion}
                  </span>
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <CircleAlert size={10} aria-hidden />
                    {duration(instance.heartbeatAgeMs)}
                  </span>
                  <span className="col-span-2 inline-flex items-center gap-1.5">
                    <Boxes size={10} aria-hidden />
                    {Object.entries(instance.capabilities)
                      .filter(([, enabled]) => enabled)
                      .map(([capability]) => stateLabel(capability))
                      .join(", ") || t("noCapability")}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : !instancesUnavailable ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            {t("instancesEmpty")}
          </div>
        ) : null}
      </section>
    </div>
  );
}
