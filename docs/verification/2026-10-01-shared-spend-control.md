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

Then synchronize with PR #35 after its required checks pass, regenerate the API,
verify the complete candidate, push a PR, inspect all required platform/security
checks, merge and prove the exact public installer/image. No new release claim
is supported by these local checks. Physical-phone, native-speaker and real
24-hour acceptance remain unverified; issues #29 and #34 remain open.
