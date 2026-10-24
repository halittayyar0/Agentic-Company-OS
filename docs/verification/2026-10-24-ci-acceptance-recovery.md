# Preserve failed acceptance and recover the complete checks

Candidate `33c5d901bdce57f09867db25fda2fff97b28d87c` did not qualify
for merge or publication. Original CI run `40019377869`, Linux job
`120644894919`, exceeded its unchanged 75-minute deadline. The UI step ran
from `2026-10-23T21:16:53Z` to `21:54:49Z` and started case 1,385 of 1,465.
This is an incomplete run, not 1,385 passed cases.

The complete original log also contains four failures: English/Arabic
operator-provenance download and saved-table-layout reuse cases raised
`ReferenceError: exports is not defined in ES module scope`. The failing
imports were in the test process, loading frontend copy modules dynamically.
The local Windows focused run had not exposed this Linux transformation
problem. No broad cross-platform success is claimed from that local run.

Original complete log SHA-256:
`67e325a5688b387ccfceac070e56a34b7eea38636fb02b7140993c08687367d6`.
The original annotation explicitly reports `1h15m0s`. The first log download
was refused by the CLI because of terminal escape sequences; the successful
read used its explicit escape-sequence option and preserved the same job log.
Neither operation reran the producer.

The source-test step inside that failed job separately passed the unchanged
source-log verifier: 3,080 tests, 3,041 passed, 39 original Linux skips and
zero failures/cancellations. That step proof does not qualify the whole job.
The later frontend budget step was skipped when the job timed out.

## Recovery

The two affected specs now statically import their copy loaders, matching
existing test modules. All original assertions, locales, table cells,
downloads and 33 focused cases remain. Those cases passed locally on Windows
with no retry or skip; a fresh original Linux run remains required.

The unchanged Linux reusable-guide native command and its separate evidence
upload move onto the existing local-model-preparation runner. Its original
model-preparation artifact is captured first, before a second owned native
fixture can enter its file glob. The source/UI job no longer spends about
eight minutes on that serial work. There is no additional job or test shard.
The existing 75-minute and 25-minute job limits, two UI workers, zero retries
and all 1,465 UI cases remain unchanged.

The release verifier now requires the preparation producer and both native
proofs, including their separate evidence-preservation steps, from the same
original attempt-one CI run and correct checkout. New PR/main negative cases
reject absent, duplicate, different-head/run, restarted, incorrectly checked
out, skipped, failed or incomplete producers and steps. The required Actions
contexts are unchanged; the nested proof set increases from 15 to 16 per
candidate and from 30 to 32 across PR plus actual main.

All 133 release-verifier contract cases passed locally. Two new regression
cases increase each source census from 3,080 to 3,082 and each corresponding
pass floor by two. Existing source skip sets and UI expectations are unchanged.
Workspace type checking passed. No application, database schema, package
dependency or locale behavior was changed by this recovery.

Independent review found that the shared native failure-file glob could label
a preparation failure as guide evidence when the guide command was skipped.
The guide upload now requires that its named command actually ran (success,
failure or cancellation); preparation failures remain in the preparation
artifact. The workflow regression failed before this correction and all 133
release-verifier contracts passed afterward. No source case was added by this
review correction, so the 3,082-case census remains unchanged.

## Still required

PR 81 returned to draft and the local merge/qualification waiters stopped
with `accepted=false`, `mainMerged=false` and `releasePublished=false` after
the original required job failed. No check was bypassed, deadline enlarged,
producer rerun, or failed result reclassified. The original Windows runtime
job is tracked independently until its own terminal result.

A clean new candidate needs fresh original source/UI/platform/security
checks before ordinary merge, then actual-main checks and native/archive,
genuine-model/browser and public-delivery acceptance. Accepted development
model proofs retain their original `33c5d901` identity; they are not relabelled
as new-head or actual-main archive evidence. The failed unpublished 0.5.8
qualification and earlier genuine autonomous held-file failures remain failed.
Goal 7 remains active.
