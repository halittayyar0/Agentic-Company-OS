# Windows source snapshot Git path support

## Outcome and evidence

Users installing under a longer Windows profile or temporary directory must be able to check, apply and roll back an isolated source change. The unchanged PR49 full local suite failed five of 2,331 cases at the reviewed snapshot clone, while its source and HEAD remained unchanged. A passive capture of actual child processes identifies Git exit 128: the snapshot's `.git/refs/heads/codex/source-<UUID>.lock` reaches 260 characters. A synthetic repository with a short branch passed, so the repository root length alone was an insufficient reproduction. The actual workflow branch name reproduced the failure, and only adding per-command `core.longpaths=true` made the same structured sandbox clone succeed.

## Design

In `artifacts/api-server/src/lib/source-workspaces.ts`, add `-c core.longpaths=true` to managed Git invocations only on Windows. This covers clone, checkout, inspection, application and rollback without editing operator or repository Git configuration. Retain the existing disabled hooks, fsmonitor, credential helper, external protocol and signing options; keep structured spawn, sandbox environment, permissions, effect fences, timeouts, private-file/link/linear-history checks, cleanup admission and redaction intact. Non-Windows invocations remain byte-for-byte equivalent.

In `source-workspaces.test.ts`, pad the owned Windows sandbox root only when necessary so the actual workflow's UUID branch lock path reaches at least 260 characters. Keep all seven existing test names, assertions and platform applicability. These real Git/DB/sandbox journeys then catch this failure even when the hosted runner's temporary root is short. No additional test count, reduced assertion, increased timeout or reviewed skip is needed.

Document the managed Windows Git behavior in `docs/chatgpt-connection.md`. It applies to source changes and does not establish real account inference or native Windows coding support.

## Acceptance and authority

Watch the padded real journey fail with unchanged production code, then pass after the single Windows Git option. Run all seven source workspace cases and meaningful adjacent source/task permission cases, full typecheck and formatting. Preserve original failed full local/hosted reports under their original candidate SHA. A later commit needs its own complete local suite, original hosted gates, independent review, exact candidate/main verification and anonymous public readback. The independent hosted wall-clock failure must be diagnosed separately before integration; a passed source subset is not full acceptance.

The user's standing authorization covers routine fixes, tests and publication; execute without another approval prompt. Preserve the dirty primary checkout and the separate privacy branch. No paid inference, account authentication, global Git/registry changes, weakened branch protection or workflow rerun is authorized by this design.
