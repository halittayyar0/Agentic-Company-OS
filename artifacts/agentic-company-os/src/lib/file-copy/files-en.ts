import type { FileCopy } from "../file-copy";
const copy: FileCopy = {
  filesTitle: "Workspace files",
  filesHelp:
    "Files are shared across this expert's projects. Review the current version before saving.",
  root: "Workspace root",
  openFile: "Open file",
  openFolder: "Open folder",
  newFile: "New file",
  refreshFiles: "Refresh file list",
  loadingFiles: "Loading files…",
  listError: "The directory could not be loaded.",
  listStale: "Refresh failed. The last loaded directory remains visible.",
  partialList:
    "This listing is incomplete. At most 2,000 entries are examined; unsupported or unreadable items may be omitted.",
  emptyList: "This directory is empty.",
  entriesLabel: "Displayed items",
  pathLabel: "Relative file path",
  pathHelp:
    "Use / between folders. Creating a file never replaces an existing file.",
  pathInvalid:
    "Enter a relative path of at most 2,048 characters, without empty, . or .. segments, backslashes, or outer spaces.",
  create: "Create",
  fileCreated: "The server confirmed file creation.",
  contentLabel: "{name} content",
  save: "Save",
  close: "Close",
  readError: "The file could not be read. Your draft is kept.",
  reading: "Reading file…",
  readonly:
    "Preview only. Truncated, binary or unsupported files cannot be saved here.",
  contentInvalid:
    "Use complete UTF-8 text without NUL characters, within 128 KiB. Your draft was not shortened.",
  snapshotHint:
    "You are editing a snapshot. The server checks its version again when saving.",
  saved: "The server confirmed the saved content.",
  draftsTitle: "Saved drafts in this tab",
  resumeDraft: "Resume draft",
  discardDraft: "Discard draft",
  discardTitle: "Discard this local draft?",
  discardBody:
    "This removes the local draft. It does not undo or cancel a server write.",
  discardConfirm: "Discard local draft",
  reviewTitle: "Review file version",
  reviewHelp:
    "Your draft is kept. Compare the current server file before another save.",
  compare: "Compare current file",
  comparisonLabel: "Current server content",
  comparisonError:
    "The current file could not be read. Your draft remains; review is incomplete.",
  reviewCheck:
    "I reviewed the current content. A later save may replace this version with my draft.",
  reviewDone: "Finish review",
  writeUnknown: "Write outcome unconfirmed",
  writeUnknownHelp:
    "The request may have changed the file. Inspect current content and server activity before clearing this local warning. Clearing it never repeats or cancels the request.",
  writePending: "Request sent; waiting for a file response…",
  reviewRequest: "Review earlier write",
  missingFile:
    "The file is currently absent. This does not prove whether an earlier request ran.",
  fileStorageError:
    "This tab could not save recovery data. Keep or copy the visible drafts before leaving. New writes are blocked.",
  fileDamaged:
    "Saved file data is damaged. Check previous effects and copy visible drafts before clearing local data.",
  fileResetCheck:
    "I checked previous effects and copied any needed drafts. Clear this tab's file drafts and write warning.",
  fileReset: "Clear local file data",
  fileLocalOnly:
    "Drafts and pending writes stay in this browser tab, including reloads. Closing the tab may remove them. They are not shared with other devices.",
  fileBlocked: "File changes are unavailable until safety status permits them.",
  title: "Review deletion",
  remove: "Delete",
  help: "Every listed item will be permanently removed. A changed scope requires another review. Keep other programs from editing these files.",
  inspect: "Inspect current scope",
  inspecting: "Inspecting…",
  scope: "Complete deletion scope",
  count: "Items, including the target",
  bytes: "File bytes",
  file: "File",
  folder: "Folder",
  confirm:
    "I reviewed this complete scope and understand that deletion cannot be undone.",
  submit: "Delete reviewed scope",
  pending: "Waiting for the deletion response…",
  cancel: "Cancel",
  success: "The server confirmed deletion.",
  unknown: "Deletion outcome unconfirmed",
  unknownHelp:
    "The request may have deleted some or all of the target. Inspect current files and server activity. Do not assume that an error preserved the contents.",
  missing:
    "The target is currently absent. This does not identify who removed it or prove the earlier request completed.",
  error:
    "The scope could not be inspected. Check the connection, permissions and whether the files are still changing.",
  limited:
    "This scope cannot be reviewed here: it may contain links or special files, or exceed 1,000 items, 64 MiB, 32 levels or the inspection time limit. Manage it on the server.",
  changed: "The scope changed. Inspect it again before confirming deletion.",
  storageError:
    "This tab could not save recovery data. No new deletion request will be sent.",
  damaged:
    "Saved deletion data is damaged. Review earlier effects before clearing this local record.",
  clearConfirm:
    "I checked the possible effects. Clearing this warning does not cancel or repeat a server request.",
  clear: "Clear local warning",
  recover: "Review earlier deletion",
  localOnly:
    "Recovery stays in this browser tab. Closing the tab may remove it; it is not shared with other devices.",
  storageRetry: "Retry local save",
  blocked: "Deletion is unavailable until safety status permits it.",
  required: "Confirm the reviewed scope before deleting.",
};
export default copy;
