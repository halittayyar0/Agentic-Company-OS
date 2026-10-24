# Windows staging fixture cleanup

On main commit `0550ade9ff7f556723edcee901f966c0a17a1135`,
[CI run 40101764084](https://github.com/halittayyar0/Agentic-Company-OS/actions/runs/40101764084)
failed in Windows source tests. All five staging IPC subtests passed; the
parent test's cleanup hook then failed with `EBUSY` while unlinking its copied
`runtime/node/node.exe`. The source census was 3,093 tests, 3,058 passed, one
failed and 34 skipped. The hosted log does not identify the lock owner.

The fixture now removes its copied executable with Node's bounded file-removal
backoff before removing the temporary directory. Five retries at 100 ms linear
backoff apply to that file alone. Recursive parent retries would give each
ancestor a new retry budget and multiply the delay. A persistent lock still
rejects cleanup. Every IPC assertion, process shutdown, test timeout, test count
and release gate is preserved; production code and workflows are unchanged.

A local Windows diagnostic held a real deny-delete file handle on an owned copy
of the executable and executed the fixture's cleanup code. Original cleanup
rejected with `EBUSY`. Updated cleanup removed the fixture after the transient
lock was released (323 ms); a persistent lock still rejected with `EBUSY`
(1,540 ms). All diagnostic processes exited and their owned files were removed.
An initial whole-directory retry proposal was rejected by this diagnostic
because recursive retry budgets multiplied the wait.

The four adjacent IPC, worker, lifecycle and PostgreSQL staging files passed
16 tests locally on Node 24.22.1. The first local build exposed stale installed
dependencies in the reused worktree; the frozen lockfile was reinstalled
offline before final validation. The focused 16 tests passed again with frozen
dependencies; the full typecheck and production build also passed. Formatting
and the staged-patch secret scan passed. The old failed CI run remains recorded and
has not been rerun. Original PR checks and subsequent actual-main checks must
pass before this change is called remotely verified or a release is published.

UI, translations and product runtime behavior are unchanged. This focused
check does not establish physical-device behavior or a 24-hour endurance run.
The next product improvement remains actionable local-model startup guidance
while preserving unresolved-usage holds and explicit operator choices.

Reference: [Node.js 24 file-removal options](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesrmpath-options).
