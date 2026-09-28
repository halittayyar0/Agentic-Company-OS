import { useOperationsCopy } from "./operations-copy-context";
import { ActivitySummary } from "../activity-summary";
import { knownOperationsEventKind } from "../../lib/activity-summary";
import React from "react";
import {
  AlertOctagon,
  ArrowRightLeft,
  CheckCircle2,
  History,
  RotateCcw,
} from "lucide-react";

import type { MissionLogEntry } from "../../lib/operations-view-model";
import { cn } from "../../lib/utils";

function eventIcon(event: MissionLogEntry) {
  if (event.kind.includes("handoff")) return ArrowRightLeft;
  if (event.kind.includes("recover")) return RotateCcw;
  if (event.severity === "critical") return AlertOctagon;
  return event.source === "milestone" ? CheckCircle2 : History;
}

export function MissionLog({
  missions,
  className,
}: {
  missions: MissionLogEntry[];
  className?: string;
}) {
  const { copy: c, t, number, time, state: stateLabel } = useOperationsCopy();

  return (
    <section
      aria-labelledby="mission-log-title"
      className={cn("border border-border/75 bg-card", className)}
    >
      <header className="border-b border-border/75 px-5 py-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t("missionEyebrow")}
        </p>
        <h2
          id="mission-log-title"
          className="mt-1 font-serif text-2xl font-medium tracking-[-0.04em]"
        >
          {t("missionTitle")}
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("missionLimit", { count: number.format(24) })}
        </p>
      </header>

      {missions.length ? (
        <ol className="divide-y divide-border/75">
          {missions.slice(0, 24).map((event) => {
            const Icon = eventIcon(event);
            return (
              <li
                key={event.evidenceId}
                className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 px-4 py-3"
              >
                <span
                  className={cn(
                    "grid size-8 place-items-center rounded-full border",
                    event.severity === "critical"
                      ? "border-rose-600/25 bg-rose-600/[0.08] text-rose-700 dark:text-rose-300"
                      : event.severity === "warning"
                        ? "border-amber-600/25 bg-amber-600/[0.08] text-amber-700 dark:text-amber-300"
                        : "border-border bg-secondary/65 text-muted-foreground",
                  )}
                >
                  <Icon size={13} strokeWidth={1.8} aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-xs font-semibold">
                      <ActivitySummary
                        summary={stateLabel(event.kind)}
                        kind={knownOperationsEventKind(event.kind)}
                      />
                    </p>
                    <time
                      dateTime={event.occurredAt}
                      className="font-mono text-[12px] text-muted-foreground"
                    >
                      {time(event.occurredAt)}
                    </time>
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-2 break-all font-mono text-[12px] text-muted-foreground">
                    <span>
                      {c.evidence} <bdi dir="ltr">{event.evidenceId}</bdi>
                    </span>
                    {event.attemptId ? (
                      <span>
                        {c.attempt} <bdi dir="ltr">{event.attemptId}</bdi>
                      </span>
                    ) : null}
                    {event.receiptId ? (
                      <span>
                        {c.receipt} <bdi dir="ltr">{event.receiptId}</bdi>
                      </span>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="px-5 py-12 text-center">
          <CheckCircle2
            size={19}
            className="mx-auto text-muted-foreground"
            aria-hidden
          />
          <p className="mt-3 text-sm font-semibold">{t("noEvents")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("noEventsHelp")}
          </p>
        </div>
      )}
    </section>
  );
}
