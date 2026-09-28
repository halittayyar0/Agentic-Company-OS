import type { ToolCopy } from "../tool-copy";

export const toolEn: ToolCopy = {
  schedulerClaimed: "Task claimed",
  projectMeetingRunning: "Preparing a project meeting reply: {title}",
  schedulerAccepted: "Task accepted; work has started.",
  schedulerRecovered: "Interrupted work was recovered and queued again.",
  schedulerRecoveryPaused:
    "Interrupted work was recovered; execution remains paused by the emergency stop.",
  schedulerRecoveryPausedNote:
    "Ownership of the interrupted work was released; execution is paused until the emergency stop is lifted.",
  schedulerRecoveryNote:
    "Ownership of the interrupted work was released; the task was queued again.",
  schedulerStepBudget: "Operator step limit reached ({used}/{limit}).",
  schedulerTokenBudget: "Token budget reached ({used}/{limit}).",
  schedulerCostBudget:
    "Provider-reported cost budget reached (${used}/{limit}).",
  schedulerBudgetStopped: "Task stopped at its safety budget: {reason}",
  pathInvalid: "Error: path must be a string.",
  pathNoncanonical:
    "Error: path cannot start or end with whitespace; filenames are not silently changed.",
  teamToolNameInvalid:
    "Error: toolName must be an exact tool identifier without surrounding whitespace.",
  directoryObserved: "Showing {shown} of {count} observed entries.",
  directoryScanLimited:
    "Directory scan reached its limit; more entries may exist.",
  directoryEntriesSkipped: "Entries that could not be inspected: {count}.",
  pathRequired: "Error: a non-empty path is required.",
  contentRequired:
    "Error: content must be a string; explicitly send an empty string for an empty file.",
  listDispatch: "Reading the file listing",
  readDispatch: "Reading the file",
  writeDispatch: "Writing the file",
  directoryEmpty: "Directory is empty: /{path}",
  directoryFile: "[FILE] {path} ({bytes} bytes)",
  directoryTotal: "({count} entries in total)",
  directoryListed: "{name} listed the directory: /{path}",
  directoryEmptyListed: "{name} listed an empty directory: /{path}",
  directoryListFailed: "{name} encountered an error listing the directory.",
  fileRead: "{name} read the file: {path}",
  fileWritten: "{name} wrote a workspace file: {path} ({bytes} bytes).",
  fileWriteComplete: "File written: {path} ({bytes} bytes).",
  fileReadFailed: "{name} encountered an error reading the file.",
  fileWriteFailed: "{name} encountered an error writing the file.",
  listFailure: "The file listing could not be read.",
  readFailure: "The file could not be read.",
  writeFailure: "The file could not be written.",
  fileTruncated: "...(truncated)",
  computerPermissionDenied:
    "Error: this agent does not have computer observation permission.",
  computerDispatch: "Reading computer state",
  computerTitle: "COMPUTER STATUS",
  workspaceTitle: "TERMINAL / WORKSPACE",
  browserTitle: "BROWSER",
  computerRecent: "RECENT COMPUTER STEPS (oldest → newest)",
  computerNext:
    "Choose one next computer action based on this actual state; inspect its result before continuing.",
  computerObserved: "{name} observed the computer state.",
  computerObservationFailed:
    "{name} encountered an error observing the computer state.",
  computerFailure: "Computer observation failed.",
  computerError: "Observation error: {message}",
  emergencyBlocked:
    "BLOCKED: emergency stop was activated or changed during execution; the tool operation was stopped.",
  operationFailure: "The tool operation could not be completed.",
  browserPermissionDenied:
    "Error: this agent does not have browser permission (canBrowse).",
  browserWorkerOnly:
    "BLOCKED: the split API runtime cannot run browser tools locally; a worker runtime must execute this operation.",
  browserUrlRequired: "Error: url must be a non-empty string.",
  browserUrlInvalid: "Error: url is invalid.",
  browserRefRequired: "Error: ref must be a positive safe integer.",
  browserInputTextInvalid:
    "Browser text must be nonempty, valid Unicode without NUL; the limit is 4096 UTF-16 code units.",
  browserTextRequired: "Error: text must be a string.",
  browserSubmitInvalid: "Error: submit must be either true or false.",
  browserDirectionRequired: "Error: direction must be either up or down.",
  browserWaitRequired: "Error: milliseconds must be a finite number.",
  browserNameInvalid: "Error: name must be a string.",
  browserSeparateSubmit:
    "BLOCKED: entering text and submitting a form must be separate approved actions. First use browser_type with submit=false; then take a new snapshot and request separate approval for the exact submit button through browser_click.",
  browserTargetChanged:
    "BLOCKED: the approved browser target has changed or is unavailable; a new snapshot and approval are required.",
  browserFieldChanged:
    "BLOCKED: the approved browser field has changed, become sensitive, or is unavailable; a new snapshot and approval are required.",
  browserSensitiveBlocked:
    "BLOCKED: the agent cannot fill in passwords, OTP, card details, or similar sensitive identity fields. The founder must fill in this field themselves through Browser Workbench.",
  browserUnknown: "Unknown error",
  browserOpenDispatch: "Opening the browser page",
  browserSnapshotDispatch: "Observing the browser page",
  browserApprovedClickDispatch: "Sending the approved click",
  browserClickDispatch: "Sending the browser click",
  browserLinkDispatch: "Opening the safe link",
  browserApprovedTypeDispatch: "Sending the approved text",
  browserTypeDispatch: "Sending the browser text",
  browserScrollDispatch: "Scrolling the browser",
  browserExtractDispatch: "Reading the browser text",
  browserWaitDispatch: "Waiting in the browser",
  browserScreenshotDispatch: "Saving browser evidence",
  browserOpened: "{name} opened a page in the browser.",
  browserOpenFailed: "{name} could not open the browser page.",
  browserObserved: "{name} observed the browser page.",
  browserObserveFailed:
    "{name} encountered an error observing the browser page.",
  browserApprovedClicked: "{name} clicked the approved page target.",
  browserClicked: "Clicked.",
  browserClickFailed: "{name} encountered an error with the browser click.",
  browserClickApproval: "{name} is waiting for approval for the browser click.",
  browserLinkOpened: "{name} opened the safe link target.",
  browserLinkFailed: "{name} encountered an error opening the safe link.",
  browserLinkFailure: "The safe link could not be opened.",
  browserApprovedTyped: "{name} entered text in the approved browser field.",
  browserTyped: "Text entered. The current page view is below.",
  browserSensitiveAvoided:
    "{name} safely backed away from the sensitive browser field.",
  browserTypeApproval:
    "{name} is waiting for approval to enter text in the browser.",
  browserTypeFailed:
    "{name} encountered an error entering text in the browser.",
  browserScrolledDown: "{name} scrolled the browser page down.",
  browserScrolledUp: "{name} scrolled the browser page up.",
  browserDown: "Scrolled down.",
  browserUp: "Scrolled up.",
  browserScrollFailed: "{name} encountered an error scrolling the browser.",
  browserExtracted: "{name} extracted the visible text from the browser.",
  browserExtractFailed: "{name} encountered an error extracting browser text.",
  browserEmptyText: "(page text is empty)",
  browserWaited: "{name} observed the dynamic browser page again.",
  browserWaitComplete: "Waited {milliseconds} ms.",
  browserWaitFailed:
    "{name} encountered an error during the browser wait step.",
  browserScreenshotSaved: "{name} saved a browser screenshot as evidence.",
  browserScreenshotFailed: "{name} could not save the browser evidence image.",
  browserPngSaved: "PNG evidence saved: {path}",
  browserSize: "Size: {bytes} bytes",
  browserError: "Browser error: {message}",
  browserSnapshotError: "Page observation error: {message}",
  browserClickError: "Click error: {message}",
  browserTypeError: "Text entry error: {message}",
  browserScrollError: "Scroll error: {message}",
  browserExtractError: "Text extraction error: {message}",
  browserWaitError: "Wait error: {message}",
  browserScreenshotError: "Screenshot error: {message}",
  browserPage: "PAGE: {title} · {url}",
  browserUntitled: "(untitled)",
  browserReferences: "INTERACTIVE ELEMENT REFERENCES:",
  browserValue: "{text} (value: {value})",
  browserVisibleText: "VISIBLE TEXT (first section):",
  browserActionUnknown:
    "The browser action was dispatched, but its outcome could not be verified. Automatic retry was blocked.",
  browserLaunchFailed:
    "The browser could not be launched ({channel}): {message}",
  browserLaunchUnavailable: "The browser could not be launched ({channel}).",
  browserDisconnected:
    "The browser session disconnected during an active action; the action will not be retried automatically in a new session.",
  browserSessionLimit:
    "The browser session limit has been reached ({limit}). Idle sessions close automatically.",
  browserSessionMissing: "The browser session is unavailable.",
  browserAffinityFailure:
    "The browser session could not be securely bound to the executor; the session was closed.",
  browserSessionChanged:
    "The browser session closed or changed; the command was not applied.",
  browserApprovedSessionChanged:
    "The approved browser session closed or changed; new approval is required.",
  browserRefMissing: "ref={ref} was not found. Take a browser_snapshot first.",
  browserRefDetached: "ref={ref} is no longer visible on the page.",
  browserRefStale: "ref={ref} belongs to an old snapshot. Take a new snapshot.",
  browserApprovedElementChanged:
    "The page or target element changed after approval; new approval is required.",
  browserApprovedFieldChanged:
    "The page or target field changed after approval; new approval is required.",
  browserOperatorLeaseRequired:
    "An active leaseId is required for an operator action.",
  browserClosing:
    "The browser session is closing; no new action can be started.",
  browserRuntimeClosing:
    "The browser executor is already shutting down or pausing.",
  browserQueueFull:
    "The browser input queue is full ({limit}); the client must slow down.",
  browserOperatorOwns:
    "The operator has taken over this browser; agent actions are unavailable until {expiresAt}.",
  browserAgentBusy:
    "An agent browser action is in progress; wait for it to finish, then try taking over again.",
  browserOtherOperator:
    "The browser is under another operator's execution authority.",
  browserLeaseInvalid: "Browser control authority is invalid or has expired.",
  browserReleaseOwnerOnly:
    "Only the owner of the active control authority can return the browser to the agent.",
  browserOperatorBusy:
    "An operator browser action is in progress; control cannot be released yet.",
  browserActionInFlight:
    "The session cannot be closed while a browser action is in progress; wait for the action to finish.",
  browserCloseOwnerOnly:
    "A browser under operator control can only be closed with the exact active leaseId.",
  browserTargetInvalid: "Invalid browser target.",
  browserPrivateTarget:
    "Private or local network targets were blocked by the browser security policy.",
  browserPrivateIp: "Private or local IP targets were blocked.",
  browserUnsafeResolution:
    "A safe and usable IP address could not be verified for the target domain.",
  browserUnresolved: "The target domain could not be resolved.",
  browserProtocolDenied: "Only http and https addresses are allowed.",
  browserCredentialsDenied:
    "Usernames or passwords cannot be included in the URL.",
  teamStringRequired: "Error: {field} must be a non-empty string.",
  teamStringInvalid: "Error: {field} must be a string.",
  teamNumberInvalid: "Error: {field} must be a valid number.",
  teamChoiceInvalid: "Error: {field} must be one of: {choices}.",
  teamBriefTooLong: "Error: brief may contain at most 8000 characters.",
  teamCadenceInvalid:
    "Error: autonomyMode must be finite/continuous; cadenceSeconds is allowed only for continuous, between 60 and 604800.",
  teamCreateDenied: "Error: this agent cannot create sub-agents.",
  teamDelegateDenied: "Error: this agent cannot delegate tasks.",
  teamAgentCapacity: "BLOCKED: active agent capacity is full (limit={limit}).",
  teamTaskCapacity:
    "BLOCKED: outstanding task capacity is full (limit={limit}).",
  teamCreateStopped: "BLOCKED: the task stopped; no sub-agent was created.",
  teamAgentCreated: "New sub-agent created. agentId={id}",
  teamAgentActivity: '{name} created a new sub-agent, "{child}" ({role}).',
  teamDelegateStopped:
    "BLOCKED: the target agent is inactive/ineligible or the source task stopped; no delegation was created.",
  teamDelegated: "Task created and delegated. taskId={id}",
  teamTaskCreatedActivity: 'New task created: "{title}"',
  teamDelegatedActivity: '{name} delegated "{title}" to {target} ({role}).',
  teamTaskContext: "Error: there is no active task context.",
  teamProgressDefault: "Progress updated.",
  teamProgressStopped: "BLOCKED: the task stopped; progress was not saved.",
  teamProgressSaved: "Progress saved: {progress}%.",
  teamTaskLost: "BLOCKED: the task stopped or execution ownership was lost.",
  teamChildUnresolved:
    "BLOCKED: child task taskId={id} is still {status}; resolve its outcome or cancel it first.",
  teamCompletionRejected:
    "Review rejected this completion: {reason} Align the task with the original instruction before trying again.",
  teamCyclePrepared:
    "This work cycle was prepared for atomic finalization at {at}.",
  teamCompletionPrepared: "Task completion prepared for atomic finalization.",
  teamCycleActivity:
    "This continuous work cycle completed; the next run was scheduled: {summary}",
  teamCompletionWarnActivity:
    "Task completed (with a review warning): {summary}",
  teamCompletionActivity: "Task completed: {summary}",
  teamChildCompletedActivity:
    '{name} completed the child task: "{title}" -- {summary}',
  teamCompletionStopped: "BLOCKED: the task stopped; completion was not saved.",
  teamCycleComplete:
    "This work cycle completed; the task will run again at {at}.",
  teamComplete: "Task marked as successfully completed.",
  teamApprovalUnsupported:
    "BLOCKED: {tool} cannot execute atomically after approval; an approval naming a tool must contain an executable action.",
  teamApprovalScopeRequired:
    "BLOCKED: a tool-scoped approval requires both toolName and toolArgs.",
  teamApprovalArgsInvalid: "Error: toolArgs must be a JSON object.",
  teamSudoDenied:
    "BLOCKED: sudo approval requires the active, authorized root CEO and an enabled runtime gate.",
  teamSudoInvalid: "BLOCKED: invalid sudo approval ({reason})",
  teamSudoTitle: "CRITICAL: CEO Host Shell command",
  teamSudoDescription:
    "This approval runs the exact command once on the specified host and starting directory with the API service account’s existing operating-system permissions; it does not grant root/Administrator elevation. Scripts or programs invoked by the command may change after approval; child processes may outlive the shell timeout.",
  teamCategoryRequired:
    "BLOCKED: {tool} requires category={category}; a lower category cannot authorize this action.",
  teamCategoryDenied:
    "BLOCKED: this agent cannot propose actions in category={category}.",
  teamBrowserApprovalContext:
    "BLOCKED: browser approval requires an active worker, current snapshot and numeric ref.",
  teamBrowserApprovalMissing:
    "BLOCKED: the browser target was not found in the current session; take a fresh snapshot and propose again.",
  teamBrowserApprovalSensitive:
    "BLOCKED: sensitive browser fields cannot be filled through agent approval.",
  teamSpendAmount:
    "BLOCKED: spending approval requires a positive finite amountUsd.",
  teamApprovalStopped:
    "BLOCKED: the task stopped; no approval request was created.",
  teamAmount: "Amount: ${amount}",
  teamApprovalRejected:
    "Review rejected this approval request: {reason} Do not start this action.",
  teamSudoRevoked:
    "BLOCKED: sudo permission was revoked before the approval record was created.",
  teamSudoTargetChanged:
    "BLOCKED: the sudo host or workspace changed before approval was created.",
  teamApprovalPrepared: "Approval request prepared for atomic finalization.",
  teamApprovalActivity: "Approval request: {title}",
  teamApprovalCapacity:
    "BLOCKED: approval/task capacity is full (limit={limit}).",
  teamApprovalCreated:
    "Approval request created (approvalId={id}, taskId={taskId}); waiting for the user’s approval.",
  teamApprovalExpiry: " Approval is valid for {minutes} minutes and one use.",
  teamReviewNote: " (Review note: {reason})",
  teamQuestionBound:
    "Error: question must contain visible text and fit within 1000 characters. Ask one complete, concise question.",
  teamQuestionPrepared: "Question prepared for atomic finalization.",
  teamInputWaiting: "Waiting for user input.",
  teamQuestionActivity: "Question: {question}",
  teamQuestionStopped: "BLOCKED: the task stopped; the question was not saved.",
  teamQuestionSaved: "Question saved; waiting for the user’s answer.",
  teamNoteSaved: "Note saved.",
  teamMessageBound:
    "Error: a company message may contain at most 4000 characters.",
  teamChannelName: "Company room",
  teamChannelMissing: "Company channel not found.",
  teamMembershipMissing:
    "The agent is not a Company Room member or is inactive.",
  teamReplyMissing: "The company message being replied to was not found.",
  teamMessageCooldown:
    "Company messages from the same agent must be at least 5 seconds apart.",
  teamMessageCapacity:
    "BLOCKED: company message capacity is full (limit={limit}).",
  teamBlocked: "BLOCKED: {reason}",
  teamMessageFailed: "BLOCKED: the company message could not be saved.",
  teamMessageSaved:
    "Company message saved with your actual sender identity (messageId={id}).",
  previewInstance: "API process instance: {id}",
  previewHost: "Host: {host}",
  previewDirectory: "Starting directory: {path}",
  previewCommand: "Exact command (executed literally):",
  previewWarning:
    "Warning: scripts or programs invoked by the command may change after approval; child processes may outlive the shell timeout.",
  previewPage: "Page: {url}",
  previewUnknown: "(unknown)",
  previewField: "Field: {role} · {text}",
  previewFieldDefault: "field",
  previewUnlabeled: "(unlabeled)",
  previewContext: "Context: {text}",
  previewText: "Text to enter: {text}",
  previewSubmit: "Submit with Enter: {value}",
  previewYes: "yes",
  previewNo: "no",
  previewElement: "Element: {role} · {text}",
  previewElementDefault: "element",
  previewLink: "Link: {url}",
  previewForm: "Form target: {url}",
  judgeMissingReason: "The review returned no reasoning.",
  judgeSudoReason:
    "The sudo proposal was classified as {verdict}; the exact command is shown only in the local human approval.",
  judgeReview: "Review ({purpose}): {verdict}",
  judgeCompletion: "completion",
  judgeApproval: "approval request",
  judgeRedacted:
    "[REDACTED: exact sudo command retained only in pending approval]",
  judgeCompletionUnavailable:
    "Completion was safely blocked because the review could not be verified.",
  judgeApprovalUnavailable:
    "The review service was unavailable; this request can proceed only with human approval.",
  judgeUnavailable: "Review unavailable: {verdict}",
  teamAgentReplayed:
    "Sub-agent was already created; it was not created again. agentId={id}",
  teamTaskReplayed:
    "Delegation was already recorded; it was not created again. taskId={id}",
  teamApprovalReplayed:
    "Approval request was already recorded atomically; it was not created again. approvalId={id}",
  teamOperationReplayed:
    "Operation was already recorded atomically; it was not applied again.{evidence}",
  teamEvidence: " Evidence: {data}.",
  readReplayed:
    "The read already completed; raw content was not saved in the receipt. Request a new read for current data.",
  readReconciled:
    "The operator reconciled this read as applied; it was not repeated automatically and raw content was not stored.",
  readRetry: "The read could not complete; it was released for a safe retry.",
  teamCreateDispatch: "Creating sub-agent",
  teamDelegateDispatch: "Delegating task",
  teamProgressDispatch: "Saving progress",
  teamCompleteDispatch: "Reviewing task result",
  teamApprovalDispatch: "Requesting operator approval",
  teamQuestionDispatch: "Requesting user input",
  teamNoteDispatch: "Saving evidence note",
  teamMessageDispatch: "Posting to the shared channel",
  toolDispatch: "Running tool · {tool}",
  chatAnalyzing: "Analyzing message",
  chatPlanning: "Preparing reply · round {round}/{total}",
  taskAnalyzing: "Analyzing task",
  taskPlanning: "Planning · round {round}/{total}",
  taskModelRunning: "Running model · {model}",
  taskOwnerMissing:
    "The task owner is missing or inactive; the task was marked failed.",
  taskLeaseMismatch: "Task and agent lease owners did not match.",
  modelFallback:
    "The primary model could not advance this step; the task is continuing with the permitted fallback model {model}.",
  modelRouteFailed:
    "The model was unavailable; the task is trying the next permitted model {model}.",
  taskUnknownError: "Unknown task-step error.",
  taskBlocked:
    "The task stopped after {count} consecutive runtime failures; operator review is required.",
  taskProviderRetry:
    "Attempts with all permitted models failed; the task was preserved and queued again for {at}.",
  taskRuntimeRetry:
    "A runtime error occurred in this step; the task was queued again for {at}.",
  receiptLabel: "Receipt: {id}",
  toolUnknown: "Error: unknown tool '{tool}'.",
  approvedToolCompleted: "Approved action completed: {tool}.",
  approvedToolFailed: "Approved action failed: {tool}.",
  exclusiveTurnInstruction:
    "The user explicitly restricted this turn to these tools: {tools}. Do not go beyond this scope even if it seems useful for the permitted result; do not create notes, files, tasks or sub-agents outside this scope. If the permitted tools are insufficient, report that without expanding the scope.",
  exclusiveSudoExactInstruction:
    "Sudo approval may only be requested for the exact command supplied by the user.",
  exclusiveSudoUnavailableInstruction:
    "The exact sudo command could not be safely determined. Do not use a sudo tool in this turn; report the obstacle without expanding the scope.",
  operationReconciled: "The operator reconciled the uncertain operation.",
  approvalBindingInvalidated:
    "The approved browser binding is no longer valid; new approval is required.",
  judgeRunning: "Reviewing task",
  taskAdvanceInstruction:
    "Advance the task by one step. Assess the current state and make appropriate tool calls.",
  taskOpenInstruction:
    "The task is still open. Do not stop after an explanation: call the next safe concrete tool, use request_user_input if human input is required, or call complete_task when evidence satisfies the acceptance criteria.",
  taskPassiveFallbackInstruction:
    "The previous model stopped twice without using a task lifecycle tool. Keep the same context and continue with a concrete tool step.",
  taskBatchFallbackInstruction:
    "The previous model exceeded the safe tool batch limit ({count}/{limit}). Keep the same task, stay below this per-round limit and continue with the safest concrete step.",
  taskLifecycleFallbackInstruction:
    "The previous model twice called a task lifecycle tool with invalid or rejected arguments. Keep the same context, verify the result and call the lifecycle tool with valid arguments.",
  taskToolRetryInstruction:
    "All tool calls in this round were rejected as invalid, unauthorized or not executed. Correct the tool schema and permissions, then make one more concrete, valid tool call.",
  taskToolFallbackInstruction:
    "The previous model failed to use the tool protocol twice. Keep the same context and continue with one concrete step that exactly matches an allowed tool schema.",
  operationCompleted: "Operation completed: {tool}.",
  modelFailure: "{reason} ({source})",
  failureRateLimit: "The model request limit was reached.",
  failureTimeout: "The model request timed out.",
  failureAuthentication: "The model provider rejected authentication.",
  failurePayment: "The model provider requires payment or available credit.",
  failureModelUnavailable: "The requested model is unavailable.",
  failureToolCompatibility:
    "The model did not produce a usable response with the required tool protocol.",
  failureProviderUnavailable: "The model provider is unavailable.",
};
