import type { CodingRecoveryCopy } from "../coding-recovery-copy";
export default {
  title: "Coding session",
  description:
    "Reset a stopped coding session when it cannot continue. Previous files and history are kept. The task stays paused; review uncertain actions before continuing.",
  acknowledge:
    "I reviewed the task history and understand that uncertain actions remain unresolved.",
  reset: "Archive and reset session",
  checking: "Checking the session…",
  inspect: "Check saved result",
  retry: "Retry the same request",
  missing:
    "No result has been saved for this request yet. You can retry this same request.",
  unknown:
    "The reset result is unconfirmed. Check the saved result before making another request.",
  storage:
    "Recovery details cannot be saved safely in this tab. Check browser storage and review the task history before trying again.",
  snapshotError: "Session status could not be loaded. Try checking again.",
  success:
    "Session archived. Previous files and evidence are kept. The task has not restarted; review outstanding actions before continuing.",
  reasons: {
    task_missing: "This task no longer exists.",
    session_missing: "This task has no coding session to reset.",
    revision_changed:
      "The session changed. Check its current state before making a new request.",
    revision_exhausted:
      "The session cannot safely advance its record version. Ask the server administrator for help.",
    task_active:
      "The task is still owned or active. Stop it and wait for cleanup before trying again.",
    session_running:
      "The coding runtime is still owned. Wait for verified shutdown.",
    cleanup_unknown:
      "Shutdown has not been verified. A reset cannot safely start another runtime.",
    native_pending:
      "A native action is still awaiting a decision or a result. Review it first.",
    already_reset:
      "The previous session is archived. A later authorized coding task can start a fresh session.",
  },
} satisfies CodingRecoveryCopy;
