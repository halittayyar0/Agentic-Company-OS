import { useOperationsCopy } from "./operations-copy-context";
import React from "react";
import {
  CircleAlert,
  CircleStop,
  CloudOff,
  FlaskConical,
  Radio,
  TriangleAlert,
} from "lucide-react";

import type { OperationsRoomTruth } from "../../lib/operations-view-model";
import { cn } from "../../lib/utils";

const TRUTH_PRESENTATION = {
  live: {
    icon: Radio,
    className:
      "border-emerald-600/25 bg-emerald-600/[0.08] text-emerald-800 dark:text-emerald-200",
  },
  degraded: {
    icon: TriangleAlert,
    className:
      "border-amber-600/25 bg-amber-600/[0.08] text-amber-800 dark:text-amber-200",
  },
  stale: {
    icon: CircleAlert,
    className:
      "border-amber-600/25 bg-amber-600/[0.08] text-amber-800 dark:text-amber-200",
  },
  offline: {
    icon: CloudOff,
    className:
      "border-rose-600/25 bg-rose-600/[0.08] text-rose-800 dark:text-rose-200",
  },
  emergency_stopped: {
    icon: CircleStop,
    className:
      "border-rose-600/25 bg-rose-600/[0.08] text-rose-800 dark:text-rose-200",
  },
  local_demo: {
    icon: FlaskConical,
    className: "border-border bg-secondary/75 text-muted-foreground",
  },
} as const;

export function RuntimeTruthBadge({
  truth,
  snapshotStale = false,
  className,
}: {
  truth: OperationsRoomTruth;
  snapshotStale?: boolean;
  className?: string;
}) {
  const { copy, truthLabel } = useOperationsCopy();

  const presentationState =
    truth.backendState !== "live" || truth.live
      ? truth.backendState
      : truth.transportState === "disconnected"
        ? "offline"
        : "stale";
  const presentation =
    TRUTH_PRESENTATION[snapshotStale ? "stale" : presentationState];
  const label = snapshotStale ? copy.snapshotOutdated : truthLabel(truth);
  const Icon = presentation.icon;
  return (
    <span
      role="status"
      aria-label={label}
      data-runtime={truth.backendState}
      data-transport={truth.transportState}
      data-snapshot-stale={snapshotStale}
      className={cn(
        "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold",
        presentation.className,
        className,
      )}
    >
      <Icon size={13} strokeWidth={1.9} aria-hidden />
      <span className="break-words [overflow-wrap:anywhere]">{label}</span>
    </span>
  );
}
