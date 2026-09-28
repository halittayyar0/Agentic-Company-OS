import { useOperationsCopy } from "./operations-copy-context";
import React from "react";
import type {
  HealthBucketState,
  TwentyFourHourRing as RingModel,
} from "../../lib/operations-view-model";
import { cn } from "../../lib/utils";

const STATE_META: Record<
  HealthBucketState,
  { stroke: string; marker: string }
> = {
  healthy: {
    stroke: "stroke-emerald-600 dark:stroke-emerald-400",
    marker: "bg-emerald-600 dark:bg-emerald-400",
  },
  degraded: {
    stroke: "stroke-amber-500",
    marker: "bg-amber-500",
  },
  incident: {
    stroke: "stroke-rose-600 dark:stroke-rose-400",
    marker: "bg-rose-600 dark:bg-rose-400",
  },
  unknown: {
    stroke: "stroke-border",
    marker: "bg-border",
  },
};

export function TwentyFourHourRing({
  ring,
  onSelectWindow,
  className,
}: {
  ring: RingModel;
  onSelectWindow?: (window: { from: string; to: string }) => void;
  className?: string;
}) {
  const {
    copy: c,
    t,
    number,
    state: stateLabel,
    percent,
  } = useOperationsCopy();

  const healthDescription = t(
    "healthAria",
    Object.fromEntries(
      Object.entries(ring.counts).map(([key, value]) => [
        key,
        number.format(value),
      ]),
    ),
  );
  const knownMinutes = ring.totalBuckets - ring.counts.unknown;
  const meaningfulSegments = ring.segments
    .filter((segment) => segment.state !== "healthy")
    .slice(-12);

  return (
    <section
      aria-labelledby="operations-health-title"
      className={cn(
        "grid min-w-0 grid-cols-1 gap-5 border border-border/75 bg-card p-5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center",
        className,
      )}
    >
      <div className="relative mx-auto aspect-square w-[160px] max-w-full shrink-0">
        <svg
          viewBox="0 0 120 120"
          role="img"
          aria-label={healthDescription}
          className="size-full -rotate-90"
        >
          <circle
            cx="60"
            cy="60"
            r="50"
            pathLength={ring.totalBuckets}
            fill="none"
            strokeWidth="9"
            className="stroke-muted"
          />
          {ring.segments.map((segment) => (
            <circle
              key={`${segment.startIndex}-${segment.state}`}
              cx="60"
              cy="60"
              r="50"
              pathLength={ring.totalBuckets}
              fill="none"
              strokeWidth="9"
              strokeLinecap="butt"
              strokeDasharray={`${segment.durationMinutes} ${
                ring.totalBuckets - segment.durationMinutes
              }`}
              strokeDashoffset={-segment.startIndex}
              className={STATE_META[segment.state].stroke}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <span className="font-mono text-2xl font-semibold tracking-[-0.06em]">
            {knownMinutes ? percent(ring.healthyPercent) : "—"}
          </span>
          <span className="mt-0.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {t("healthLabel")}
          </span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t("healthEyebrow")}
            </p>
            <h2
              id="operations-health-title"
              className="mt-1 font-serif text-2xl font-medium tracking-[-0.04em]"
            >
              {t("last24")}
            </h2>
          </div>
          {ring.complete ? (
            <span className="border border-emerald-600/25 bg-emerald-600/[0.08] px-2.5 py-1 text-[12px] font-bold text-emerald-800 dark:text-emerald-200">
              {t("coverageComplete")}
            </span>
          ) : (
            <span className="border border-border bg-secondary/65 px-2.5 py-1 text-[12px] font-semibold text-muted-foreground">
              {t("coveredMinutes", {
                count: number.format(knownMinutes),
                total: number.format(ring.totalBuckets),
              })}
            </span>
          )}
        </div>

        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {healthDescription}
        </p>

        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {c.coverageHelp} {c.healthScope}
        </p>
        {meaningfulSegments.length ? (
          <div
            className="mt-4 flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto pb-2"
            role="group"
            aria-label={t("intervals")}
            tabIndex={0}
          >
            {meaningfulSegments.map((segment) => {
              const content = t("minutesState", {
                state: stateLabel(segment.state),
                count: number.format(segment.durationMinutes),
              });
              return onSelectWindow ? (
                <button
                  key={`${segment.startIndex}-${segment.state}`}
                  type="button"
                  onClick={() =>
                    onSelectWindow({
                      from: segment.startAt,
                      to: segment.endAt,
                    })
                  }
                  className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 border border-border bg-background/55 px-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("inspect", { content })}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      STATE_META[segment.state].marker,
                    )}
                    aria-hidden
                  />
                  {content}
                </button>
              ) : (
                <span
                  key={`${segment.startIndex}-${segment.state}`}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 border border-border bg-background/55 px-2 text-[12px] font-semibold text-muted-foreground"
                  aria-label={
                    onSelectWindow ? t("inspect", { content }) : content
                  }
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      STATE_META[segment.state].marker,
                    )}
                    aria-hidden
                  />
                  {content}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
