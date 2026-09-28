import type { ActivityEvent, Task } from "@workspace/api-client-react";
import {
  activityOperationsEventKind,
  type OperationsEventKind,
} from "./activity-summary";

export const RUN_TRACE_STAGE_IDS = [
  "intake",
  "plan",
  "route",
  "execute",
  "review",
  "deliver",
] as const;

export type RunTraceStageId = (typeof RUN_TRACE_STAGE_IDS)[number];
export type RunTraceStageState = "recorded" | "missing";
export type RunTraceCategory = "all" | "people" | "tools" | "gates" | "issues";

export interface RunTraceStage {
  id: RunTraceStageId;
  state: RunTraceStageState;
  source: "task" | "activity" | null;
  evidence:
    | "created"
    | "owned"
    | "planningRecorded"
    | "executionRecorded"
    | "reviewRecorded"
    | "summaryStored"
    | "markedCompleted"
    | "missing";
  timestamp: string | null;
  activityId: number | null;
}

export interface RunTraceDetailItem {
  key: string;
  value: string;
}

export interface RunTraceEvent extends Pick<
  ActivityEvent,
  "id" | "agentId" | "taskId" | "type" | "summary" | "severity" | "createdAt"
> {
  categories: Exclude<RunTraceCategory, "all">[];
  detail: RunTraceDetailItem[];
  operationsEventKind?: OperationsEventKind;
}

export interface RunTraceStats {
  eventCount: number;
  toolEventCount: number;
  judgeCount: number;
  warningCount: number;
  errorCount: number;
  uniqueAgentIds: number[];
}

export interface RunTrace {
  stages: RunTraceStage[];
  stats: RunTraceStats;
  events: RunTraceEvent[];
}

export interface BuildRunTraceInput {
  task: Task;
  activities: ActivityEvent[];
  subtasks?: Task[];
}

type DetailRecord = Record<string, unknown>;
type DetailFormatter = (value: unknown) => string | null;

interface DetailField {
  key: string;
  format: DetailFormatter;
}

const SAFE_TEXT_LIMIT = 180;

function safeIdentifier(value: unknown): string | null {
  return typeof value === "string" &&
    value.length <= SAFE_TEXT_LIMIT &&
    /^[a-z0-9][a-z0-9._:/-]*$/iu.test(value)
    ? value
    : null;
}

function finiteNumber(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : null;
}

function nonNegativeNumber(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? String(value)
    : null;
}

function booleanValue(value: unknown): string | null {
  return typeof value === "boolean" ? String(value) : null;
}

function agentId(value: unknown): string | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? `#${value}`
    : null;
}

function recordId(value: unknown): string | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? `#${value}`
    : null;
}

function percent(value: unknown): string | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? `${value}%`
    : null;
}

function milliseconds(value: unknown): string | null {
  const formatted = nonNegativeNumber(value);
  return formatted === null ? null : `${formatted} ms`;
}

function seconds(value: unknown): string | null {
  const formatted = nonNegativeNumber(value);
  return formatted === null ? null : `${formatted} s`;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function safeUrlWithoutQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    const location = parsed.toString();
    return location.length <= 2048 ? location : null;
  } catch {
    return null;
  }
}

