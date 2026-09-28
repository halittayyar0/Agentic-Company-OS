import type {
  ActivityEvent,
  ActivityEventType,
  TaskStatus,
} from "@workspace/api-client-react";

export type DelegationTaskRecord = {
  id: number;
  title: string;
  brief: string;
  status: TaskStatus;
  ownerAgentId: number;
  assignedByAgentId: number | null;
  resultSummary: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastError: string | null;
};

export type DelegationActivityRecord = Pick<
  ActivityEvent,
  | "id"
  | "taskId"
  | "agentId"
  | "type"
  | "summary"
  | "detail"
  | "severity"
  | "createdAt"
>;

export type DelegationMessageKind =
  "assignment" | "accepted" | "progress" | "response" | "completed" | "system";

export type DelegationMessage = {
  key: string;
  activityId: number | null;
  kind: DelegationMessageKind;
  associatedAgentId: number | null;
  speakerAgentId: number | null;
  recipientAgentId: number | null;
  content: string;
  createdAt: string;
  source: "task" | "activity";
  status?: TaskStatus;
};

const HIDDEN_ACTIVITY_TYPES = new Set<ActivityEventType>([
  "task_created",
  "task_delegated",
  "judge_review",
  "approval_requested",
  "approval_resolved",
  "vm_command",
  "vm_file",
  "subagent_created",
]);

function detailString(
  detail: DelegationActivityRecord["detail"],
  key: string,
): string | null {
  if (!detail || typeof detail !== "object") return null;
  const value = detail[key];
  return typeof value === "string" ? value : null;
}

function activityKind(
  activity: DelegationActivityRecord,
): DelegationMessageKind | null {
  if (HIDDEN_ACTIVITY_TYPES.has(activity.type)) return null;

  const lifecycle = detailString(activity.detail, "delegationLifecycle");
  if (lifecycle === "accepted") return "accepted";
  if (lifecycle === "completed") return "completed";
  if (lifecycle === "progress" || lifecycle === "cycle_completed") {
    return "progress";
  }

  if (activity.type === "progress_update") return "progress";
  if (activity.type === "note") return "response";
  if (activity.type === "task_status_changed") {
    return detailString(activity.detail, "status") === "completed"
      ? "completed"
      : "system";
  }
  if (activity.type === "error") return "system";
  return null;
}

function isOwnerProgressRecord(
  kind: DelegationMessageKind,
  activity: DelegationActivityRecord,
  task: DelegationTaskRecord,
): boolean {
  if (activity.agentId !== task.ownerAgentId) return false;
  return ["accepted", "progress", "response", "completed"].includes(kind);
}

function hasPersistedCompletion(messages: DelegationMessage[]): boolean {
  return messages.some((message) => message.kind === "completed");
}

/** Source projection only. Agent IDs indicate association, not authorship. */
export function buildDelegationMessages(
  task: DelegationTaskRecord,
  activities: DelegationActivityRecord[],
): DelegationMessage[] {
  if (task.assignedByAgentId === null) return [];

  const seen = new Set<number>();
  activities = activities
    .filter((activity) => {
      if (activity.taskId !== task.id || seen.has(activity.id)) return false;
      seen.add(activity.id);
      return true;
    })
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id,
    )
    .slice(-200);
  const messages: DelegationMessage[] = [
    {
      key: `task-${task.id}-assignment`,
      activityId: null,
      kind: "assignment",
      associatedAgentId: task.assignedByAgentId,
      speakerAgentId: task.assignedByAgentId,
      recipientAgentId: task.ownerAgentId,
      content: task.brief,
      createdAt: task.updatedAt,
      source: "task",
    },
  ];

  for (const activity of [...activities].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )) {
    const kind = activityKind(activity);
    if (!kind) continue;

    const ownerProgressRecord = isOwnerProgressRecord(kind, activity, task);
    messages.push({
      key: `activity-${activity.id}`,
      activityId: activity.id,
      kind,
      associatedAgentId: activity.agentId,
      speakerAgentId: ownerProgressRecord ? task.ownerAgentId : null,
      recipientAgentId: ownerProgressRecord ? task.assignedByAgentId : null,
      content: activity.summary,
      createdAt: activity.createdAt,
      source: "activity",
    });
  }

  if (
    task.status === "completed" &&
    task.completedAt &&
    task.resultSummary &&
    !hasPersistedCompletion(messages)
  ) {
    messages.push({
      key: `task-${task.id}-result`,
      activityId: null,
      kind: "completed",
      associatedAgentId: task.ownerAgentId,
      speakerAgentId: task.ownerAgentId,
      recipientAgentId: task.assignedByAgentId,
      content: task.resultSummary,
      createdAt: task.completedAt,
      source: "task",
    });
  }

  if (["failed", "blocked", "cancelled"].includes(task.status)) {
    messages.push({
      key: `task-${task.id}-status`,
      activityId: null,
      kind: "system",
      associatedAgentId: null,
      speakerAgentId: null,
      recipientAgentId: null,
      content: task.lastError ?? "",
      createdAt: task.updatedAt,
      source: "task",
      status: task.status,
    });
  }

  return [
    messages[0],
    ...messages
      .slice(1)
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          (left.activityId ?? Infinity) - (right.activityId ?? Infinity),
      ),
  ];
}
