import type { ApprovalCopy } from "../approval-copy";
export default {
  emptyPage: "No requests on this page",
  closedPreview: "Command previews are hidden for closed permissions.",
  eyebrow: "Human control",
  title: "Approval inbox",
  description:
    "Review what agents are asking to do. Check the exact scope before deciding.",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  spend: "Spending",
  delete: "Deletion",
  publish: "Publishing",
  external_contact: "External contact",
  other: "Other",
  shown: "Requests shown",
  newer: "Newer requests",
  older: "Older requests",
  retry: "Refresh requests",
  loading: "Loading approval requests",
  loadError: "Approval requests could not be loaded.",
  stale:
    "Requests could not be refreshed. Decisions are paused until the latest state can be checked.",
  emptyPending: "No pending requests",
  emptyPendingHelp: "New requests for your decision will appear here.",
  emptyApproved: "No approved requests",
  emptyApprovedHelp:
    "Approved requests are listed here. Approval does not confirm execution.",
  emptyRejected: "No rejected requests",
  emptyRejectedHelp: "Rejected and expired requests are listed here.",
  requester: "Requested by",
  unknownRequester: "Expert",
  task: "Open task",
  note: "Decision note",
  notePlaceholder: "Optional note, up to 2,000 characters",
  approve: "Approve",
  reject: "Reject",
  saving: "Saving decision…",
  approvedSaved: "Approval recorded",
  rejectedSaved: "Rejection recorded",
  approvedHelp:
    "Execution is not yet confirmed. Follow the linked task for the outcome.",
  rejectedHelp: "The task is blocked until its next instruction.",
  safetyStopped:
    "Emergency stop is active. You can reject requests; approval is paused.",
  safetyUnknown:
    "Safety status could not be verified. You can reject requests; approval is paused.",
  scope: "Single-use permission for this exact action",
  tool: "Tool",
  target: "Target",
  hash: "Command digest",
  preview: "Exact preview",
  expires: "Expires",
  consumed: "Permission consumed",
  consumedHelp:
    "Use of this permission does not confirm the action succeeded. Check the task.",
  expired: "Expired",
  noExpiry: "No expiry specified",
  unscoped:
    "This request records your decision. It does not grant a reusable tool permission.",
  source: "Request text supplied by the agent.",
  missingScope:
    "The exact scope, preview or expiry is missing or invalid. Request a fresh approval.",
  hostTitle: "Host shell command",
  hostCategory: "Host access",
  hostWarning:
    "This command runs outside the agent sandbox using the API service's operating-system account.",
  hostDetails:
    "It does not elevate Windows UAC or Unix privileges. It can affect files, programs and processes accessible to that account. Review the server-provided command and target below.",
  hostConfirm: "Confirm host command",
  confirmInstruction: "Enter the first 8 characters of the digest shown below.",
  confirmInput: "First 8 digest characters",
  confirmSubmit: "Approve host command",
  cancel: "Cancel",
  unknownError:
    "The decision result could not be confirmed. Refresh requests before deciding again.",
  changedError:
    "This request changed or was already resolved. Refresh it before deciding.",
  expiredError: "This permission expired. Ask the agent for a new request.",
  confirmationError:
    "The command digest did not match. Review the current request.",
  inputError:
    "The decision could not be accepted. Check your note and refresh the request.",
} satisfies ApprovalCopy;
