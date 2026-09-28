# Activity and delegation records

The Project Studio **Plan and trace** view combines current task facts with one selected page of activity. Its cards indicate the presence of records, not that stages passed. A selected tool records intent; it is not proof that the tool ran. A completed task without a stored result summary is labeled accordingly.

## Sources and boundaries

API cursor pages follow record ID order, independently of event timestamps. The global activity endpoint returns each page newest ID first; task activity retains its oldest-to-newest order within each page. Follow `X-Next-Before-Id` for older records. Newly inserted higher IDs appear when returning to the latest page, and timestamps are never rewritten to fit pagination. Presentation may order the already-loaded window by event time, which is separate from server page membership.

- Each trace page is restricted to the selected task, sorted for display by timestamp and ID, and bounded to 200 supplied records. **Older records**, **Newer records** and **Latest records** navigate the server cursor pages. Counts, filters and JSON export apply to the selected page.
- A continuation is available only when the API supplies a valid `X-Next-Before-Id` header. A full-looking page does not imply another page exists. Malformed, duplicate, oversized, out-of-range or foreign-scope responses are rejected before replacing visible records.
- The browser retains one data page and a stack of cursor IDs. It pauses automatic refresh on older pages. Returning to the latest page reloads current records. These are fresh reads, not an immutable historical snapshot of the database.
- Task facts and activity records have separate source labels. The task's update time does not establish when ownership changed or when a result was first written.
- Step and cycle values are counters. Neither is an execution-attempt identity. The displayed model comes only from `lastModelId`; a configured model is not substituted for an observed model.
- Absolute dates use the selected language, retain ISO `datetime` values, and explicitly display `Europe/Istanbul`.
- Failed reads retain the last loaded page, capture time and cursor trail. Retry repeats the failed target, including after hiding and returning to the browser tab. An initial fetch failure is shown as unknown, not as an empty history. Changing project, expert or selected task cancels the old read; a late old reply cannot populate the new selection.
- For root projects, the operation-receipts link opens the existing Operations route. Actual attempts, invocations, receipts and reconciliation remain there. This activity view does not replace that ledger or claim complete execution evidence.

## Delegations

The Team view pages through direct child tasks, up to 200 per page. Its delegation selector includes assigned tasks from that page and the current task itself if assigned. The selected task's activity has independent page controls. Its latest activity page refreshes every five seconds while visible; older pages pause. This avoids polling hundreds of task histories at once. The general project overview and team roster still use their current bounded data, independently of the selected history page.

Stored briefs, results, errors and summaries retain their original text. The display uses record cards rather than simulated agent dialogue. A stored association with an agent does not establish authorship. Missing roster information falls back to the recorded agent ID; a roster failure must not hide task records. Historical activity associations are retained when the current owner changes.

Current blocked, failed or cancelled task state uses the task snapshot's update time. It is not inserted at the task's creation time as an invented historical event. The activity source and current task state can both remain visible.

## Projects and Computer

The Projects directory uses the same controls with 200 root projects per page. Search, status filters and counters describe the loaded page. Its first-project message is limited to an empty latest page.

Computer activity uses 20 records per page, scoped to the expert and optionally the project. Reading older activity preserves Terminal drafts. Historical records never drive the opt-in live-follow behavior. Existing operator action identities, permissions and approval/recovery flows are unchanged by these read-only controls. Expert statistics remain explicitly bounded samples; paging does not turn those counters into lifetime totals.

## JSON export

Downloads use `agentic-company-os/activity-window@2` and the filename `task-{id}-activity.json`. The boundary includes task ID, capture/export time, loaded first/last event times, limit, refresh failure, `fullHistory: false` and `receipts: false`. Additive page fields are `beforeId`, `nextBeforeId`, `pageNumber`, `paginationOrder`, `displayOrder` and `exportOrder`. Export preserves the selected page's original summaries and the existing metadata allowlist. Current task facts remain a separate task snapshot; they do not describe the task as it was at the time of an old activity.

This replaces the former local `run-trace@1` download schema. No server API or database migration is changed by the export revision.

Structured detail is restricted to an explicit allowlist. Raw commands, tool arguments, prompts, answers, headers and unknown nested objects are excluded. URL credentials, query parameters and fragments are removed. Overlong or malformed identifiers are omitted rather than silently shortened. Sanitized URLs are retained whole up to 2,048 characters; longer locations are omitted. Original summaries and retained URL paths can still contain private information; the interface asks the operator to review the file before sharing.

## Languages and interaction

Controls, field labels, source labels, empty/error/loading states and recovery are provided in Turkish, English, German, Russian, Simplified Chinese, Traditional Chinese and Arabic. Only the selected language pack loads. Machine identifiers and source content remain unchanged.

The page owns vertical scrolling; record details expand inline. Filters wrap, buttons have at least 44 px touch targets, focus is visible, and mixed-direction IDs are isolated. Phone viewport fixtures cover all seven languages and both themes. These checks do not establish physical-phone, Safari, screen-reader, native IME or native-speaker acceptance.

## Remaining release work

Project meeting, Operations and [durable Browser/Terminal recovery](./verification/2026-09-27-operator-recovery.md) have subsequent verification checkpoints in the [current release audit](./verification/2026-09-27-release-readiness.md). The [history and route audit](./verification/2026-09-28-history-and-route-audit.md) tracks the new navigation and its verification; it does not establish complete route acceptance or native deployment. The earlier operator source audit is historical. See the [activity verification checkpoint](./verification/2026-09-27-activity-records.md) for this surface's original evidence and the [phone access guide](./mobile-access.md) for deployment limits.
