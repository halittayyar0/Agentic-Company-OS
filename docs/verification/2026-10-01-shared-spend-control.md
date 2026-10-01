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

The existing UI can answer an operator question but cannot resume a budget
block. Complete an authenticated, receipt-backed check-and-resume control for
budget-paused work, with seven-language recovery and uncertain-response tests.
It must retain recorded spend, preserve emergency-stop/ownership boundaries,
and never reopen approval, input, cancelled or completed work.

Then synchronize with PR #35 after its required checks pass, regenerate the API,
verify the complete candidate, push a PR, inspect all required platform/security
checks, merge and prove the exact public installer/image. No new release claim
is supported by these local checks. Physical-phone, native-speaker and real
24-hour acceptance remain unverified; issues #29 and #34 remain open.
