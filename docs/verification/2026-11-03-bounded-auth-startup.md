# Bounded authentication startup — 2026-11-03

## User benefit and authority

A stalled authentication read now leads to the existing localized recovery panel
after 15 seconds, including when HTTP 200 headers arrive but the response body
never finishes. Retry can reach a local server despite an offline browser hint;
initial failures stay actionable rather than returning to a polling spinner.
The shared query explicitly refreshes on reconnect. Login, Retry and Reload use
the existing 44 px touch size at phone and desktop widths. Login form validation
belongs to the application: blank/whitespace input cannot dispatch a request.

AuthGate and operator result review share the same cancellable status query.
Late, cancelled and malformed responses cannot grant access. Login/logout writes,
server authorization, task permissions, model costs and storage are unchanged.
The offline native smoke records bounded numeric authentication transport phases
and closed failure categories; it never retains bodies, credentials or arbitrary
error text. Headers and completed response bodies are distinct evidence.

## Evidence and original failure boundary

PR 100 head `467eb35` remains rejected: its original Windows installation failed
before the zh-CN desired-outcome form appeared; the dependent runtime guard
correctly failed. The exact cause is unconfirmed. Original logs and failure
artifact 13188810851 are preserved. All 21 original jobs are terminal. A warning-only
audit found zero Node 20 deprecation annotations; this does not excuse either
failed mandatory job. Original Linux 3155 source cases/3116 passes/39 skips and
1502 UI cases, both macOS source stages, five native receipts and the finite
Docker component have separate successful evidence, with no whole-candidate,
actual-main or publication acceptance.

A separate controlled browser peer proves the bounded-auth defect: with 200 and
an unfinished JSON body, the old production UI still had no recovery after the
unchanged 30000 ms page-readiness budget. The repaired read exposes recovery within
that budget. This controlled reproduction does not establish the old hosted
Windows cause.

Before final review, all 17 auth browser cases passed: seven languages at 320 and
1024 px plus the existing login 401, copy-load and 503 cases. Operator result review
passed 14 cases, and the real local installer/PostgreSQL/API/two-worker journey
completed seven controlled-model first tasks with stable source and cleanup.
These are pre-review local results. Independent review then found the reconnect
default change caused by `networkMode: always`; a reconnect regression failed
before explicit `refetchOnReconnect: true` was added. The touched-file static
audit also found missing `noValidate`; the existing login case now covers it and
zero whitespace dispatches. Final source/browser/native evidence must be rerun
for those changes before acceptance.

Focused auth, transport, reader-budget and producer tests pass 49/49 without skips.
The source census adds twelve cases (3167 total); the UI census adds fifteen (1517).
Every existing platform skip list and unrelated expectation remains identical.
Shared query wiring changes generated reader helper identifiers. The budget
checker accepts only two complete hash-pinned helper bodies, still verifies the
owned compiler outputs and original reader runtime digest, and retains every
numeric byte ceiling. Both identifier forms face the existing tampering tests.

## Remaining checks and limits

Run final affected browser/native checks, whole types/build/format, generated API
consistency, both dependency audits, licenses, bundle budgets and secret scans.
The broad local source run began before final-review changes; it cannot qualify
the final source by itself. New hosted original source/UI/platform/security/native
producers must qualify the new commit before normal protected integration.

The full official static UI audit is incomplete: its unchanged parser repeatedly
returns to offset 9707 in unchanged `tests/ui/home-start-recovery.spec.ts`. An
isolated 100-visit observation establishes inconsistent whole-prefix versus
boundary-prefix regex detection. The tool was stopped without changing rules or
project files. A touched-file audit uses the unchanged official rules and all
project contract checks; its narrower scope must remain explicit.

No physical-phone, other-host-OS, real-model quality or 24-hour proof comes from
these local checks. Actual-main qualification, full native archive bytes, genuine
fresh/0.5.9 GUI upgrade, distribution and anonymous public readback remain separate
release gates. The next valuable work is completing those release gates and using
fresh Windows lifecycle evidence to resolve any remaining startup failure.

The new status-read/query bytes have a separate source-owned 256-byte raw /
128-byte gzip cap. Only the exact bounded read and connectivity query additions
are reconstructed before the older Composer entry check. The same measured
growth is excluded from Keeper/resume overlap before one global credit; login
and logout, other code, routes, vendors and media earn no credit. Every existing
numeric base/total/route/media ceiling stays fixed. Two positive/tampering
contracts cover this allocation. This prevents attributing new authentication
behavior to an older draft feature without enlarging its budget.

Final local checkpoint: focused source contracts 59/59 without skips; whole
workspace types/build, generated API consistency, both dependency audits,
production licenses and real bundle checks pass. The final common recovery
panel passes 8/8 affected browser cases (English/Arabic 320/1024px, whitespace/401,
copy-load failure,503 and reconnect); the preceding seven-language auth/operator
review matrix passed 32/32. The changed-file official-rule audit reports zero
findings. The full-project audit remains incomplete as described above. New
read/query growth measures 130 raw/63 gzip within its 256/128 cap. Final independent
review found no ownership or overlap issue; both gzip failure messages now
include the same measured subtraction as their predicates. Final native and full
source/UI/platform qualification remain the responsibility of the new original
hosted runs, not the rejected 467 evidence or the pre-review local native pass.

The supplemental broad local source run finished with 3165 cases: 3130 passes,
zero failures and 35 skips. All 34 expected Windows skips remain; one existing
safe-output symlink case is additionally blocked by local EPERM. Its attempt
started before final review/budget edits and did not discover the two new budget
cases, which pass in the final focused 59. It does not qualify the final 3167-case
candidate, and neither hosted skip expectations nor filesystem protections were
relaxed for this local host.
