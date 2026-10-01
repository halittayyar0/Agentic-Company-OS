# Shared spend control development checkpoint

This work is on `codex/family-spend-control`, based on released 0.3.8 main
`c408141dad453bad0e6024d6c0e7b0d8931ba1ef`. It is not a published release.

## User benefit implemented locally

The root job and every descendant share recorded inference spend. Execution,
fallback and completion review use the same admission path. Finite jobs take
the greater of each member's materialized and ledger totals without adding
the two copies together. Recurring families use the root's cycle boundary and
a separate rolling 24-hour ledger, including previous cycles. Unknown provider
cost remains unknown. Existing individual limits also apply.

Defaults are 250,000 tokens / $3 reported cost per finite family or recurring
root cycle, and 500,000 tokens / $8 over 24 hours for recurring families. They
are recorded-usage admission limits: concurrent and in-flight requests may
overshoot; no account wallet or provider funds reservation is introduced.

Application admission errors have a typed boundary in model routing. A
regression first showed that the English provider-reported cost explanation
was classified as a provider outage and retried. It now preserves the budget
error, with one admission attempt, no provider request and no invented review.

All seven languages identify the root job and exhausted shared limit. The
budget explanation appears directly below the project brief on phones. A
viewport regression first failed when the explanation was below the recorded
summary; the final browser run requires the full explanation in the viewport.

## Passed evidence

- Twenty-three focused family, task, step, routing and language tests passed.
- The scheduler/recovery run passed 56 checks. Its first invocation used a
  relative test-loader import, which failed after a fixture changed directory;
  using the repository's absolute-loader convention passed without a product
  change. The typed model-admission boundary was checked in the later focused run.
- Native PostgreSQL 17 on Windows passed all nine family tests against a fresh
  disposable loopback database, including the actual completion-judge boundary.
  The owned cluster was stopped and its PID file was absent after cleanup.
- The temporary native probe's first launcher waited for the database server's
  whole descendant tree. The owned fixture was stopped and the temporary
  launcher changed to a bounded wait for the command process. This was not a
  production harness change and does not establish issue #29's cause.
- The final 21-case Chromium task/resume run passed, including seven shared
  budget phone views, Arabic RTL/light mode, other locales in dark mode, existing
  uncertain-answer recovery, and the complete-warning viewport assertion.
- Final API and frontend typechecks/builds, touched-file formatting, diff checks
  and bundle verification passed. Code with one language per surface measured
  1368.0 KiB raw / 411.2 KiB gzip, within the unchanged existing ceilings.

## Required follow-through before publication

The authenticated budget control is now implemented locally. A scope-bound UUID
receipt commits atomically with eligible queue transitions. Duplicate sends and
later replay return the same result; usage is retained. The runtime control and
canonical workforce/approval/task locks preserve emergency-stop, cancellation,
ownership and unfinished-operation boundaries. Invalid or oversized families
fail closed before any transition. The browser saves its request before sending,
inspects after uncertain delivery/reload, and offers only an explicit same-ID
retry. A confirmed rejection permits a fresh explicit check.

Additional acceptance evidence:

- The transaction-client regression failed when injected reads were ignored;
  its final spend-reader run passed 12 checks. API typecheck passed.
- Ten route checks passed, including concurrent replay, immutable rejection,
  individual/shared/daily allowance, retained usage, inactive and leased work,
  mixed block reasons, unfinished operations, emergency stop, forced rollback,
  corrupt cycles, the 1,000-member bound and a cancellation race.
- The complete spend/route flow passed 20 tests on a fresh native PostgreSQL 17
  fixture on Windows. The owned database was stopped and its PID file was absent.
  The CI now includes the same flow in a separate disposable PostgreSQL database.
- Five browser-recovery unit checks passed. New regression cases first exposed
  cross-root marker clearing, invalid identities writing damaged markers and
  non-ISO receipt timestamps; all were corrected and rerun successfully.
- The final Chromium task/resume run passed 28/28: seven selected-language phone
  views and keyboard actions, lost acknowledgement/reload/GET recovery, explicit
  same-ID retry, storage denial, rejected allowance then a fresh check, failed
  lazy-asset reload with the request retained, and Arabic 320px at 200% text.
- Frontend typecheck and production build passed. The budget recovery chunk is
  conditional. Its chunk, selected studio-pack growth and bounded route/API
  wiring measure 11.5 KiB raw / 4.1 KiB gzip against a dedicated 13 KB / 4.5 KB
  feature cap; previous route, media and base ceilings remain unchanged. Total
  selected-language code is 1379.1 KiB raw / 415.0 KiB gzip.
