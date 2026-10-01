import type { ProjectStudioCopy } from "../project-studio-copy";
const copy: ProjectStudioCopy = {
  budgetHeading: "Paused at the usage limit",
  budgetHelp:
    "Checking uses no model tokens and does not reset usage. Resumed work uses your existing allowance. If it is exhausted, raise the configured limits or wait for the rolling daily window to renew.",
  budgetGuide: "Usage limits guide",
  budgetCheck: "Check allowance and resume",
  budgetChecking: "Checking…",
  budgetAccepted: "{count} tasks queued to continue.",
  budgetStillPaused: "{count} tasks remain paused.",
  budgetUnknown:
    "The result is unconfirmed. Inspect the saved receipt before sending a new request.",
  budgetInspect: "Inspect receipt",
  budgetMissing:
    "No committed receipt was found yet. The request may still be in progress; you can safely retry the same request.",
  budgetRetry: "Retry the same request",
  budgetStorage:
    "Recovery details could not be stored in this tab. Nothing was sent, or details for a confirmed action could not be cleared. Enable browser storage and inspect the receipt.",
  budgetSnapshotError: "Could not read the current task scope. Check again.",
  budgetLoadError:
    "The resume control could not load. Reload the page; the saved request is retained.",
  budgetReasonEmergency:
    "Emergency stop is active. Check again after it is lifted.",
  budgetReasonChanged:
    "The task or root scope changed. Review its current state.",
  budgetReasonInvalid:
    "This task has no valid rooted scope. No work was resumed.",
  budgetReasonLarge: "This family exceeds 1,000 tasks. No work was resumed.",
  budgetReasonExhausted:
    "The allowance is still exhausted. Check again after raising the limit or the rolling daily window renews.",
  budgetReasonIneligible:
    "No work can safely resume right now. Review owners, approvals and unfinished operations.",
  answerHeading: "{name} is waiting for your answer",
  answerHelp:
    "Review the question. Sending your answer queues this task to continue.",
  answerLabel: "Your answer",
  answerPlaceholder: "Write your decision or the missing information…",
  answerDraft:
    "Your draft stays in this browser tab after a reload. Do not include credentials.",
  answerRequired: "Enter an answer.",
  answerLong: "Use 1,200 characters or fewer.",
  answerSend: "Send answer and continue",
  answerSending: "Sending answer…",
  answerAccepted: "Answer recorded. The task was queued to continue.",
  answerUnknown:
    "Delivery is unconfirmed. Your text is preserved; check the saved receipt before proceeding.",
  answerCheck: "Check delivery",
  answerNotRecorded:
    "No committed receipt was found. The request may still be in progress. You can retry the same answer safely.",
  answerRetry: "Retry the same answer",
  answerStorage:
    "Could not save recovery details in this tab. Nothing was sent. Keep a copy of your answer and enable browser storage.",
  answerUnavailable:
    "This task has no answerable question right now. Refresh to check again.",
  answerChanged:
    "The question changed. Your draft is preserved. Open the current question and review your answer before sending.",
  answerReview: "Open current question",
  answerRejected: "The server did not accept this answer.",
  answerTaskChanged:
    "The task or its owner changed. Refresh before continuing.",
  answerOwnerInactive: "The responsible agent is inactive.",
  answerEmergency: "Emergency stop is active. Refresh after it is lifted.",
  answerQuestionLabel: "Recorded question",
  answerQuestionError: "Could not load the question. Your draft is preserved.",
  answerPendingHelp:
    "The saved answer is locked until its delivery is resolved. Checking never sends it again.",
  unavailable: "Unavailable",
  recordsMissing: "Activity records could not be loaded.",
  tasksMissing: "Child tasks could not be loaded.",
  tasksLoading: "Loading child tasks…",
  tasksStale: "Could not refresh child tasks. Showing the last retrieved list.",
  completedWork: "Completed loaded child tasks",
  recordStatus: "Recorded state",
  invalidTitle: "Invalid project address",
  invalidHelp: "This link has no valid project ID.",
  missingTitle: "Project not found",
  missingHelp: "Project #{id} may have been deleted or never created.",
  loadError: "Could not load project",
  loadHelp:
    "Could not retrieve project details. Check the connection and retry.",
  stale:
    "Refresh failed. Showing the last loaded project; check its current state before starting an action.",
  snapshot: "Last retrieved: {time}",
  retry: "Retry",
  back: "Back to projects",
  parent: "Parent project",
  operations: "Project operations",
  stop: "Stop",
  stopTitle: "Stop this work?",
  stopHelp:
    "Stop “{title}” and its active child work. Completed external effects remain; records are kept.",
  dismiss: "Cancel",
  confirmStop: "Stop work",
  stopping: "Waiting for stop result…",
  stopped: "Stop recorded",
  unknownStop: "Stop result is unconfirmed",
  unknownHelp:
    "The request may have reached the server. Checking the state does not send another stop request.",
  checkState: "Check state",
  checking: "Checking…",
  activeAfterCheck:
    "The last check shows active work. The earlier request outcome is unknown. You can separately confirm another stop.",
  reviewStop: "Review another stop",
  terminalObserved:
    "Server state: {status}. This check alone does not prove the earlier request outcome.",
  storageError:
    "Could not save the stop record in this tab; no request was sent. Check browser storage.",
  continuous: "Continuous · {count} cycles",
  finite: "Finite work",
  mode: "{name} mode",
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
  warning: "Latest work warning",
  source: "Original record text",
  nextAttempt: "Next attempt: {time}",
  partial: "Some project details are unavailable: {sections}.",
  plan: "Work plan",
  experts: "Expert roster",
  team: "Project team",
  chatMissing: "Project conversation unavailable",
  ownerMissing:
    "The coordinator could not be verified. Check the current project and team details.",
  members: "Team members: {count}",
  memberLabel: "Project team members",
  emptyTeam: "No team information is available yet.",
  coordinatorHelp:
    "{name} coordinates the work; it is available to the whole team.",
  loading: "Loading project studio",
  tabs: "Project workspace views",
  workspace: "Workspace",
  planTab: "Plan and trace",
  meetings: "Meetings",
  teamTab: "Team",
  evidence: "Delivery",
  rosterHelp: "This project's recorded team",
  coordinator: "Coordinator",
  workCount: "Tasks: {count}",
  inTeam: "Team member",
  inactive: "Inactive",
  planHelp: "Recorded child tasks and their last loaded state",
  steps: "Steps: {count}",
  noTasks: "No child tasks yet",
  noTasksHelp: "The plan appears here when an expert records its tasks.",
  expertId: "Expert #{id}",
  records: "Activity records",
  recordsHelp:
    "Latest {count} activities recorded by the server. This window may omit older history.",
  recordsLoading: "Loading records",
  recordsError: "Could not refresh activity. Last loaded records are retained.",
  noRecords: "No work records yet",
  runSummary: "Recorded summary",
  progress: "Progress",
  attempts: "Work attempts",
  tokens: "Tokens",
  model: "Recorded model",
  unknownModel: "No model recorded",
  deliveryHelp:
    "This is the delivery summary saved by the agent. Review verification records in the {tab} tab.",
  reviewDelivery: "Review evidence",
  cycleDeliveryNote:
    "This is the latest saved delivery. The current status of the recurring responsibility is shown above.",
  deliverySummary: "Delivery summary",
  noDelivery:
    "No delivery summary has been recorded yet. It appears here when saved.",
};
export default copy;
