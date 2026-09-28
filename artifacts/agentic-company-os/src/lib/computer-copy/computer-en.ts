import type { ComputerCopy } from "../computer-copy";
const copy: ComputerCopy = {
  commandRequired: "Enter a command.",
  title: "Computer workspace",
  agentLabel: "{name} computer workspace",
  scope:
    "Browser, commands and files belong to this expert's shared workspace.",
  projectScope:
    "These tools share the expert's workspace across projects. Commands entered here are operator actions, not steps of this project.",
  source: "Original source content",
  activity: "Recorded activity",
  activityHelp:
    "Up to 20 records per page for this expert; they may belong to other work. Only the latest page refreshes automatically.",
  projectActivityHelp:
    "Up to 20 records per page filtered to this project. Operator commands entered here are not project-scoped.",
  activityEmpty: "No records in this window.",
  activityError: "Activity could not be loaded.",
  activityStale: "Refresh failed. Previously loaded records remain visible.",
  refresh: "Refresh",
  loading: "Loading…",
  ready: "Workspace exists",
  notCreated: "Created on first use",
  statusError: "Workspace status could not be verified.",
  bytes: "Stored bytes",
  files: "Work files",
  folders: "Folders",
  browser: "Browser",
  terminal: "Terminal",
  surfaces: "Computer tools",
  follow: "Follow new agent events",
  followHelp:
    "Switch tools only when a new agent event arrives. Your typing is never interrupted.",
  permissionOff: "Browser permission is disabled.",
  terminalHelp:
    "One command runs per request. Workspace paths are restricted; this is not operating-system isolation.",
  hostHelp:
    "Host commands run with the API service account's operating-system permissions. The server must explicitly enable this mode.",
  host: "Host operator",
  workspace: "Workspace",
  command: "Command",
  run: "Run command",
  keyboard:
    "Enter adds a line. Ctrl/Command+Enter runs outside text composition.",
  tooLong:
    "The command exceeds 32,768 characters. The draft was not shortened.",
  disabled: "Terminal permission is disabled.",
  blocked: "Commands are unavailable until safety status permits them.",
  cwdLoading: "Checking the working directory…",
  cwdError:
    "The working directory could not be verified. Refresh before running a command.",
  folder: "Working directory",
  running: "Request sent; waiting for a result…",
  unconfirmed: "Command outcome unconfirmed",
  unconfirmedHelp:
    "The action may have run. Its outcome remains unconfirmed. Checking only reads this request’s record. It never repeats or cancels the action.",
  reviewCheck:
    "I reviewed the possible effects. Continuing only clears this local warning; it does not cancel or repeat the command.",
  reviewDone: "Finish review",
  storageError:
    "This tab could not save recovery data. Your draft remains visible; new commands are blocked.",
  storageRetry: "Retry local save",
  damaged:
    "Saved terminal data is damaged. Review any previous command before clearing this local record.",
  localOnly:
    "Drafts and the latest reply stay in this browser tab, including reloads. Closing the tab may remove them. They are not shared with your phone or another device.",
  result: "Recorded command response",
  output: "Command output",
  emptyOutput: "No output was returned.",
  copy: "Copy output",
  copied: "Copied",
  copyError: "Copy failed. You can select the output manually.",
  clearOutput: "Clear visible output",
  reuse: "Use command as draft",
  exit: "Exit code",
  duration: "Duration",
  latest: "Latest result",
  historyHelp:
    "At most 6 recent responses are shown; only the latest response is saved for reload recovery.",
};
export default copy;