- Production dependency audit found no known vulnerabilities; the dependency
  license policy passed. API regeneration produced no remaining generated diff.
  Touched formatting and diff checks passed; full integration review remains
  before publication.

The new operator flow exposed an installation gap: container resume rewrote
`compose.env`, discarding custom allowance limits. A failing executor regression
confirmed this. Resume now preserves only recognized positive budget settings
in both the saved config and launch environment; arbitrary secrets or execution
settings are not inherited. Invalid/duplicate settings and unsafe private files
fail closed without overwriting them. The completed-preference boundary remains
unchanged. All 12 installer/parser/resume/deployment checks and scripts typecheck
passed, including preserving approved limits, rejecting duplicate/invalid limits,
and refusing oversized or linked private configuration without overwriting it.

PR #35 passed all eight required checks and merged as
`12ccba9ea66c1f33802e11eb87618a2145a3de02`. Its passing head, tested PR merge
and main share tree `4444e3a94e1423f7db3be4ad9dcdfd22d80996d3`.
This branch synchronized with that main as `3f4f7be`, preserving both bounded
feature allocations. Its integrated build/bundle passed at 1388.9 KiB raw /
418.2 KiB gzip. The parent distribution run `36806665790` passed installation,
resume, disposable backup restore and packaging. Public 0.3.9 tag, ZIP/checksum
and both Linux image architectures were verified anonymously; see the completion
review checkpoint for the exact source, checksum and image digest.

## Whole-branch review and fix pass

One independent read-only review found two functional issues and one misleading
cost-coverage field. The fix pass reproduced all three before changing code:

- The documented `MAX_TASK_STEPS=0` disabled cap prevented container resume.
  Parser and completed-installation regressions failed before the validator was
  corrected to allow zero only for this setting. Other zero limits stay invalid.
- A historical accepted receipt hid further checks on the mounted page, even
  when only a child resumed or the selected job paused again later. Both browser
  regressions failed before the control was separated from current eligibility.
  Scope refresh and explicit new identities now support another deliberate
  check without replaying the prior accepted request.
- Materialized tokens missing from priced ledger entries could incorrectly
  label finite-family cost coverage complete. Two regressions failed for a
  legacy-only member and a partially priced legacy member. Coverage now remains
  partial when some cost is known, or unknown when none is known. The recorded
  token/cost admission limits are unchanged.

After that fix pass, 54 focused integrated source checks passed, including
spend, routing, receipt boundaries, browser recovery and installation. The
complete monorepo typecheck/build, stable API generation, production audit and
license policy passed. Bundle verification passed at 1389.0 KiB raw / 418.2 KiB
gzip; the recovery feature is 11.6 KiB raw / 4.1 KiB gzip within its unchanged
13 KB / 4.5 KB allocation. Final integrated Chromium acceptance passed 55/55
checks across task recovery and completion-review traces; the two new same-page
budget regressions passed alongside the seven-language phone/keyboard checks.
The final native PostgreSQL spend/receipt suite passed 22/22, including the cost
coverage regressions. The owned disposable cluster stopped and its PID file was
absent. Full source/UI and platform publication gates remain before this
candidate can be called released.

## Complete-suite fixture correction

The full Linux UI gate on `6f56ef7` failed seven runtime-status language cases
and passed 963 cases. Each failure identified the same newly valid scope read,
`GET /api/tasks/101/budget-resume`, missing from that test's strict fixture. The
Turkish case reproduced the failure locally before the correction.

The fixture now serves only that exact read and checks the localized budget
action is visible for budget-paused work and absent for the emergency-paused
view. Other methods still reach the strict unexpected-request handler; no
resume mutation is allowed by opening the screen. The unexpected-request and
write assertions remain intact. Independent read-only review reported no
actionable findings. Integrated local UI acceptance then passed 62/62 across
the seven runtime-status cases, task recovery and completion-review traces.
No production code or admission behavior changed in this correction. The
updated candidate still requires a fresh complete exact-head gate result.

Verify the complete 0.3.10 candidate, push a PR, inspect all required
platform/security checks, merge and prove the exact public installer/image.
No new release claim is supported by these local checks. Physical-phone,
native-speaker and real 24-hour acceptance remain unverified; issues #29 and
#34 remain open.
