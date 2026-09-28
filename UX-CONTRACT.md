# Agentic Company OS — UX Contract

- **Status:** Binding for new and touched UI
- **Locale:** `tr`, `en`, `de`, `ru`, `zh-CN`, `zh-TW`, `ar` for shared shell and first-run flows; deeper screens are still being localized
- **Default color mode:** system preference
- **Product profile:** multi-agent product/admin operations

## Canonical UI Map

| Capability             | Canonical owner                                                                   | Source of truth                                                                                     | Allowed variants                                                                              | Verification                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Button                 | Shared `Button` with `intent × emphasis`; legacy `variant` adapter                | `src/components/ui/button.tsx`                                                                      | intents neutral/brand/verified/attention/danger; emphasis solid/soft/outline/ghost/link; busy | Pure variant tests, keyboard, disabled/busy, contrast, UI smoke                          |
| IconButton             | Shared `IconButton` composed from `Button` + Tooltip                              | `src/components/ui/icon-button.tsx`                                                                 | default, ghost, destructive; sm/default                                                       | Accessible-name and tooltip tests; busy/disabled; 44px touch target where primary        |
| Tabs                   | Radix `Tabs` plus `ProjectWorkbenchTabs` adapter                                  | `src/components/ui/tabs.tsx`, `src/components/studio/project-workbench-tabs.tsx`                    | fitted, scrollable; URL-backed controlled value                                               | Arrow/Home/End, focus, deep-link/reload/back-forward, 320px overflow                     |
| Dialog                 | Radix shared dialog                                                               | `src/components/ui/dialog.tsx`                                                                      | default modal, wide modal                                                                     | Focus trap/restore, Escape, Localized close label, viewport collision                    |
| Confirmation           | Radix shared alert dialog                                                         | `src/components/ui/alert-dialog.tsx`                                                                | standard risk, destructive risk, reconciliation                                               | Pessimistic submit, duplicate block, failure preserves input/focus                       |
| Inspector              | Desktop persistent panel; mobile Radix Sheet                                      | `src/components/tasks/run-inspector.tsx`, `src/components/ui/sheet.tsx`                             | attempt, receipt, incident                                                                    | Keyboard selection, Escape/restore on mobile, scoped data, 320px                         |
| Toast                  | Radix shared toast + `useToast`                                                   | `src/components/ui/toast.tsx`, `src/hooks/use-toast.ts`                                             | default, verified, attention, destructive                                                     | Mutation-only use, Localized close label, live-region, timeout/pause                     |
| Form                   | `ValidatedForm` over React Hook Form + Zod and shared field semantics             | `src/components/ui/validated-form.tsx`, `src/components/ui/form.tsx`, `src/components/ui/field.tsx` | create/edit, guarded confirmation                                                             | `noValidate`, inline association, first-error focus, value preservation, duplicate block |
| Textarea               | Shared fixed-size or auto-growing `Textarea`                                      | `src/components/ui/textarea.tsx`                                                                    | fixed default, autoGrow, expanded                                                             | Label/error association, bounded growth, 320px                                           |
| Select/Listbox         | Radix shared Select; maintained Combobox only for searchable multi-select         | `src/components/ui/select.tsx`, future `src/components/ui/combobox.tsx`                             | single select, searchable multi-select                                                        | Keyboard/typeahead, labels, disabled, collision, no native drift in touched screens      |
| Table Selection        | No Operations owner until a bulk-selection workflow exists                        | Omitted from Operations scope; shared Table/Checkbox are visual primitives only                     | none                                                                                          | New workflow establishes state/scope ownership before implementation                     |
| Date                   | Native date/time input for legacy edit forms; Operations timestamps are read-only | Owning form Zod/date-fns adapter; no Operations picker                                              | date, local datetime                                                                          | Supported browser popup acceptance, locale parsing, explicit timezone                    |
| Scrollbar              | Global CSS utility contract                                                       | `src/index.css`                                                                                     | route vertical, slim evidence, visible horizontal                                             | Chromium + standards CSS, forced colors, hover/active, keyboard reach, stable gutter     |
| Loading/Empty/Error    | Shared `OperationsStatePanel` and geometry-matched Skeleton                       | `src/components/operations/operations-state-panel.tsx`, `src/components/ui/skeleton.tsx`            | loading, empty, no-results, partial, unauthorized, stale, disconnected                        | State-matrix unit/UI tests; last-good age; retry focus                                   |
| Live transport         | Pure stream state machine + React Query bridge                                    | `src/lib/operations-event-stream.ts`, `src/hooks/use-operations-stream.ts`                          | disabled, connecting, live, stale, disconnected                                               | Injectable EventSource tests, numeric sequence, reconnect/cleanup, last-good snapshot    |
| Timeline/Run inspector | Existing run-trace model extended with durable projection                         | `src/lib/run-trace.ts`, `src/components/tasks/run-inspector.tsx`                                    | project/task/attempt scoped; bounded older-window affordance                                  | Attempt -> invocation/receipt evidence, timezone, truncation, no false-live copy         |
| Reconciliation         | Operator-only guarded confirmation flow                                           | `src/components/operations/receipt-reconciliation-dialog.tsx`                                       | confirmed applied, confirmed not applied                                                      | Required note, pessimistic mutation, failure preservation, no replay                     |
| Navigation             | AppShell + Wouter routes + command palette                                        | `src/components/layout/app-shell.tsx`, `src/App.tsx`, `src/components/command-palette.tsx`          | desktop sidebar, mobile drawer, project tab deep links                                        | Current-page semantics, landmarks, drawer focus/Escape/restore, route reload             |
| CRUD                   | Generated API hooks plus query invalidation and guarded forms                     | `@workspace/api-client-react`, owning route/form components                                         | create, read, update, archive/delete where authorized                                         | Full create/read/update flow, failure preservation, duplicate-submit, authorization      |