const DETAIL_FIELDS: readonly DetailField[] = [
  { key: "status", format: safeIdentifier },
  { key: "outcome", format: safeIdentifier },
  { key: "taskDisposition", format: safeIdentifier },
  { key: "progressPercent", format: percent },
  { key: "delegationLifecycle", format: safeIdentifier },
  { key: "fromAgentId", format: agentId },
  { key: "toAgentId", format: agentId },
  { key: "newAgentId", format: agentId },
  { key: "parentTaskId", format: recordId },
  {
    key: "completedSubtaskId",
    format: recordId,
  },
  { key: "selectedTool", format: safeIdentifier },
  { key: "tool", format: safeIdentifier },
  { key: "toolName", format: safeIdentifier },
  { key: "surface", format: safeIdentifier },
  { key: "previousSurface", format: safeIdentifier },
  { key: "phase", format: safeIdentifier },
  { key: "lifecyclePhase", format: safeIdentifier },
  { key: "transition", format: booleanValue },
  { key: "sequence", format: finiteNumber },
  { key: "durationMs", format: milliseconds },
  { key: "commandName", format: safeIdentifier },
  { key: "commandChars", format: nonNegativeNumber },
  { key: "exitCode", format: finiteNumber },
  { key: "outputStored", format: booleanValue },
  { key: "count", format: nonNegativeNumber },
  { key: "verdict", format: safeIdentifier },
  { key: "modelId", format: safeIdentifier },
  { key: "primaryModelId", format: safeIdentifier },
  { key: "fallbackModelId", format: safeIdentifier },
  { key: "nextModelId", format: safeIdentifier },
  { key: "provider", format: safeIdentifier },
  { key: "fallbackProvider", format: safeIdentifier },
  { key: "usedModelFallback", format: booleanValue },
  { key: "freeOnly", format: booleanValue },
  { key: "failureKind", format: safeIdentifier },
  { key: "attempt", format: nonNegativeNumber },
  {
    key: "consecutiveFailures",
    format: nonNegativeNumber,
  },
  { key: "remainsActive", format: booleanValue },
  { key: "runtimeEvent", format: safeIdentifier },
  { key: "guard", format: safeIdentifier },
  { key: "category", format: safeIdentifier },
  { key: "approvalId", format: recordId },
  { key: "actionQueued", format: booleanValue },
  { key: "autonomyMode", format: safeIdentifier },
  { key: "cadenceSeconds", format: seconds },
  { key: "nextAttemptAt", format: isoTimestamp },
  { key: "nextRunAt", format: isoTimestamp },
  { key: "expiresAt", format: isoTimestamp },
  { key: "url", format: safeUrlWithoutQuery },
] as const;

/**
 * Projects structured activity detail onto an explicit non-secret allowlist.
 * Free-form content, prompts, answers, raw commands, tool arguments, output,
 * headers and unknown nested data never cross this boundary. URLs retain only
 * their public location; credentials, query parameters and fragments are
 * removed.
 */
export function summarizeRunTraceDetail(
  detail: ActivityEvent["detail"],
): RunTraceDetailItem[] {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return [];
  const source = detail as DetailRecord;
  const items: RunTraceDetailItem[] = [];

  for (const field of DETAIL_FIELDS) {
    const value = field.format(source[field.key]);
    if (value !== null) {
      items.push({ key: field.key, value });
    }
  }

  const scope = source.scope;
  if (scope && typeof scope === "object" && !Array.isArray(scope)) {
    const scopeTool = safeIdentifier((scope as DetailRecord).toolName);
    if (scopeTool) {
      items.push({
        key: "scope.toolName",
        value: scopeTool,
      });
    }
  }

  return items;
}

function detailRecord(event: ActivityEvent): DetailRecord | null {
  return event.detail &&
    typeof event.detail === "object" &&
    !Array.isArray(event.detail)
    ? (event.detail as DetailRecord)
    : null;
}

function detailString(event: ActivityEvent, key: string): string | null {
  const value = detailRecord(event)?.[key];
  return typeof value === "string" ? value : null;
}

export function isRunTraceToolEvent(event: ActivityEvent): boolean {
  return (
    event.type === "vm_command" ||
    event.type === "vm_file" ||
    safeIdentifier(detailRecord(event)?.selectedTool) !== null
  );
}

function eventCategories(
  event: ActivityEvent,
): Exclude<RunTraceCategory, "all">[] {
  const categories: Exclude<RunTraceCategory, "all">[] = [];
  if (
    event.type === "task_created" ||
    event.type === "task_delegated" ||
    event.type === "subagent_created"
  ) {
    categories.push("people");
  }
  if (isRunTraceToolEvent(event)) categories.push("tools");
  if (
    event.type === "judge_review" ||
    event.type === "approval_requested" ||
    event.type === "approval_resolved"
  ) {
    categories.push("gates");
  }
  if (
    event.type === "error" ||
    event.severity === "warning" ||
    event.severity === "critical"
  ) {
    categories.push("issues");
  }
  return categories;
}

