import { useOperationsCopy } from "./operations-copy-context";
import React from "react";
import { ArrowUpRight, MoonStar } from "lucide-react";

import type {
  AgentLane,
  AgentLaneState,
} from "../../lib/operations-view-model";
import { cn } from "../../lib/utils";

const LANE_MARKER: Record<AgentLaneState, string> = {
  working: "bg-emerald-600 dark:bg-emerald-400",
  awaiting_approval: "bg-amber-500",
  recovering: "bg-sky-600 dark:bg-sky-400",
  blocked: "bg-rose-600 dark:bg-rose-400",
  idle: "bg-muted-foreground/55",
  offline: "bg-foreground/25",
  unknown: "border border-muted-foreground/45 bg-transparent",
};

function initials(name: string, locale: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase(locale))
    .join("");
}

export function TeamConstellation({
  lanes,
  className,
}: {
  lanes: AgentLane[];
  className?: string;
}) {
  const {
    t,
    number,
    duration,
    state: stateLabel,
    locale,
  } = useOperationsCopy();

  const memberCount = lanes.reduce(
    (total, lane) => total + lane.members.length,
    0,
  );
  const visibleLanes = lanes.filter((lane) => lane.members.length > 0);

  return (
    <section
      aria-labelledby="team-constellation-title"
      className={cn("border border-border/75 bg-card", className)}
    >
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/75 px-5 py-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("teamEyebrow")}
          </p>
          <h2
            id="team-constellation-title"
            className="mt-1 font-serif text-2xl font-medium tracking-[-0.04em]"
          >
            {t("teamTitle")}
          </h2>
        </div>
        <p className="text-[12px] font-semibold text-muted-foreground">
          {t("expertCount", { count: number.format(memberCount) })}
        </p>
      </header>

      {visibleLanes.length ? (
        <div className="divide-y divide-border/75">
          {visibleLanes.map((lane) => (
            <div
              key={lane.state}
              className="grid min-w-0 gap-3 px-4 py-4 lg:grid-cols-[180px_minmax(0,1fr)]"
            >
              <div className="flex items-center gap-2 self-start min-w-0 flex-wrap py-1 text-[12px] font-bold uppercase tracking-[0.11em] text-muted-foreground">
                <span
                  className={cn("size-2 rounded-full", LANE_MARKER[lane.state])}
                  aria-hidden
                />
                {stateLabel(lane.state)}
                <span className="font-mono font-medium">
                  {number.format(lane.members.length)}
                </span>
              </div>
              <div className="grid min-w-0 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                {lane.members.map((member) => (
                  <a
                    key={member.agentId}
                    href={`/agents/${member.agentId}`}
                    className="group grid min-w-0 grid-cols-[36px_minmax(0,1fr)_auto] gap-3 border border-border/75 bg-background/45 p-3 transition-colors hover:border-primary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={`${member.name}, ${member.role}: ${
                      member.currentAction ?? stateLabel(lane.state)
                    }`}
                  >
                    <span className="grid size-[36px] place-items-center rounded-full border border-border bg-card font-mono text-[12px] font-bold">
                      {initials(member.name, locale)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <strong className="break-words [overflow-wrap:anywhere] text-xs font-semibold">
                          {member.name}
                        </strong>
                        <span className="break-words [overflow-wrap:anywhere] text-[12px] text-muted-foreground">
                          {member.role}
                        </span>
                      </span>
                      <span className="mt-1 block break-words [overflow-wrap:anywhere] text-[12px] text-foreground/80">
                        {member.currentAction ??
                          (member.nextWakeAt
                            ? t("waitingWake")
                            : stateLabel(lane.state))}
                      </span>
                      <span className="mt-1.5 flex min-w-0 items-center gap-2 font-mono text-[12px] text-muted-foreground">
                        {member.laneState === "idle" ? (
                          <MoonStar size={10} aria-hidden />
                        ) : null}
                        <span>{duration(member.activeForMs)}</span>
                        {member.activeAttemptId ? (
                          <span
                            className="break-all"
                            dir="ltr"
                            title={member.activeAttemptId}
                          >
                            {member.activeAttemptId}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <ArrowUpRight
                      size={13}
                      className="text-muted-foreground transition-colors group-hover:text-primary"
                      aria-hidden
                    />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-5 py-12 text-center text-sm text-muted-foreground">
          {t("teamEmpty")}
        </div>
      )}
    </section>
  );
}