Paths in this map are relative to `artifacts/agentic-company-os`. A future owner is a blocking implementation obligation, not permission for screen-local duplication.

## Navigation and project scope

- Project routes are canonical at `/projects/:projectId`.
- The workbench view is URL-backed: `?view=workspace|plan|operations|meetings|team|evidence`.
- Browser reload, copied links, Back, and Forward must restore the same valid view. Unknown values fall back to `workspace` without breaking the route.
- Operations is project-scoped in the workbench. The global `/operations` route is the cross-project operator view. `/activity` remains a compatibility redirect until links, command palette, tests, and documentation migrate together.
- Meetings, attempts, receipts, incidents, and conversations never silently cross project boundaries.
- Every route has one page-level `h1` and named `main`/navigation landmarks. Navigation exposes current-page state.
- Document titles use `{Sayfa} — Agentic Company OS`. Loading, unauthorized, and route-error states retain a stable route title rather than leaking a previous page title.
- `/activity` redirects to canonical `/operations` while preserving query state. Redirect completion moves focus to the Operations `h1` only when navigation was programmatic, never during ordinary in-page refresh.

## Scroll ownership

- AppShell owns route scrolling by default.
- A project workbench tab may opt into a single contained vertical scroller only when AppShell relinquishes it for that route. Two nested vertical owners are not allowed.
- Workstream and timeline lanes may scroll horizontally. The scrollbar stays visible, supports wheel/trackpad/keyboard, and has a stable gutter.
- Opening a dialog or mobile Sheet locks only the background owner; closing restores the invoking control and prior scroll position.

## Data entry and mutation

### Guided start and expert membership (2026-09-04)

- Home examples fill an editable brief; choosing an example never sends a
  request. Enter adds a newline. Ctrl/Meta+Enter or the named primary button
  submits after validation; composition events never submit.
- `ValidatedForm` supplies the RHF submit boundary and `noValidate`. Each
  workflow owns its Zod schema. Project and expert creation show inline errors,
  retain input on request failure, and block another submit while pending.
- Project creation opens the created project's workspace. Expert creation
  returns to `/agents` with a shared success toast. Advanced role settings
  retain the server's authority and permission checks.
- The expert directory uses the complete active roster returned by the current
  API, with 12 cards per page. Local search, department, status and page live in
  URL parameters; filtering resets the page and rendering clamps stale pages.
  Search is immediate and clear restores input focus. No network debounce is
  needed for this local dataset.
