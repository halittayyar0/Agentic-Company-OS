import type { MeetingTurnCopy } from "../meeting-turn-copy";
const copy: MeetingTurnCopy = {
  outcomeHelp:
    "Replies saved for this turn; this is not the current meeting view.",
  recordedFailure:
    "The recorded result reports a failure. Review the available replies and skipped experts.",
  skipped: "Experts without a recorded reply",
  skip_busy: "Busy",
  skip_unavailable: "Unavailable",
  skip_empty_response: "No reply produced",
  skip_model_error: "Reply generation failed",
  skip_provider_unavailable: "Provider unavailable",
  skip_budget_guard: "Reply budget reached",
  inboxTitle: "Saved meeting turns",
  inboxHelp:
    "Saved requests for this project remain available even when their meeting is not listed. These records belong to this browser tab; clearing them does not cancel server work.",
  meetingId: "Meeting ID",
  participants: "Saved participant IDs",
  defaultParticipants: "Not specified in the saved request",
  noParticipants: "Empty participant list",
  tokenLimit: "Saved response token limit",
  defaultLimit: "Not specified; server default",
  damagedTitle: "Damaged turn record",
  reviewDamaged: "Review damaged record",
  damagedHelp:
    "The original local content is shown below. Copy any needed evidence before clearing it. No request can be sent from damaged data.",
  clearDamaged: "Clear reviewed local record",
  clearHelp:
    "I have reviewed and retained the evidence I need. Clearing this local copy does not cancel an accepted turn or delete its server records.",
  localKey: "Local record key",
  storageReadError:
    "Saved requests could not be read completely. This is not an empty inbox. Restore browser storage and refresh.",
  refreshInbox: "Refresh saved records",
  changed:
    "The record changed or could not be cleared. Refresh the inbox and review the current record.",
  previous: "Previous records",
  next: "Next records",
  scanMore: "Scan more saved records",
  scanIncomplete:
    "The storage scan is incomplete. More requests may exist; continue scanning to find them.",
  pageSummary: "Records {from}–{to} of {count} found",
  title: "Meeting turn recovery",
  help: "The original request is saved in this browser tab. Refreshing or checking its receipt does not start another turn.",
  prompt: "Saved operator message",
  pending:
    "The response has not been confirmed. Check the recorded outcome before sending again.",
  check: "Check recorded outcome",
  checking: "Checking…",
  running: "This accepted turn is still running. Check again later.",
  notRecorded:
    "No receipt was found. You can explicitly retry the same request identity and original input.",
  retry: "Retry original request",
  recorded:
    "This turn finished and its outcome is recorded. Review the meeting transcript before continuing.",
  unconfirmed:
    "The accepted turn's outcome is unconfirmed. The same identity will never run again.",
  review: "Review and continue",
  reviewHelp:
    "This clears only the local marker and does not cancel server work. A missing receipt does not prove the request was never accepted. A new turn may repeat work or incur model usage; review the saved input and available meeting records first.",
  continue: "I reviewed the records",
  cancel: "Keep recovery open",
  storage:
    "Browser storage is unavailable. No new turn can be sent until the recovery identity can be saved.",
  invalid:
    "The saved recovery record could not be read. Keep this tab and inspect its stored record before starting another turn.",
  loadError:
    "The receipt could not be verified. The original request remains saved.",
  recordId: "Request ID",
  requestFailed:
    "The turn response is unconfirmed. Use the recovery panel to inspect the saved outcome.",
};
export default copy;
