import { useOperationsCopy } from "./operations-copy-context";
import React from "react";
import { Activity, GitBranch, Server, Waypoints } from "lucide-react";

import type {
  OperationsAttemptInput,
  OperationsMemberInput,
} from "../../lib/operations-view-model";
import { cn } from "../../lib/utils";

const ATTEMPT_META: Record<string, { className: string }> = {
  claimed: {
    className: "border-sky-600/25 text-sky-700 dark:text-sky-300",
  },
  running: {
    className: "border-emerald-600/25 text-emerald-700 dark:text-emerald-300",
  },
  succeeded: {
    className: "border-border text-foreground",
  },
  retrying: {
    className: "border-amber-600/25 text-amber-700 dark:text-amber-300",
  },
  blocked: {
    className: "border-rose-600/25 text-rose-700 dark:text-rose-300",
  },
  lost: {
    className: "border-rose-600/25 text-rose-700 dark:text-rose-300",
  },
};

export function AttemptLedger({
  attempts,
  members,
  selectedAttemptId,
  onSelectAttempt,
  inspectorId = "operation-evidence-inspector",
  className,
}: {
  attempts: OperationsAttemptInput[];
  members: OperationsMemberInput[];
  selectedAttemptId: string | null;
  onSelectAttempt: (attemptId: string) => void;
  inspectorId?: string;
  className?: string;
}) {
  const { copy: c, t, number, time, state: stateLabel } = useOperationsCopy();

  const memberById = new Map(members.map((member) => [member.agentId, member]));
  return (
    <section
      aria-labelledby="attempt-ledger-title"
      className={cn("border border-border/75 bg-card", className)}
    >
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/75 px-5 py-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("attemptEyebrow")}
          </p>
          <h2
            id="attempt-ledger-title"
            className="mt-1 font-serif text-2xl font-medium tracking-[-0.04em]"
          >
            {c.attemptTitle}
          </h2>
        </div>
        <p className="text-[12px] text-muted-foreground">
          {t("recentAttempts", { count: number.format(attempts.length) })}
        </p>
      </header>

      {attempts.length ? (
        <ol className="divide-y divide-border/75">
          {attempts.map((attempt) => {
            const member = memberById.get(attempt.agentId);
            const state = ATTEMPT_META[attempt.state] ?? {
              className: "border-border text-muted-foreground",
            };
            return (
              <li key={attempt.id}>
                <button
                  type="button"
                  onClick={() => onSelectAttempt(attempt.id)}
                  aria-pressed={selectedAttemptId === attempt.id}
                  aria-controls={inspectorId}
                  aria-label={t("inspectAttempt", { id: attempt.id })}
                  className={cn(
                    "w-full cursor-pointer px-4 py-4 text-start transition-colors hover:bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5",
                    selectedAttemptId === attempt.id &&
                      "bg-primary/[0.075] shadow-[inset_3px_0_0_hsl(var(--primary))]",
                  )}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "border bg-background/55 px-2 py-1 text-[12px] font-bold uppercase tracking-[0.08em]",
                        state.className,
                      )}
                    >
                      {stateLabel(attempt.state)}
                    </span>
                    {attempt.recoveryOfAttemptId ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-sky-700 dark:text-sky-300">
                        <GitBranch size={10} aria-hidden />
                        {t("recoveryAttempt")}
                      </span>
                    ) : null}
                    <time
                      dateTime={attempt.startedAt}
                      className="ms-auto font-mono text-[12px] text-muted-foreground"
                    >
                      {time(attempt.startedAt)}
                    </time>
                  </div>

                  <div className="mt-3 grid min-w-0 gap-3">
                    <div className="min-w-0">
                      <p className="break-words [overflow-wrap:anywhere] text-xs font-semibold">
                        {member?.name ?? t("expert", { id: attempt.agentId })}
                        <span className="ms-2 font-normal text-muted-foreground">
                          {t("cycleAttempt", {
                            cycle: number.format(attempt.cycleNumber),
                            attempt: number.format(attempt.attemptNumber),
                          })}
                        </span>
                      </p>
                      <p className="mt-1 break-all font-mono text-[12px] leading-4 text-muted-foreground">
                        {attempt.id}
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 break-all font-mono text-[12px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Server size={10} aria-hidden />{" "}
                        {attempt.workerInstanceId}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Activity size={10} aria-hidden />
                        {t("tokens", {
                          count: number.format(attempt.totalTokens),
                        })}
                      </span>
                      {attempt.provider || attempt.modelId ? (
                        <span className="inline-flex items-center gap-1">
                          <Waypoints size={10} aria-hidden />
                          {[attempt.provider, attempt.modelId]
                            .filter(Boolean)
                            .join(" / ")}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {attempt.failureKind ? (
                    <p className="mt-2 text-[12px] font-semibold text-rose-700 dark:text-rose-300">
                      {attempt.failureKind}
                    </p>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="px-5 py-12 text-center text-sm text-muted-foreground">
          {t("attemptEmpty")}
        </div>
      )}
    </section>
  );
}