- Four stock specialist templates are available: design, quality, data and
  automation. Fresh organization seeding includes them once. Existing rosters
  are preserved; an operator can add any new role from the creation catalog.
  Source: `artifacts/api-server/src/lib/seed.ts`, `agent-templates.ts`,
  `orchestrator/permission-presets.ts` and `routes/agents.ts`.

Every touched form uses React Hook Form + Zod, `noValidate`, explicit labels, `aria-describedby`, and inline errors. On invalid submit, focus moves to the first invalid field. On server/network failure, values and selection remain. On success, reset is intentional and tested.

Mutations are pessimistic when they change runtime control, approvals, reconciliation, membership, or side-effect state. The initiating control remains busy with `aria-busy`; duplicate submission is blocked. A toast may summarize a completed user mutation, but durable runtime truth remains inline.

## Async and resilience states

### Project meeting forms (2026-09-27)

- Creation, transcript turns, decisions, actions and closing summaries use the shared validated form boundary, localized field errors and first-error focus. Radix owner selects keep numeric IDs through blur; an unavailable saved owner must be explicitly replaced or removed.
- Ordinary drafts persist per project and meeting in tab-local session storage. View changes and reloads preserve text, owner and participant selections. Only the acknowledged matching draft is cleared. This is not cross-device backup.
- Storage failure preserves editable in-memory input and blocks sending. Malformed stored drafts are not overwritten without explicit review. The review defaults to keeping drafts and restores focus; clearing ordinary drafts preserves pending turn identities and server records.
- Background read failures retain last-good lists, records and drafts, display an explicit load timestamp, and pause writes until a read succeeds. Retry is read-only.
- Seven selected-language packs cover controls, status and recovery. Arabic uses logical layout and RTL; source text remains original. Dates name the source timezone. Phone actions are at least 44 px high, and meeting lists/records follow the route's vertical scroller.
- Client duplicate blocking is not a durable server receipt. Start commands have durable identities; the remaining meeting mutations still require the recovery work described in `docs/meeting-turns.md`.

Initial loading, refreshing with last-good data, empty, filtered-empty, partial unavailable, unauthorized, stale, disconnected, and fatal route failure are distinct states.

- Initial loading may use a geometry-matched skeleton.
- Refresh keeps the last successful snapshot visible.
- Partial failure identifies which evidence is unavailable; it does not blank healthy sections.
- Stale/disconnected preserves last-good data and displays its age and effective timezone.
- Unauthorized removes restricted controls and provides a stable explanation; it is not rendered as generic empty.
- Retry returns focus to a useful location and never duplicates a mutation.

## Operations truth model

Transport and backend truth are independent:

| Transport    | Meaning                                                                   | UI rule                                                |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| disabled     | Streaming intentionally unavailable                                       | No “canlı” claim; show polling/manual refresh mode     |
| connecting   | Stream not yet established                                                | Preserve snapshot; bounded connecting label            |
| live         | Stream open, a visible frame is fresh, and backend runtime truth is valid | May label “Canlı”; show last durable change separately |
| stale        | Open/reconnecting transport but freshness threshold exceeded              | Preserve data, show age and degraded state             |
| disconnected | Stream failed beyond reconnect policy                                     | Preserve data, show explicit retry/reconnect action    |

The server emits a visible `event: heartbeat` frame without an `id`; an SSE comment is insufficient because browser JavaScript cannot observe it. The client tracks `transportLastFrameAt` separately from durable `lastEventAt`/`lastEventId`. A heartbeat keeps an otherwise idle connection transport-live but never advances the cursor, invalidates data, or claims useful work occurred.

SSE event IDs are canonical base-10 decimal activity sequences. They remain strings for transport/storage and are compared with `BigInt` (for example, `"9007199254740993"` follows `"9007199254740992"`); lexical and JavaScript `Number` comparison are forbidden. Heartbeats are processed before durable-ID filtering. Duplicate/older durable events are ignored. A normal EventSource automatic reconnect is not replaced on every transient `error`. Cleanup owns listeners and timers exactly once.

Stream scope is explicit: `{ scope: "project", taskId }` receives only that project's frames and `{ scope: "global" }` receives authorized fleet frames. If the backend does not expose the global scope, the command center is labelled polling/manual refresh and never “Canlı.”

