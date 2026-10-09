# Recover a project start without creating another job

## Intent and authorization

The operator should be able to start work, lose the network response, reopen the page and find the same job. This is a dependency of reusing successful briefs and useful recurring responsibilities. Saving/checking a request must use no inference and no additional agents. The user's standing authorization covers routine implementation, tests and publication; use native execution in this session. No paid services or human authentication are required.

The 0.4.0 candidate remains frozen in its original worktree while its CI runs. Prepare this change in the existing, clean `simple-task-results` worktree on `codex/project-start-recovery-20261009`, based on exact 8aca124827578373a7d8e9e0b7372718e42efe48. Do not push it into PR42 or supersede that release's tests.

## Options considered

Disabling the Start button handles double clicks but does not recover a committed request after response loss. Reusing agent-interaction requests would bind team-first project creation to an individual chat agent and its unrelated response contract. Add an optional request identity to the existing project API instead, with a narrow persisted receipt and a token-free GET endpoint; retain legacy callers without an identity.

## Server contract

- `TaskInput.requestId?: string` is a canonical UUID (version 1–8, RFC variant, case-insensitive input normalized lowercase). No nil identity. Existing callers without it retain the previous creation behavior; reliable recovery requires it.
- The identity binds a SHA-256 digest of `["task-creation-v1", trimmedTitle, exactBrief, ownerAgentIdOrNull, priorityOrNormal, dueAtISOOrNull, autonomyModeOrFinite, continuousCadenceOr3600OrNull]`. Explicit defaults and omitted defaults mean the same request. Changed effective input with the same identity returns `409 TASK_CREATION_REQUEST_CONFLICT` and never creates a new job.
- Append-only application receipts live in `task_creation_requests`: UUID primary key, digest, state `created|rejected`, task ID for created receipts, fixed rejection code for rejected receipts, creation timestamp. No raw brief, credentials or model response in the receipt. No FK/cascade or expiry: deleting an old project cannot make the request identity reusable. This is application immutability, not a tamper-proof audit claim.
- Lock global runtime control before reading or creating a receipt. For an existing matching receipt, return its saved outcome before current admission checks; this reads records without starting more work. For a new request, use the unchanged `createProjectWithinTransaction` rules (stop, tool policy, capacity, current workforce and model snapshot). Create the project and created receipt in the same transaction. Known admission rejections are persisted as terminal rejected receipts under that same lock; unknown/storage errors roll back both project and receipt.
- First created result is the existing Task response with HTTP201; a matching created replay returns the same project's current Task with HTTP200. A removed project returns HTTP410 with `TASK_CREATION_PROJECT_REMOVED`, retaining the receipt. Neither replay nor GET changes task status, execution policy, model selection, recorded usage or work admission.
- `GET /task-creation-requests/{requestId}` returns only `{requestId,state,taskId,failureCode,createdAt}` under ordinary operator authentication with `Cache-Control:no-store`. Invalid identity/query is HTTP400; missing receipt is HTTP404. An uncertain write is never asserted absent merely because an in-flight transaction has not yet committed.
- Known rejected outcome codes: `EMERGENCY_STOP_ACTIVE` (423), `AGENT_UNAVAILABLE` (400), `RUNTIME_CAPACITY_EXCEEDED` (429), and policy rejection (423 with its existing fixed code). A matching rejected request stays rejected when capacity/policy later changes; starting a new deliberate job uses a new identity.

## Client contract

The New project screen saves a validated frozen request `{version:1,requestId,input,submittedDraft}` in tab session storage before POST. The submitted snapshot is needed to distinguish later edits, including whitespace or finite-mode cadence, after reload; input is verified against that snapshot. Save must round-trip successfully; blocked or damaged storage keeps the editable draft and starts no job. Any saved unresolved record prevents another new identity from being submitted, including after reload. There are no automatic POST retries.

After uncertainty, an explicit Check request action performs only GET. Created receipts expose an Open project action. Rejected receipts expose the reason and let the operator prepare a fresh identity while retaining the current draft. Missing receipts expose an explicit retry of the same frozen identity/input; this remains safe if the first transaction commits late. Read failures preserve the record and draft. Editing the visible draft does not modify the frozen request or cause dispatch. Do not offer discard of an unresolved request as a safe cancellation.

After a valid acknowledged outcome, clear only the matching saved request and, on success, only the exact submitted composer draft. Later edits remain intact. Failed clearing leaves a recoverable record, never creates a new identity. Malformed server receipts cannot navigate, clear a draft or declare a job created.

A normal POST acknowledgement is bound to the frozen UUID through one read-only
receipt lookup before navigation. If either response is invalid or mismatched,
retain the request for explicit Check. Leaving the composer prevents a late
response from navigating, clearing storage or making that follow-up read. The
recovery component is loaded only with New project; Start waits until the saved
request state has been read. Its independent bundle measurement includes only
the exclusive recovery chunk and exact authored recovery fields; existing route,
vendor, API and CSS ceilings stay fixed.

Aggregate code totals count one locale per surface. Recovery credit therefore
uses the exclusive logic plus max(current locale packs) minus max(control packs),
independently for raw and gzip sizes. The sum of all seven authored additions is
checked separately and never subtracted from the one-locale aggregate. A
regression must reject unrelated growth beyond the original aggregate ceiling.

## Design and localization

Preserve the current project composer. Show one compact status panel adjacent to Start with concrete states (checking, saved project, rejected, not found, uncertain, storage unavailable). Explain that checking spends no model tokens and does not rerun work. Use existing semantic colors, 44px controls, focus restoration and lazy authored copy for en/tr/de/ru/zh-CN/zh-TW/ar. Verify 390px, Arabic RTL at 200%, keyboard recovery, changed drafts and failed storage. A stored created receipt proves project creation, not eventual task completion.

## Acceptance

Watch the real existing POST/tasks duplicate test fail before changing the API. Then prove matching/concurrent replay creates one task, membership snapshot and task-created activity; changed input conflicts; semantic defaults and mixed-case UUID replay; removed tasks remain unreusable; known rejection is durable; unknown transaction failure leaves no partial task/receipt. Exercise PostgreSQL concurrency in a disposable owned database, not only PGlite.

Client tests must reproduce response loss, reload, edited drafts, missing/rejected/malformed receipts, failed clearing and denied/corrupt storage. Render seven languages at phone width and Arabic 200%, verifying no auto submit/inference and exact same-ID retry. Run type generation, formatting, migrations, audits, build and required whole-source/UI/platform CI on the eventual publication candidate. Publish only after 0.4.0 is actually accepted and released; the goal remains broader than this one dependency.

## Follow-up

Reuse completed briefs through the current skill editor and retained project composer, then add versioned parameters/comparisons in a separate design. Refresh the public roadmap after 0.4.0 with scoped verified facts. No new arbitrary workflow engine, execution permission or provider fallback is introduced here.
