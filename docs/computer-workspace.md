# Computer workspace and command recovery

The Computer frame and Terminal use the same selected-language pack for Turkish, English, German, Russian, Simplified Chinese, Traditional Chinese and Arabic. Their semantic colors follow the selected theme. Native controls, visible focus, manual keyboard tab activation and 44px command controls follow the shared [design](../DESIGN.md) and [interaction](../UX-CONTRACT.md) contracts. File Explorer and the Browser workbench each use their own seven-language pack and follow those contracts. Original remote pages, commands and outputs remain source content.

## Scope and evidence

The browser, terminal and files belong to an expert's shared workspace, including when opened from a project. Operator commands entered here are not automatically steps of that project. The frame shows the latest 20 activity records for that expert, or the latest 20 matching the displayed project when a project filter is present. Operator commands currently record activity without a project ID, so that filtered view is not their execution history.

Activity refreshes periodically. It is not described as a live execution trace. Original summaries, identifiers, commands, outputs and metadata remain source content. The frame does not infer current execution success from an old record's severity or generic expert status. A failed refresh preserves the previously loaded records with a stale-data message. Dates include a machine-readable timestamp and the display timezone.

Following new agent events is opt-in. Turning it on does not jump to a historical event. New recorded agent events can switch tools only while this workspace is visible and the operator is not typing or using a dialog. Selecting a tool manually disables following. The initial browser permission still controls whether the browser can open.

## Commands and drafts

The command console runs one command per request. Workspace path checks are not operating-system isolation. Host mode is an explicit radio choice and uses the API service account's OS permissions; the backend must enable it separately. Host mode is not restored automatically after reload. Workspace and host drafts are separate. A failed working-directory refresh, missing terminal permission or unverified safety state blocks dispatch.

Enter inserts a newline. Ctrl/Command+Enter and the named Run button submit through the shared validated form; IME composition never submits. The 32,768-character limit rejects oversized commands without shortening the draft. Preset buttons only prepare a draft. A confirmed response clears the submitted draft only if it has not been edited while waiting.

Before sending, the tab stores the exact expert, UUID, authority mode, command, start time and `protocolVersion: 1` under `acos.terminal.v1:<agentId>` in `sessionStorage`, then verifies readback. Failed or silently dropped storage blocks dispatch. The same UUID reaches server admission and is permanently bound to the validated request. Older records without a protocol version remain local-only; they are never silently converted into server identities.

Drafts and the latest validated response survive page reloads and route changes within the tab. They are not shared between devices; closing the tab may remove them. Commands and output may contain sensitive material, so this local data should be treated with the same care as the open terminal. At most six recent responses are shown in one mounted view; only the latest response is saved for reload recovery. Clearing visible output removes that saved response without deleting server activity or files. A newer unsent draft remains intact.

## Unconfirmed requests

An interrupted request, malformed reply, or pending record found after reload is unconfirmed. The command may have run. The console never automatically retries POST. Its 95-second client wait limit does not cancel a server command. The explicit **Check server record** action reads exactly this request from the authenticated API without resending it. Validated saved output is restored when available. A completed request whose encrypted output is unavailable remains completed; a missing record is inconclusive. Otherwise, inspect current files and activity before using the cancel-first review dialog. Clearing only removes the local warning; it neither cancels nor repeats execution or changes a server receipt.

A late reply merges with the newest stored drafts only if the complete original identity, command, mode, start time and protocol version are still current. It cannot replace a later command's recovery identity. Validated responses preserve original output and show exit code and duration; they do not establish completion of a project. Clipboard failure has visible feedback and leaves selectable output.

## Remaining work

The [file editor](./workspace-files.md) now retains multiple drafts across profile tabs, routes and reloads within one browser tab, with explicit recovery for uncertain writes. Directory deletion requires complete-scope review and its own local recovery. The [browser workbench](./browser-workbench.md) now has seven-language controls, semantic themes, native phone text input, image magnification and conservative local recovery. Operator browser and Terminal recovery now uses [durable receipts](./operator-recovery.md); final integrated release gates are recorded separately. Project-scoped chat and Operations remain separate work. A native speaker, physical phone, Safari and assistive technology have not yet reviewed these additions. Private HTTPS access remains described in the [phone guide](./mobile-access.md).