Backend agent `status` is not operational presence. The project Operations view derives and labels seven mutually exclusive states from lease/attempt/runtime truth: `working`, `waiting_approval`, `recovering`, `blocked`, `idle`, `offline`, `unknown`.

A failed snapshot refresh keeps the last good data and its timestamp, and replaces any live snapshot label with a stale warning. Fleet instance refresh failure follows the same rule; no known instances is distinct from an unavailable initial list. Complete minute coverage describes recorded samples only. Global health samples are labeled as fleet evidence even inside a project, and never certify a real 24-hour endurance run.

## Attempt, receipt, and evidence inspection

- Attempt IDs are UUID strings, never numeric UI IDs.
- Selecting a workstream/timeline item scopes the inspector to an exact attempt projection.
- The inspector links logical execution, physical invocation, operation receipt, approval, tool evidence, usage, incident, and recovery when available.
- An unrelated ActivityEvent is never presented as evidence for the selected attempt.
- Lists and summaries declare their bounded window and truncation. “Daha eskiyi yükle” is offered only when the API supports it.
- Shared relative dates follow the selected UI locale; operational evidence prints the timezone label (default display: `Europe/Istanbul`) and retains a machine-readable ISO timestamp. Remaining route-specific date formatting requires locale review.
- Copy says “canlı” only under the Operations truth model above; polling alone is “yenileniyor.”

## Unknown-outcome reconciliation

The server owns reconciliation authority. The UI consumes `reconciliationEligible` plus authenticated API results and never infers a role from route visibility or local state. The authoritative sources are `docs/security-model.md`, `docs/runtime-safety-invariants.md`, the operations OpenAPI contract, and the persisted receipt state. This deployment currently has one authenticated operator credential model; copy must not imply an unimplemented multi-role organization.

Only a server-authorized operator may reconcile an `unknown` operation receipt. The dialog:

1. identifies the project, logical execution, operation, target, last effect boundary, and receipt ID;
2. requires exactly one disposition: `confirmed_applied` or `confirmed_not_applied`;
3. requires a non-empty audit note of at most 2,000 UTF-8 bytes, with a byte-aware counter and validation;
4. uses `ValidatedForm`/RHF/Zod with `noValidate`, initially focuses Cancel, submits pessimistically, and stays open while pending;
5. blocks duplicate submit and close-while-pending unless the request is safely abortable;
6. preserves note, disposition, and focus on failure;
7. announces the durable result on success.

The returned evidence includes a stable non-secret operator audit ID; the UI
never displays or persists the operator token, bearer credential, or session
cookie as identity. A same-decision retry is idempotent. An opposite or already
closed decision renders a conflict and cannot overwrite the first durable
record.

Before dispatch, the client persists the submitted decision and normalized note. After an uncertain response, it freezes that input. A read-only exact project/receipt check must confirm that the receipt is still `unknown` and eligible before an explicit identical retry is enabled. This read is independent of the history window and cap. A recorded decision and its original note, audit ID and timestamp are displayed as server evidence; a same-decision response with a different original note does not claim that the newly submitted note was saved. An opposite or closed decision cannot be overwritten. A missing exact receipt is inconclusive and blocks submission.

The selected receipt and its evidence remain pinned while the review is open, even if a background snapshot omits it. Async completions apply only to their original project/receipt scope. Ordinary drafts and one unresolved decision per project survive navigation and reload in session storage; they are not a cross-device or closed-tab backup. The project recovery panel remains independent of the bounded list and initial snapshot availability. Damaged records stay reviewable. Explicit clearing affects local recovery only; stale acknowledgements preserve newer inputs. A damaged companion draft cannot prevent acknowledging a valid intent. A 401/403 disables unsafe actions according to session policy; it is not evidence that a submitted decision failed.

Reconciliation records evidence only. It never replays the old receipt.
`confirmed_applied` shows “etki zaten gerçekleşti” continuation evidence and
prevents that effect from being proposed or executed again.
`confirmed_not_applied` closes the ambiguous receipt; a later execution requires
a new logical work item/receipt and a new approval when the effect is
approval-bound.

