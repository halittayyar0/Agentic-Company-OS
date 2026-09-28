import { useOperationsCopy } from "./operations-copy-context";
import React from "react";
import { CircleAlert, Database } from "lucide-react";

import type {
  OperationsWindowInput,
  ProjectOperationsLimitsInput,
  ProjectOperationsTruncationInput,
} from "../../lib/operations-view-model";
import { cn } from "../../lib/utils";
import {
  OPERATIONS_DISPLAY_TIMEZONE,
  type OperationsCopyKey,
} from "../../lib/operations-copy";
export { OPERATIONS_DISPLAY_TIMEZONE };

const TRUNCATION_LABELS: ReadonlyArray<{
  key: keyof ProjectOperationsTruncationInput;
  label: OperationsCopyKey;
  limit: keyof ProjectOperationsLimitsInput;
}> = [
  { key: "attempts", label: "attempts", limit: "attempts" },
  { key: "receipts", label: "receipts", limit: "receipts" },
  { key: "incidents", label: "incidents", limit: "incidents" },
  { key: "milestones", label: "milestones", limit: "milestones" },
  {
    key: "fleetHealthSamples",
    label: "samples",
    limit: "samples",
  },
];

export function OperationsDataBoundary({
  window,
  limits,
  truncation,
  className,
}: {
  window: OperationsWindowInput;
  limits: ProjectOperationsLimitsInput;
  truncation: ProjectOperationsTruncationInput;
  className?: string;
}) {
  const { t, number } = useOperationsCopy();

  const truncated = TRUNCATION_LABELS.filter(({ key }) => truncation[key]);

  return (
    <section
      aria-label={t("dataBoundary")}
      className={cn(
        "mt-4 border px-4 py-3 sm:px-5",
        truncated.length
          ? "border-attention/35 bg-attention/[0.07]"
          : "border-border/75 bg-card/55",
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-2">
          {truncated.length ? (
            <CircleAlert
              size={15}
              className="mt-0.5 shrink-0 text-attention"
              aria-hidden
            />
          ) : (
            <Database
              size={15}
              className="mt-0.5 shrink-0 text-primary"
              aria-hidden
            />
          )}
          <div>
            <strong className="text-[12px] font-semibold">
              {truncated.length ? t("limited") : t("bounded")}
            </strong>
            <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
              {t("windowHelp", {
                hours: number.format(window.hours),
                zone: window.timezone,
                display: OPERATIONS_DISPLAY_TIMEZONE,
              })}
            </p>
          </div>
        </div>
        <p className="ms-auto text-[12px] leading-5 text-muted-foreground">
          {t("invocationLimit", {
            count: number.format(limits.invocationsPerReceipt),
          })}
        </p>
      </div>

      {truncated.length ? (
        <ul className="mt-3 flex flex-wrap gap-2" role="list">
          {truncated.map(({ key, label, limit }) => (
            <li
              key={key}
              className="border border-attention/25 bg-background/45 px-2.5 py-1 text-[12px] font-semibold text-attention-foreground"
            >
              {t("limitReached", {
                label: t(label),
                count: number.format(limits[limit]),
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
