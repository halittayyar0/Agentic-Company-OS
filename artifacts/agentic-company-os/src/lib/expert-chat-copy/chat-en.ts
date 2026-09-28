import type { ExpertChatCopy } from "../expert-chat-copy";
export default {
  projectTitle: "Project conversation",
  projectHelp:
    "Messages and recent context are linked to this project and its coordinator. Existing tool permissions and approval requirements still apply.",
  projectPrompt: "Review this project’s goal and propose the next step.",
  projectUnavailable:
    "This project is unavailable or its coordinator changed. Refresh the project before sending a new request.",
  required: "Enter a message.",
  title: "Conversation",
  help: "Ask a question or queue work for this expert. Tool permissions and approvals still apply.",
  history: "Conversation history",
  empty: "Start a conversation",
  emptyHelp:
    "Messages are stored by the server. The model receives recent context, not unlimited memory.",
  loading: "Loading messages…",
  historyError: "Conversation history could not be loaded.",
  historyStale:
    "History could not be refreshed. The last loaded messages remain visible.",
  refresh: "Refresh history",
  older: "Load older messages",
  olderError:
    "Older messages could not be loaded. Your current view is preserved.",
  windowLimit:
    "Up to 500 messages are shown at once. Return to the latest messages to follow new activity.",
  latest: "View latest messages",
  newMessages: "New messages available",
  you: "You",
  system: "System record",
  model: "Recorded model",
  copy: "Copy message",
  copied: "Copied",
  copyError: "Copy failed. Select the message text to copy it.",
  unsafeLink: "Unsafe link blocked",
  mode: "Request type",
  ask: "Ask",
  delegate: "Assign work",
  continuous: "Ongoing responsibility",
  askHelp: "One conversation turn; the expert may use allowed tools.",
  delegateHelp:
    "Queue a project with a defined result. Queued work has not necessarily started.",
  continuousHelp:
    "Queue recurring work with a one-hour cadence. Execution depends on the worker and approvals.",
  instruction: "Message or work brief",
  placeholder: "Describe the question or result you need…",
  send: "Send request",
  keyboard: "Enter adds a line. Ctrl/⌘ + Enter sends.",
  tooLong: "This text exceeds the limit for the selected request type.",
  blocked:
    "New work is paused until the safety state allows it. You can still write and read saved results.",
  unavailable:
    "Refresh and review the expert configuration before sending. An archived expert cannot start new work.",
  draftLocal:
    "Unsent text is kept in this browser tab. Closing the tab may remove it.",
  storageError:
    "This tab could not save or clear its local record. Keep a copy of your text; sending stays closed until storage works.",
  sending: "Waiting for the server…",
  unconfirmed: "Result not yet confirmed",
  unconfirmedHelp:
    "The request may still be running or may have stopped. Checking its record does not run it again.",
  check: "Check saved result",
  checking: "Checking…",
  missing:
    "No saved result was found yet. A request already in flight may still arrive.",
  recover: "Recover the same request",
  recoverHelp:
    "Uses the original identity and settings. If the server never recorded it, this can start that saved request once.",
  readError:
    "The saved result could not be read. Keep this request identity and check again.",
  rejected: "The request was rejected before admission.",
  configChanged:
    "The expert configuration changed. Refresh and review it before creating a new request.",
  busy: "The expert is already working. This request was not admitted.",
  capacity:
    "The workspace capacity was reached. Review existing work before creating a new request.",
  invalid:
    "The server could not accept this request. Review the original text and selection.",
  conflict:
    "This identity does not match the stored request. Review records before continuing.",
  receipt: "Send record",
  done: "Reply recorded",
  queued: "Project queued",
  systemResult: "Turn ended with a system notice",
  project: "Open project",
  operations: "Open Operations",
  continue: "Continue",
  review: "Review before continuing",
  reviewHelp:
    "Clearing this tab’s pending record does not cancel server work. A new request could repeat actions. Review history, projects and tool records first.",
  acknowledge:
    "I reviewed the records and understand that a new request may repeat actions.",
  cancel: "Cancel",
  activity: "Recent recorded activity",
  activityHelp:
    "The latest 12 events for this expert. These may belong to other work; they do not prove this request is live or complete.",
  activityEmpty: "No recent activity recorded.",
  activityError:
    "Activity could not be refreshed. Any visible records may be older.",
  source: "Original record text",
  prompt: "Describe your role, capabilities and limits.",
} satisfies ExpertChatCopy;