function projectEvent(event: ActivityEvent): RunTraceEvent {
  const operationsEventKind = activityOperationsEventKind(event);
  return {
    ...(operationsEventKind ? { operationsEventKind } : {}),
    id: event.id,
    agentId: event.agentId,
    taskId: event.taskId,
    type: event.type,
    summary: event.summary,
    severity: event.severity,
    createdAt: event.createdAt,
    categories: eventCategories(event),
    detail: summarizeRunTraceDetail(event.detail),
  };
}

export function filterRunTraceEvents(
  events: RunTraceEvent[],
  category: RunTraceCategory,
): RunTraceEvent[] {
  return category === "all"
    ? events
    : events.filter((event) => event.categories.includes(category));
}

/** The API supplies a bounded activity window, not a complete execution ledger. */
export const RUN_TRACE_LIMIT = 200;
export function scopedActivities(
  taskId: number,
  activities: ActivityEvent[],
): ActivityEvent[] {
  const seen = new Set<number>();
  return activities
    .filter((event) => {
      if (event.taskId !== taskId || seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id,
    )
    .slice(-RUN_TRACE_LIMIT);
}

export function buildRunTrace({
  task,
  activities,
  subtasks = [],
}: BuildRunTraceInput): RunTrace {
  const events = scopedActivities(task.id, activities);
  const latest = (predicate: (event: ActivityEvent) => boolean) =>
    [...events].reverse().find(predicate);
  const fromEvent = (
    id: RunTraceStageId,
    evidence: RunTraceStage["evidence"],
    event?: ActivityEvent,
  ): RunTraceStage => ({
    id,
    state: event ? "recorded" : "missing",
    source: event ? "activity" : null,
    evidence: event ? evidence : "missing",
    timestamp: event?.createdAt ?? null,
    activityId: event?.id ?? null,
  });
  const fromTask = (
    id: RunTraceStageId,
    evidence: RunTraceStage["evidence"],
    timestamp: string,
  ): RunTraceStage => ({
    id,
    state: "recorded",
    source: "task",
    evidence,
    timestamp,
    activityId: null,
  });
  const uniqueAgentIds = new Set<number>([task.ownerAgentId]);
  if (task.assignedByAgentId !== null)
    uniqueAgentIds.add(task.assignedByAgentId);
  for (const event of events)
    if (event.agentId !== null) uniqueAgentIds.add(event.agentId);
  for (const child of subtasks.filter(
    (child) => child.parentTaskId === task.id,
  )) {
    uniqueAgentIds.add(child.ownerAgentId);
    if (child.assignedByAgentId !== null)
      uniqueAgentIds.add(child.assignedByAgentId);
  }
  return {
    stages: [
      fromTask("intake", "created", task.createdAt),
      fromEvent(
        "plan",
        "planningRecorded",
        latest(
          (e) =>
            e.type === "task_status_changed" &&
            detailString(e, "status") === "planning",
        ),
      ),
      fromTask("route", "owned", task.updatedAt),
      // A selected tool is intent only. A recorded progress/tool event is still not proof of execution success.
      fromEvent(
        "execute",
        "executionRecorded",
        latest(
          (e) =>
            e.type === "progress_update" ||
            e.type === "vm_command" ||
            e.type === "vm_file",
        ),
      ),
      fromEvent(
        "review",
        "reviewRecorded",
        latest(
          (e) =>
            e.type === "judge_review" ||
            e.type === "approval_requested" ||
            e.type === "approval_resolved",
        ),
      ),
      task.resultSummary
        ? fromTask("deliver", "summaryStored", task.updatedAt)
        : task.status === "completed"
          ? fromTask(
              "deliver",
              "markedCompleted",
              task.completedAt ?? task.updatedAt,
            )
          : fromEvent("deliver", "missing"),
    ],
    stats: {
      eventCount: events.length,
      toolEventCount: events.filter(isRunTraceToolEvent).length,
      judgeCount: events.filter((e) => e.type === "judge_review").length,
      warningCount: events.filter((e) => e.severity === "warning").length,
      errorCount: events.filter(
        (e) => e.type === "error" || e.severity === "critical",
      ).length,
      uniqueAgentIds: [...uniqueAgentIds].sort((a, b) => a - b),
    },
    events: events.map(projectEvent),
  };
}
