import { useOperationsCopy } from "./operations-copy-context";
import React from "react";
import {
  AlarmClock,
  CircleDot,
  Coins,
  ListTodo,
  ShieldAlert,
  TimerReset,
} from "lucide-react";

import type { OperationsRoomModel } from "../../lib/operations-view-model";

export function OperationsSummaryStrip({
  model,
  now,
}: {
  model: OperationsRoomModel;
  now: Date;
}) {
  const { t, number, duration, until, currency } = useOperationsCopy();

  const intervention =
    model.taskCounts.blocked + model.taskCounts.awaitingApproval;
  // A retained older snapshot has no provenance; it must not imply measured
  // totals. Provider health coverage is independent of usage reporting.
  const tokenCoverage = model.usage.tokenUsageCoverage ?? "unknown";
  const tokenValue =
    tokenCoverage === "complete" || tokenCoverage === "no_usage"
      ? number.format(model.usage.taskTokens)
      : model.usage.taskTokens > 0
        ? t("tokensAtLeast", { count: number.format(model.usage.taskTokens) })
        : t("tokenUsageUnknown");
  const costComplete =
    model.usage.usageEvents > 0 &&
    model.usage.costReportedEvents === model.usage.usageEvents;
  const entries = [
    {
      label: t("activeWork"),
      value: number.format(model.taskCounts.active),
      detail: t("recoveringCount", {
        count: number.format(model.taskCounts.recovering),
      }),
      icon: CircleDot,
    },
    {
      label: t("queue"),
      value: number.format(model.queue.dueDepth),
      detail: t("sleepingCount", {
        count: number.format(model.taskCounts.sleeping),
      }),
      icon: ListTodo,
    },
    {
      label: t("oldest"),
      value: duration(model.queue.oldestDueAgeMs),
      detail: model.queue.dueDepth ? t("delayAge") : t("queueClear"),
      icon: TimerReset,
    },
    {
      label: t("nextWake"),
      value: until(model.queue.nextWakeAt, now),
      detail: t("scheduler"),
      icon: AlarmClock,
    },
    {
      label: t("intervention"),
      value: number.format(intervention),
      detail: t("approvalCount", {
        count: number.format(model.taskCounts.awaitingApproval),
      }),
      icon: ShieldAlert,
    },
    {
      label: t("tokenUsage"),
      value: tokenValue,
      detail:
        tokenCoverage === "no_usage"
          ? t("noRecordedUsage")
          : tokenCoverage !== "complete"
            ? t("tokenCoveragePartial")
            : costComplete
              ? t("reportedCost", {
                  cost: currency(model.usage.reportedCostUsd),
                })
              : t("partialCost"),
      icon: Coins,
    },
  ];

  return (
    <dl className="grid grid-cols-2 overflow-hidden border border-border/75 bg-card xl:grid-cols-6">
      {entries.map((entry, index) => {
        const Icon = entry.icon;
        return (
          <div
            key={entry.label}
            className={`min-w-0 border-border/75 p-4 ${index >= 2 ? "border-t xl:border-t-0" : ""} ${index % 2 ? "border-s" : ""} ${index ? "xl:border-s" : ""}`}
          >
            <dt className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
              <Icon
                className="shrink-0"
                size={12}
                strokeWidth={1.8}
                aria-hidden
              />
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                {entry.label}
              </span>
            </dt>
            <dd className="mt-2 break-words [overflow-wrap:anywhere] font-mono text-lg font-semibold tracking-[-0.04em]">
              {entry.value}
            </dd>
            <p className="mt-0.5 break-words [overflow-wrap:anywhere] text-[12px] text-muted-foreground">
              {entry.detail}
            </p>
          </div>
        );
      })}
    </dl>
  );
}
