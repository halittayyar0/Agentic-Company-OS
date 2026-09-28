import type { ExpertDetailCopy } from "../expert-detail-copy";
const copy: ExpertDetailCopy = {
  managedPrompt:
    "This managed role follows the workspace language. Editing and saving creates custom instructions; later language changes will preserve your text.",
  promptRequired: "Enter working instructions before saving.",
  invalid: "Invalid expert address",
  missing: "Expert not found",
  loadError: "Expert could not be loaded",
  loadHelp:
    "The record may be unavailable or no longer exist. Return to the directory or retry.",
  loading: "Loading expert…",
  refresh: "Refresh record",
  stale:
    "The last loaded record is shown. Refresh successfully before changing settings.",
  created: "Created",
  lastSeen: "Last reported activity",
  noSignal: "No report",
  noStep: "No current step reported",
  nextModel: "Saved work model",
  changeModel: "Change model",
  modelHelp:
    "This choice applies when the next turn selects a model. It does not switch an already-running request or guarantee provider access.",
  save: "Save changes",
  saving: "Saving…",
  saved: "The server confirmed the change.",
  unknown:
    "The result could not be confirmed; the change may have been saved. Refresh and review before submitting again.",
  changed:
    "The expert configuration changed elsewhere. Refresh and review the latest values before saving.",
  busyError:
    "Permissions cannot change while this expert has a running turn. Wait for it to finish, then refresh.",
  capacity:
    "The active expert limit is full. Review the roster before restoring this expert.",
  denied:
    "This change was rejected by the server. Refresh and review the expert's permissions and model selection.",
  review: "Review latest values",
  discard: "Use saved instruction",
  source: "Original stored content",
  promptHelp:
    "Instructions guide the expert's behavior; they do not grant tool permissions. Your draft stays on this page until you save or leave.",
  promptChanged:
    "The saved instruction changed while you were editing. Your draft was retained. Compare it with the server's version before saving.",
  permissionsHelp:
    "These are saved permissions. Runtime policies and required human approvals still apply. Permissions cannot change during a leased turn.",
  enabled: "Enabled",
  disabled: "Disabled",
  hostShell: "Root CEO host shell",
  hostHelp:
    "A host command still needs exact, single-use human approval and the server's host-execution setting. It runs with the service account's existing OS rights, without a sandbox or privilege elevation.",
  archive: "Archive expert",
  archiveTitle: "Archive this expert?",
  archiveHelp:
    "This removes the expert from the active roster, blocks its open work and revokes unused approval capabilities for that work. Records are retained. An approved action already in flight prevents archiving until its outcome is recorded.",
  restore: "Restore expert",
  restoreHelp:
    "Restoring returns the expert to the active roster. Previously blocked tasks are not resumed automatically.",
  cancel: "Cancel",
  active: "Active roster",
  archived: "Archived",
  chat: "Chat",
  computer: "Computer",
  tasks: "Tasks",
  stats: "Statistics",
  settings: "Settings",
  taskLoading: "Loading assigned tasks…",
  taskError: "Assigned tasks could not be loaded.",
  taskEmpty: "No tasks are assigned to this expert.",
  taskWindow:
    "Up to the 200 most recent assigned tasks are shown. Older records may exist.",
  progress: "Progress",
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
  statsWindow:
    "This sample uses at most the latest 200 activity events and 200 messages. These are not lifetime totals, successful-action counts or cost records.",
  statsError:
    "Statistics sources are unavailable. Missing data is not treated as zero.",
  replies: "Agent replies in sample",
  toolEvents: "Terminal and file events",
  createdTasks: "Task creation events",
  delegations: "Delegation events",
  reviews: "Review events",
  approvalRequests: "Approval requests",
  modelUsage: "Recorded models",
  modelUsageHelp:
    "Top five recorded models; each bar shows its share of the sampled agent replies.",
  noModels: "No model IDs were recorded in these replies.",
  recentTools: "Recent terminal and file events",
  noTools: "No terminal or file events in this sample.",
  oldest: "Oldest sampled event",
  records: "Sampled activity events",
  avatar: "Portrait",
  avatarBuiltin: "Built-in portrait",
  avatarCustom: "Custom portrait",
  avatarHelp:
    "PNG, JPEG or WebP, up to 5 MB. The browser crops and compresses locally, then saves a copy of at most 64 KB on your own server. The original file is not sent to an image service.",
  chooseImage: "Choose image",
  processing: "Preparing…",
  preview: "Unsaved preview",
  resetAvatar: "Use built-in portrait",
  saveAvatar: "Save portrait",
  avatarFileError:
    "Choose a nonempty PNG, JPEG or WebP file no larger than 5 MB.",
  avatarPrepareError:
    "This image could not be prepared. Try a smaller valid image; the maximum resolution is 40 megapixels.",
  avatarChanged:
    "The saved portrait changed. Your preview is retained; refresh and review before saving it.",
  configuration: "Saved configuration",
  configHelp:
    "Role instructions describe intent. The permissions below control access, together with server policies and approvals. This view does not measure runtime health or host isolation.",
  serverPrompt: "View the latest saved instruction",
  busyArchive:
    "An approved action is in flight. Wait for its recorded outcome before archiving.",
  readonly:
    "This server did not supply a configuration version. Refresh before editing.",
  actionTitle: "Permission",
  taskMore: "Open all projects",
};
export default copy;
