import {
  dispatchMeetingCommand,
  prepareMeetingCommand,
} from "./meeting-command-recovery";
import {
  dispatchMeetingTurn,
  prepareMeetingTurn,
  type MeetingTurnInput,
} from "./meeting-turn-recovery";
import type {
  ProjectMeeting,
  ProjectMeetingActionItem,
  ProjectMeetingActionItemInput,
  ProjectMeetingActionItemUpdate,
  ProjectMeetingActionStatus,
  ProjectMeetingCompleteInput,
  ProjectMeetingDecision,
  ProjectMeetingDecisionInput,
  ProjectMeetingDetail,
  ProjectMeetingInput,
  ProjectMeetingListItem,
  ProjectMeetingParticipant,
  ProjectMeetingStartInput,
  ProjectMeetingStartResponse,
  ProjectMeetingStatus,
  ProjectMeetingTranscript,
  ProjectMeetingTranscriptInput,
  ProjectMeetingUpdate,
} from "@workspace/api-client-react";

import { controlPlaneFetch } from "@/lib/auth";

export type {
  ProjectMeeting,
  ProjectMeetingActionItem,
  ProjectMeetingActionStatus,
  ProjectMeetingDecision,
  ProjectMeetingDetail,
  ProjectMeetingListItem,
  ProjectMeetingParticipant,
  ProjectMeetingStatus,
};

export type ProjectMeetingTranscriptEntry = ProjectMeetingTranscript;
export type CreateProjectMeetingInput = Omit<ProjectMeetingInput, "requestId">;
export type UpdateProjectMeetingInput = Omit<ProjectMeetingUpdate, "requestId">;
export type AddProjectMeetingTranscriptInput = Omit<
  ProjectMeetingTranscriptInput,
  "requestId"
>;
export type AddProjectMeetingDecisionInput = Omit<
  ProjectMeetingDecisionInput,
  "requestId"
>;
export type AddProjectMeetingActionInput = Omit<
  ProjectMeetingActionItemInput,
  "requestId"
>;
export type UpdateProjectMeetingActionInput = Omit<
  ProjectMeetingActionItemUpdate,
  "requestId"
>;
export type StartProjectMeetingInput = ProjectMeetingStartInput;
export type ProjectMeetingStartResult = ProjectMeetingStartResponse;
export type CompleteProjectMeetingInput = Omit<
  ProjectMeetingCompleteInput,
  "requestId"
>;

export const projectMeetingsQueryKey = (projectId: number) =>
  ["project-meetings", projectId] as const;

export const projectMeetingDetailQueryKey = (
  projectId: number,
  meetingId: number,
) => ["project-meetings", projectId, meetingId] as const;

export function listProjectMeetings(
  projectId: number,
): Promise<ProjectMeetingListItem[]> {
  return controlPlaneFetch(`/api/projects/${projectId}/meetings`);
}

export function getProjectMeeting(
  projectId: number,
  meetingId: number,
): Promise<ProjectMeetingDetail> {
  return controlPlaneFetch(`/api/projects/${projectId}/meetings/${meetingId}`);
}

export function createProjectMeeting(
  projectId: number,
  input: CreateProjectMeetingInput,
) {
  return dispatchMeetingCommand(
    prepareMeetingCommand({
      projectId,
      meetingId: null,
      actionItemId: null,
      kind: "create",
      input,
    }),
  );
}

export function updateProjectMeeting(
  projectId: number,
  meetingId: number,
  input: UpdateProjectMeetingInput,
) {
  return dispatchMeetingCommand(
    prepareMeetingCommand({
      projectId,
      meetingId: meetingId,
      actionItemId: null,
      kind: "update",
      input,
    }),
  );
}

export function startProjectMeeting(
  projectId: number,
  meetingId: number,
  input: MeetingTurnInput,
): Promise<ProjectMeetingStartResult> {
  return dispatchMeetingTurn(prepareMeetingTurn(projectId, meetingId, input));
}

export function completeProjectMeeting(
  projectId: number,
  meetingId: number,
  input: CompleteProjectMeetingInput,
) {
  return dispatchMeetingCommand(
    prepareMeetingCommand({
      projectId,
      meetingId: meetingId,
      actionItemId: null,
      kind: "complete",
      input,
    }),
  );
}

export function addProjectMeetingTranscript(
  projectId: number,
  meetingId: number,
  input: AddProjectMeetingTranscriptInput,
) {
  return dispatchMeetingCommand(
    prepareMeetingCommand({
      projectId,
      meetingId: meetingId,
      actionItemId: null,
      kind: "transcript",
      input,
    }),
  );
}

export function addProjectMeetingDecision(
  projectId: number,
  meetingId: number,
  input: AddProjectMeetingDecisionInput,
) {
  return dispatchMeetingCommand(
    prepareMeetingCommand({
      projectId,
      meetingId: meetingId,
      actionItemId: null,
      kind: "decision",
      input,
    }),
  );
}

export function addProjectMeetingAction(
  projectId: number,
  meetingId: number,
  input: AddProjectMeetingActionInput,
) {
  return dispatchMeetingCommand(
    prepareMeetingCommand({
      projectId,
      meetingId: meetingId,
      actionItemId: null,
      kind: "action",
      input,
    }),
  );
}

export function updateProjectMeetingAction(
  projectId: number,
  meetingId: number,
  actionItemId: number,
  input: UpdateProjectMeetingActionInput,
) {
  return dispatchMeetingCommand(
    prepareMeetingCommand({
      projectId,
      meetingId: meetingId,
      actionItemId: actionItemId,
      kind: "action-update",
      input,
    }),
  );
}
