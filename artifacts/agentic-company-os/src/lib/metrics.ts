import { useMemo } from "react";
import { useGetOrgSummary } from "@workspace/api-client-react";
import { getGetOrgSummaryQueryKey } from "@workspace/api-client-react";

/** Rolling in-memory ring buffer of org summary snapshots (dashboard charts). */
export interface MetricPoint {
  t: number;
  tokens: number;
  cost: number;
  working: number;
  tasksInProgress: number;
  completedToday: number;
}

const WINDOW = 240; // ~20 min at 5s poll
const buffer: MetricPoint[] = [];

export function recordSummaryPoint(summary: {
  tokensUsedToday?: number;
  estimatedCostTodayUsd?: number;
  workingAgents?: number;
  tasksInProgress?: number;
  tasksCompletedToday?: number;
}) {
  const point: MetricPoint = {
    t: Date.now(),
    tokens: summary.tokensUsedToday ?? 0,
    cost: summary.estimatedCostTodayUsd ?? 0,
    working: summary.workingAgents ?? 0,
    tasksInProgress: summary.tasksInProgress ?? 0,
    completedToday: summary.tasksCompletedToday ?? 0,
  };
  const last = buffer[buffer.length - 1];
  // dedupe identical consecutive readings
  if (
    last &&
    last.tokens === point.tokens &&
    last.cost === point.cost &&
    last.working === point.working &&
    last.tasksInProgress === point.tasksInProgress
  ) {
    last.t = point.t;
    return;
  }
  buffer.push(point);
  if (buffer.length > WINDOW) buffer.shift();
}

export function getSeries(): MetricPoint[] {
  return buffer;
}

export function useMetricsSeries() {
  const { data: summary } = useGetOrgSummary({
    query: { refetchInterval: 5000, queryKey: getGetOrgSummaryQueryKey() },
  });

  if (summary) recordSummaryPoint(summary);

  return useMemo(() => {
    const pts = buffer;
    if (pts.length < 2) return null;
    const tokens = pts.map((p) => ({ x: p.t, y: p.tokens }));
    const cost = pts.map((p) => ({ x: p.t, y: p.cost }));
    const activity = pts.map((p) => ({
      x: p.t,
      y: p.working + p.tasksInProgress,
    }));
    return { tokens, cost, activity };
  }, [summary]);
}
