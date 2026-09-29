import type { Task } from "@workspace/api-client-react";
import type { RunTrace } from "./run-trace";

export interface EvidenceWindowBoundary {
  taskId: number;
  capturedAt: string | null;
  beforeId: number | null;
  nextBeforeId: number | null;
  pageNumber: number;
  refreshFailed: boolean;
}

/** A deliberately narrow, shareable view of one loaded activity page. */
export function evidenceWindowBody(input: {
  task: Task;
  trace: RunTrace;
  boundary: EvidenceWindowBoundary;
  exportedAt: string;
}) {
  const { task, trace, boundary, exportedAt } = input;
  return {
    schema: "agentic-company-os/evidence-window@1" as const,
    exportedAt,
    boundary: {
      source: "task-activity-api" as const,
      taskId: boundary.taskId,
      fullHistory: false as const,
      receipts: false as const,
      capturedAt: boundary.capturedAt,
      beforeId: boundary.beforeId,
      nextBeforeId: boundary.nextBeforeId,
      pageNumber: boundary.pageNumber,
      refreshFailed: boundary.refreshFailed,
      firstEventAt: trace.events[0]?.createdAt ?? null,
      lastEventAt: trace.events.at(-1)?.createdAt ?? null,
    },
    task: {
      id: task.id,
      status: task.status,
      updatedAt: task.updatedAt,
      stepCounter: task.stepAttempts,
      cycleCounter: task.cycleCount,
      resultSummaryStored: Boolean(task.resultSummary),
    },
    stages: trace.stages.map((stage) => ({
      id: stage.id,
      state: stage.state,
      source: stage.source,
      evidence: stage.evidence,
      timestamp: stage.timestamp,
      activityId: stage.activityId,
    })),
    stats: {
      eventCount: trace.stats.eventCount,
      toolEventCount: trace.stats.toolEventCount,
      judgeCount: trace.stats.judgeCount,
      warningCount: trace.stats.warningCount,
      errorCount: trace.stats.errorCount,
    },
    events: trace.events.map((event) => ({
      id: event.id,
      agentId: event.agentId,
      taskId: event.taskId,
      type: event.type,
      severity: event.severity,
      createdAt: event.createdAt,
      categories: event.categories,
    })),
  };
}

export async function createEvidencePacket(
  body: ReturnType<typeof evidenceWindowBody>,
) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const digest = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { ...body, integrity: { algorithm: "SHA-256" as const, digest } };
}
