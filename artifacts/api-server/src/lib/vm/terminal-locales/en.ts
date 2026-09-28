import type { TerminalCopy } from "../terminal-copy";

export const terminalEn = {
  emptyDirectory: "(empty)",
  usageCat: "Usage: cat <file>",
  usageMkdir: "Usage: mkdir <directory>",
  usageTouch: "Usage: touch <file>",
  usageWrite: "Usage: write <file> <content>",
  usageRemove: "Usage: rm <path>",
  written: "{path} written ({bytes} bytes)",
  removed: "{path} deleted",
  helpBuiltins: "Built-in commands:",
  helpProcessesEnabled:
    "External programs are enabled: {commands}. The working directory is the agent workspace; these programs can access the host system. Isolation must be provided by a separate container/VM.",
  helpProcessesDisabled:
    "External programs are disabled: {commands}. Enable them with ALLOW_AGENT_PROCESS_EXEC=true only inside an isolated container/VM; the command list is not a security boundary.",
  helpDeleteReview:
    "rm/del deletes directly. To review the version before deleting, use the deletion flow on the Files screen.",
  emptyCommand: "Empty command.",
  forbiddenCommand:
    "Command blocked for security reasons: shell redirection, chaining, quotation marks, backslashes and line breaks are not allowed.",
  commandNotAllowed: 'Command not allowed: "{command}". Use help for the list.',
  processDisabled:
    "External program execution is disabled by default. Use file commands, or set ALLOW_AGENT_PROCESS_EXEC=true only inside an isolated container/VM.",
  queuedCancelled:
    "The queued agent command was cancelled by the emergency stop.",
  invalidWorkspace: "Invalid workspace identifier.",
  unsafePath: 'Unsafe path rejected: "{path}"',
  regularFileReadOnly: "Only regular files can be read.",
  readLimit: "The file exceeds the read limit.",
  workspaceSymlink: "The agent workspace cannot be a symbolic link.",
  pathSymlink: "Symbolic link path rejected: {path}",
  directoryMissing: "Directory not found: {path}",
  directoryUnreadable: "Could not read directory: {path}",
  filePathRequired: "A file path is required.",
  fileMissing: "File not found: {path}",
  fileUnreadable: "Could not read file: {path}",
  rootReplaceDenied: "The workspace root cannot be replaced with a file.",
  contentTooLarge: "Content is too large (limit: {bytes} bytes).",
  binaryTooLarge: "Binary content is too large (limit: {bytes} bytes).",
  pathRequired: "A path is required.",
  rootDeleteDenied: "The workspace root cannot be deleted.",
  rootNotFile: "The workspace root is not a file.",
  regularFileTouchOnly: "touch can only be applied to regular files.",
  fileChanged: "The file has changed since the review. Review the new version.",
  fileNotEditable: "This file cannot be edited through this flow.",
  fileVersionRequired: "A reviewed file version is required for editing.",
  deleteChanged:
    "The content to be deleted has changed since the review. Review it again.",
  deleteMissing: "The content to be deleted no longer exists.",
  deleteNotReviewable:
    "The content to be deleted exceeds the limits for safe review.",
  deleteVersionRequired:
    "A reviewed version is required for deletion. Use the deletion review on the Files screen.",
  commandRequired: "command is required.",
  sudoCommandTooLong: "The sudo command must not exceed {limit} characters.",
  sudoCommandControls:
    "The sudo command cannot contain ASCII control characters or Unicode bidirectional control characters.",
  sudoWorkspaceSymlink: "The agent sudo workspace cannot be a symbolic link.",
  sudoDisabled:
    "Agent sudo is disabled (ALLOW_AGENT_SUDO=true is required to enable it).",
  sudoAuthorityDenied:
    "Agent sudo authorization was denied by the live identity check.",
  sudoTargetUnverified:
    "The physical workspace for agent sudo could not be verified.",
  sudoTargetMismatch:
    "The host/workspace binding for agent sudo did not match.",
  sudoAuthorityChanged:
    "Agent sudo authorization was denied after the effect boundary.",
  sudoTargetRecheckFailed:
    "The physical workspace for agent sudo could not be verified again.",
  sudoTargetChanged:
    "The host/workspace binding for agent sudo did not match after the effect boundary.",
  founderDisabled:
    "Founder shell is disabled (ALLOW_FOUNDER_SHELL=true is required to enable it).",
  terminalPermissionDenied:
    "Error: this agent does not have virtual Terminal permission.",
  errorPrefix: "Error: {message}",
  approvalRequired:
    "BLOCKED: {toolName} requires single-use, scoped user approval. Call request_approval with category={category}, toolName={toolName}, toolArgs={args}. Do not attempt this action or an equivalent action until approval is granted.",
  sudoRootOnly:
    "BLOCKED: CEO Host Shell is available only to the root CEO agent.",
  sudoPermissionDenied:
    "BLOCKED: the root CEO agent does not have host shell permission.",
  sudoApprovalRequired:
    "BLOCKED: vm_run_sudo_command requires separate, single-use user approval for each exact command. Call request_approval with toolName=vm_run_sudo_command and the same proposed command in toolArgs; the server generates the critical approval text and target itself. Stop until approval is granted.",
  terminalDispatch: "Sending Terminal command",
  sudoDispatch: "Sending approved Terminal command",
  terminalExecuted: "{name} ran {command} on their virtual computer.",
  terminalFailed: "{name} encountered an error in a Terminal command.",
  sudoExecuted:
    "The approved CEO Host Shell command was executed for {name} (exitCode={exitCode}).",
  sudoFailed: "{name} encountered an error in an approved Terminal command.",
  terminalFailureFallback: "Terminal command failed",
  sudoFailureFallback: "Approved Terminal command failed",
  terminalError: "Terminal error: {message}",
  noOutput: "(no output)",
  interrupted: "(command interrupted before completion)",
  exitCode: "(exit code: {code})",
  note: " [note: {note}]",
  operatorComplete: "Operator request completed",
  operatorReview: "The outcome of the operator request requires review",
  invalidToolJson: "Error: tool arguments contain invalid JSON.",
  invalidToolObject: "Error: tool arguments must be a JSON object.",
  exclusiveTools:
    "BLOCKED: {toolName} is not among the tools allowed for this turn. Allowed tools: {tools}. Do not attempt the same action through another route.",
  exclusiveSudoMismatch:
    "BLOCKED: command does not match the exact command specified by the user. Do not change the command or execute an equivalent command.",
  emergencyBlocked:
    "BLOCKED: the emergency stop was activated, or its state changed during execution; the Terminal operation was stopped.",
  agentInactive:
    "BLOCKED: the agent was deactivated; the tool was not executed.",
  categoryRevoked:
    "BLOCKED: the agent's permission for the approval category was revoked; the action was not executed.",
  taskLeaseMissing:
    "BLOCKED: task execution authority is missing; the tool was not executed.",
  taskLeaseLost:
    "BLOCKED: the task was stopped, or execution authority over the task, agent or attempt was lost.",
  operationLeaseLost:
    "BLOCKED: authority to execute the operation invocation was lost.",
  taskBoundary: "Tool boundary · {tool}",
  computerBoundary: "Computer step · {tool}",
  computerStarted: "{name} started a computer step: {tool}.",
  stepStart: "start",
  replayComplete:
    "The operation was already completed; the external effect was not executed again.{evidence}",
  safeEvidence: " Safe evidence: {data}.",
  receiptUnknown:
    "The operation outcome is uncertain; automatic retry was blocked. Receipt: {id}.",
  receiptFailed:
    "The operation was permanently closed as failed. Receipt: {id}.",
  receiptBusy:
    "The same logical operation is being executed by another worker. Receipt: {id}.",
  effectFailure:
    "The operation could not be completed safely; no raw error or output was recorded.",
  approvedAction: "Approved action · {tool}",
  approvedScopeInvalid:
    "Error: the integrity of the approved action's scope could not be verified.",
  approvedAgentMissing:
    "Error: the agent for the approved action was not found or is inactive.",
  computerSelected: "{name} selected the next computer step: {tool}.",
  computerDeferred:
    "DEFERRED: {tool} cannot be executed safely before the result of the preceding computer step in the same model batch has been seen. Review the previous tool result; if necessary, use computer_observe to view the current state and propose this action again in the next turn.",
  approvedCompleted:
    "The approved {tool} action completed (exitCode={exitCode}).",
  approvedFailed: "The approved {tool} action failed (exitCode={exitCode}).",
  approvedUnknown:
    "The outcome of the approved action could not be verified; automatic retry was blocked. Operator review is required.",
  unknownFinalization: "Unknown error while recording the outcome",
  invocationExpired: "BLOCKED: the operation invocation lease expired.",
  runtimeUnavailable:
    "BLOCKED: the execution runtime no longer has authority for this operation.",
  agentAuthorityLost:
    "BLOCKED: the agent execution authority expired or changed.",
  taskAuthorityLost:
    "BLOCKED: the task execution authority expired or changed.",
  operationStateInvalid:
    "The operation state could not be verified. Operator review is required.",
  commandNotStarted: "(command did not start)",
  scopeActivated:
    "Scope protection is active. Allowed tools for this chat turn: {tools}.",
  taskUnknownStopped:
    "The operation outcome is unknown; the task and subsequent tool calls were stopped. Automatic replay is blocked.",
  taskDeferred:
    "Another worker is running the operation; the task was queued for a safe retry.",
} satisfies TerminalCopy;
