# Runtime status localization — 28 September 2026

Status: focused behavior, browser, workspace build, source-export roundtrip and
refreshed full source checks passed. Goal 7 remains active. This is
uncommitted local work, not a public-release attestation.

## Findings and changes

The scheduler wrote Turkish-only claim, accepted-delegation, budget and recovery
messages. The API returned these persisted values unchanged, and the interface
displayed them as source records. Choosing another workspace language therefore
did not localize these newly generated messages.

The scheduler now captures the saved workspace language before each claim,
budget-enforcement or recovery operation. Its new messages use the same typed,
seven-language catalog as the other runtime tools. Step, token and provider-cost
limits, numeric evidence, task selection, lock order, ownership fences, cadence
and replay behavior are retained. Continuous lifetime counters remain telemetry,
not a per-cycle budget or a completion signal. Existing records are not rewritten
when the language changes.

Recovery also used to report requeueing when emergency stop kept execution
paused. Both the current-attempt and legacy expired-lease paths now describe
that paused state explicitly. This changes the message, not the stop gate or
the next-attempt scheduling decision.

Project meeting `currentAction` was another Turkish-only user-facing status.
It now uses the selected language, captured once for both the status and the
model's workspace-language contract. Literal meeting titles and stored replies
remain source text. Exact request replay returns the original transcript and
does not run the provider again after a language change.

These changes add eleven message keys authored in all seven languages. No
package, public endpoint, database schema, budget default, permission or
external-service dependency was added.

## Evidence and repair history

| Check                                    | Result                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Initial scheduler reproduction           | The first fixture run also exposed invalid teardown states in the test itself; those were corrected to the existing database constraints. Its log is retained as `acos-scheduler-locales-red.log`.                                                                                         |
| Clean scheduler RED                      | 31 total: two passed, 29 failed, zero skipped; the failures reproduced Turkish-only output and the old recovery text. `acos-scheduler-locales-red-clean.log`.                                                                                                                              |
| First localization correction            | All 37 behavior cases passed, but the test-file teardown failed once with Windows `EBUSY`. The owned-directory cleanup now uses bounded retries and still checks its exact parent/prefix. `acos-scheduler-locales-green.log` records the unsuccessful overall run.                         |
| Paused-recovery RED                      | 45 total: 30 passed, 15 failed, zero skipped. Fourteen paused language/path cases plus their parent failed on the misleading requeue message. `acos-scheduler-paused-red.log`.                                                                                                             |
| Scheduler and ownership regression group | **62 passed, zero failed/skipped**, 31.7 seconds, including all seven languages, three budget reasons, both recovery paths, paused/no-claim behavior, literal titles, saved history and existing accounting/receipt tests. `acos-scheduler-locales-focused-final.log`.                     |
| Meeting RED                              | Eight total: one passed, seven failed; six non-Turkish status cases plus their parent failed. `acos-project-meeting-locales-red.log`.                                                                                                                                                      |
| Meeting HTTP and replay regression group | **23 passed, zero failed/skipped**, 32.0 seconds. Actual Express/DB routes use a deterministic provider seam; no live model calls. `acos-project-meeting-locales-green.log`.                                                                                                               |
| Workspace build                          | The first build caught an untyped JSON value in the new test, before compilation. A runtime integer-ID assertion fixes that fixture. Full types and production build then passed in `acos-runtime-status-build-final.log`; the earlier failure remains in `acos-runtime-status-build.log`. |
| Phone rendering                          | **Seven passed, zero failed**, 18.9 seconds. Each language covers budget and paused recovery at 320 px, including Arabic RTL, literal source records, both themes across the matrix, no horizontal/text clipping and no task mutations. `acos-runtime-status-ui.log`.                      |

The browser cases use the production frontend with controlled API fixtures.
They are presentation evidence, not live-provider, native Safari or physical
phone proof. Captures are under `test-results/runtime-status-locales/`.