An approved browser action whose runtime/session/epoch/snapshot binding changed
is rendered as `reapproval_required`, not queued or live. The original approved
decision remains visible as historical evidence, its sensitive action payload
is unavailable, and the only execution path is a fresh snapshot plus fresh
approval. The UI never offers “retry on another worker” or silently recreates
the browser context.

## Inspector and overlay behavior

- Desktop (`>= 1024px`): attempt inspector is non-modal and remains beside the selected lane.
- Mobile/tablet: inspector is a modal Sheet with a visible title, localized close control, focus trap, Escape, backdrop dismissal only when safe, and trigger focus restoration.
- Dialog/Sheet content remains within the visual viewport and has one internal scroll surface when needed.
- Destructive or unknown-outcome confirmation uses AlertDialog, not a generic Dialog.

## Responsive contract

At 320px, 390px, desktop 1440px, and a wide 1680px project canvas:

- no document-level horizontal overflow;
- truth -> team -> incidents -> timeline reading order on narrow screens;
- workbench precedes project chat on mobile;
- touch-critical targets are at least 44px where space permits;
- labels do not disappear solely to fit icons;
- long IDs and Turkish copy do not push actions off-screen.

## Motion contract

Controls use 160–200ms transitions. Persisted handoff/recovery may animate for 480–700ms only after the backing event arrives. Repeating status motion is capped and never substitutes for time/label evidence. Reduced-motion mode retains state and focus visibility while removing non-essential animation. At least one normal-motion browser test covers a persisted handoff; reduced-motion coverage remains mandatory.

## Accessibility and localization

- Use the selected workspace language for shared controls, loading states, and accessible names. Turkish is the fallback for isolated component previews; application flows support all seven workspace locales.
- Icon-only buttons have an accessible name and tooltip in the selected workspace language.
- Tabs, listboxes, dialogs, sheets, and alerts follow their ARIA keyboard patterns.
- Status changes use appropriate polite/assertive live regions without repeated announcements on every sample.
- Focus is never hidden; color and motion are never the sole status channel.
- Light and dark primary actions, focus rings, text, and state colors meet WCAG 2.2 AA.

## Verification matrix

Before an Operations/UI milestone is complete, run and report:

- formatter and `git diff --check`;
- frontend and monorepo typecheck;
- production build;
- unit tests for stream ordering/reconnect/stale transitions and view-model derivation;
- strict API fixture tests for overview/instances/attempts/incidents/SSE/reconciliation;
- Chromium flows at desktop, 390px, and 320px;
- keyboard tabs, horizontal lanes, mobile Sheet, reconciliation failure preservation, and focus restoration;
- live -> stale -> disconnected with last-good age;
- attempt -> durable receipt projection;
- reduced-motion and one normal-motion persisted transition;
- console/page errors, duplicate IDs, unlabeled icon controls, horizontal overflow, and token contrast;
- premium UI report then strict audit against `premium-ui.json`.

Behavioral evidence belongs in project-owned tests. A static premium audit is a release gate but does not replace browser, accessibility, or failure-path verification. Auditor v1 currently case-folds JSX component names before native-tag rules; full-project strict output must therefore be line-triaged against `knownAuditLimitations` until that upstream defect is fixed. Known false positives are never silenced with redundant or semantically false code.

## Terminal and Browser request recovery

Before a user action, save a versioned UUID with verified local readback and send that UUID to server admission. An accepted identity never dispatches again. Exact authenticated receipt reads, reloads and local review never resend the original action. Automatic exact-lease cleanup on leaving the browser remains a separate bounded lifecycle operation.

Treat completion and output availability separately. Missing records are inconclusive; lost keys do not turn a completed command into an invitation to repeat it. Browser historical receipts cannot restore private control authority or pixels. Legacy IDs remain explicitly local-only. Preserve original source text and newer drafts, and correlate late responses with the complete original intent, not just the UUID. A changed local record blocks review/clearing.

Recovery states and dialogs use all seven selected languages, 44px controls, semantic themes and Arabic RTL. Review opens on Cancel; cancellation restores its trigger, while successful Terminal clearing returns focus to the command draft. Local clearing does not cancel server execution or delete a durable receipt. See `docs/operator-recovery.md` for the protocol and verification limits.
