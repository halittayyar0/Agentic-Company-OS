# Completion evidence checkpoint

The current completion review previously received only the task brief and the
agent's own report. A regression fixture stored a failed command receipt and
claimed that all checks passed. The test failed because the reviewer never
received that receipt. No live model or paid service was used.

The existing reviewer now also receives bounded runtime metadata: scoped tool
states, selected typed results, reconciliation decisions and child task states.
State counts cover all matching records even when the samples are truncated.
The same snapshot is retained in the existing review activity. No task API,
permission gate or frontend flow was added.

The change is included with the portable backup work in the 0.3.8 release
candidate on PR [#33](https://github.com/halittayyar0/Agentic-Company-OS/pull/33).
The final required CI run must cover that combined source before publication.

## Local evidence

- Six focused scenarios passed for evidence delivery and persisted review in all seven languages with one existing review call; current-cycle/task/approved-effect isolation and raw-data exclusion; full counts with truncated samples; answer-only tasks and old child-task exclusion; invalid typed fields; a blocking review that retains the task and snapshot without preparing completion. The first invalid-artifact test caught a truncation that turned an invalid value into a valid-looking UUID; the query now rejects incorrect types and lengths before selecting it.
- The final full team-tool locale suite passed 51 tests, including existing approval and browser boundaries and the invalid-field and blocked-verdict regressions.
- Model boundary and durable-attempt suites passed 74 tests. API typecheck, API production build and repository formatting passed.
- A fresh disposable database on native Windows PostgreSQL 17.10 passed the read-only repeatable-read query, returning a failed command and exit code 1 while excluding its stored raw output. That database was dropped and the owned PostgreSQL fixture was stopped afterward.
- The first native probe failed because its temporary Windows runner used a path string for a dynamic ESM import. Correcting the runner to a file URL fixed it; the earlier failed probe is not passing evidence.

## Local full-suite limitation

Two full Windows source-test attempts were interrupted after child processes
aborted with `Fatal process out of memory: Zone`. The initial two-file run had
about 904 MiB available physical memory and 157 MiB available virtual memory at
the observed failure. The second used the CI settings `TEST_CONCURRENCY=1` and
`TEST_DISABLE_WASM_CODE_GC=1`, but also encountered fatal memory allocation
failures in unchanged suites. Only the owned test runs were stopped; no user
application was closed. Neither attempt counts as a passing full-suite result.
The narrower 51-test and 74-test runs and native PostgreSQL proof above remain
separate evidence. Full acceptance still requires a clean CI run of this branch.
This does not establish a cause for the unrelated native restart issue #29.

## Remaining gates and limits

The local API production build passed. Full source/UI, security and native/container platform checks
must pass for this branch before merge and publication. The change is not yet
released. No physical-phone, native-speaker, real 24-hour soak or live-model
judgment acceptance is claimed.

These tests establish that the reviewer receives correctly scoped metadata;
they do not prove it always detects false claims. A successful operation receipt
does not establish artifact quality or all requirements. The bounded snapshot
is read before inference and is not a continuous lock over external reality.
Existing ownership and terminal-state fences remain responsible for completion
authority. See [review behavior and privacy](../completion-review.md).