Representative English dark budget, German light paused and Arabic RTL light
paused captures were inspected. Their warning and trace records wrap within the
320 px page. The captures are tall full-page images; this inspection does not
establish native-device usability or native-speaker acceptance. The three image
hashes and dimensions are recorded in
`test-results/runtime-status-release/snapshot-proof.json`.

## Installed source checkpoint

The proposed source-only ZIP contains **1,384 files** from **1,388 candidate
paths**. The same four reviewed historical assistant notes remain excluded only
from the export; the checkout and Git history are preserved. All included files
passed SHA-256 archive roundtrip checks. The separate extracted workspace restored
509 locked packages from the existing cache, **zero downloads**, with lifecycle
scripts disabled (`acos-runtime-status-export-install.log`). Its first-run test
preference was explicitly set to English in that owned disposable copy; the
operator's real preference was not changed.

Full workspace types/build passed in `acos-runtime-status-export-build.log`.
A subsequent hash comparison correctly rejected the frontend output: the
development `NODE_ENV` used for the source-test guard had also been applied to
the build. Both frontend copies were rebuilt with explicit production mode
(`acos-runtime-status-main-production-ui-build.log` and
`acos-runtime-status-export-production-ui-build.log`). **All 198 files in both
copies then matched the earlier full 903-case browser run byte for byte**.
The HTML hash is
`b2cae3b0f743c935cc6034065443baf1880a631e0b2dbcbbc2cca48ecd6d2c26`.
No product source, dependency or build configuration change was needed for this
verification-environment correction.

The full browser history remains **903 passed** on that identical frontend,
plus the **seven new focused cases** above. The now-registered 910 cases have
not been represented as a fresh single full run. Full source tests ran separately
under the development-only environment guard against all **212 test files** in
the installed export: **1,374 total, 1,368 passed, zero failures or cancellations,
six skipped**, in **750,951.2531 ms**. `acos-runtime-status-export-full-source.log`
records the result; terminal session 26087 completed with exit zero. The export's
saved English preference remained English after the suite.

The six skips are five native PostgreSQL checks (worker ownership, operator
identity, receipt/browser-affinity/reconciliation races, heartbeat/recovery lock
ordering and cross-connection file locking), plus the Windows output-symlink
fixture whose setup returned `EPERM`. These remain exclusions, not passes.

The full workspace formatting check passed in `acos-runtime-status-format.log`.
The source/build snapshot proof records unchanged included source in both copies
before documentation updates, the exact build identity and this turn's scoped
delta from the previous source preview. The tested source manifest is retained
separately from the final documentation-refreshed export.

`test-results/runtime-status-release/final-export-provenance.json` binds the
full test log, tested source manifest and refreshed archive/checksum companion.
Only the reviewed verification documents change after the tested snapshot; all
application, configuration and test source hashes remain identical. The final
roundtrip contains the same 1,384 source files and preserves the original index
and HEAD. This source-only preview does not carry `.git`, installed dependencies,
runtime data, local environment files, build output or test evidence.

## Remaining scope

- This installed-source checkpoint supersedes the earlier full source count;
  the [publication preview](2026-09-28-publication-review.md) remains historical
  proof of its own source state. Neither is clean exact-commit or remote-CI proof.
- The subsequent [emergency boundary audit](2026-09-28-emergency-locale-boundary.md)
  corrected an initially suspected display gap: the original Turkish global
  emergency-transition summaries are source audit records, excluded by current
  reachable expert/task query scopes. The active controls already use translated
  copy. A new regression verifies immediate stopping even when the language file
  is invalid; it adds no language read to the stop transaction. Native-language
  acceptance remains open.
- Internal model instructions and original user/provider/native diagnostic text
  must be distinguished from new application-authored display messages. A text
  search alone does not establish complete localization or a missing user flow.
- Native-speaker review, physical phone/private HTTPS, native PostgreSQL,
  containers, full secret/history scanning, exact-commit remote CI and real
  24-hour endurance remain subject to the existing explicit limitations in
  [release readiness](2026-09-27-release-readiness.md).

No staging, commit, push, publication, credentials/account changes, paid inference
or external-tool installation was performed.
