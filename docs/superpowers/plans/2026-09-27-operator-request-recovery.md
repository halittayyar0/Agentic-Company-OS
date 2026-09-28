# Durable operator request recovery implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make Terminal and Browser operator actions durably identifiable, non-repeating and inspectable after lost replies.

**Architecture:** An additive receipt table and transactional reservation/effect/completion service gate existing executors. Public receipts expose safe metadata; authenticated encrypted terminal output is recoverable with the existing runtime key. Browser leases/pixels remain ephemeral and never become recovery authority.

**Tech Stack:** Existing TypeScript, Express, Drizzle/PostgreSQL/PGlite, Node crypto, React, selected-language packs and Playwright. No new package or external service.

**Spec:** [Operator request recovery](../specs/2026-09-27-operator-request-recovery.md).

## Global constraints

- Preserve existing working-tree changes; the local working branch is `codex/oss-operator-recovery`. Do not commit unrelated work or publish.
- Preserve all seven languages, original command/text whitespace, Arabic RTL and 44px controls.
- Accepted identities never execute twice. GET/reload/clear never executes anything. Check exact ownership before every effect and completion.
- No plaintext sensitive payload in receipts or logs; no private browser lease/screenshot in a receipt. Use the existing runtime key for HMAC and encrypted terminal results.
- Run tests only against isolated data. Do not install software, change credentials, send paid model calls or run stored user commands.
- Do not rebuild the production UI while a browser suite is using it, or regenerate API files during importing source tests.

## Review focus

- Key rotation and corrupt ciphertext must preserve completed execution without exposing raw exceptions or enabling another dispatch.
- A stop/resume or browser-session replacement between reservation and actual effect must fence out the older request, including compound commands and remote worker delivery.
- An HTTP timeout after effect but before snapshot/receipt persistence must remain unknown; telemetry failure is not an admission substitute.
- Reused UUIDs with changed authority, scope, input order or source whitespace must not get another owner's receipt/output.
- Legacy or damaged local records and late replies must neither trap recovery permanently nor erase a newer request/draft.

## Task 1 — durable admission and encrypted result core

**Files:** new `lib/db/src/schema/operator-requests.ts`, migration `0025_operator_requests.sql` and generated metadata; new `artifacts/api-server/src/lib/operator-requests.ts` and `operator-requests.test.ts`; new `lib/db/src/migration-0025.test.ts`.

**Interfaces:** `reserveOperatorRequest({requestId,agentId,kind,input})` returns either a private new owner handle or an existing public receipt; `beforeOperatorEffect(owner)`, `completeOperatorRequest(owner, outcome)`, `failOperatorRequest(owner, code)` and `readOperatorRequest(agentId, requestId)` implement the spec. Only a newly admitted owner handle can gate executor work. Use database-clock deadlines (180 seconds Terminal, 60 seconds Browser); reads do not mutate expiry. Fixed metadata includes terminal exit code/success/duration and encrypted result availability.

- [x] Add failing migration and service tests for retained identities, bounds, duplicate admission, changed input/scope, output privacy/correlation, expiry, stop/resume and stale completion. Observe RED before implementation.
- [x] Implement schema, generate the additive migration/snapshot, then implement the service. Observe focused GREEN and workspace type checking. Keep routes unchanged until Task 2 consumes the verified service.

## Task 2 — actual effect admission and HTTP contract

**Files:** `artifacts/api-server/src/routes/vm.ts`, `lib/vm/sandbox.ts`, `lib/vm/browser.ts`, `lib/runtime-control-{api,protocol,worker}.ts`, `lib/runtime-security.ts`, `lib/api-spec/openapi.yaml`, generated API clients/validators and focused HTTP/runtime tests.

**Interfaces:** Effect routes require request UUIDs and return receipt plus optional live result. Exact authenticated GET uses agent/request scope. Internal browser delivery transports the private owner only in its encrypted in-memory envelope and validates it at the worker's actual effect hook. Host-shell execution receives a before-effect guard. Runtime security requires the existing key for durable operator mutations; ephemeral PGlite is explicitly development-only.

- [x] Reproduce no-ID/duplicate/changed-scope/stop/late-owner effects with failing HTTP and worker tests. Include controlled host/sandbox commands and actual local browser input counts in disposable fixtures.
- [x] Wire reservation before effect, exact hooks at execution, correlated completion and conservative unknown errors. Regenerate API code only with no dependent runner active.
- [x] Add migration/deployment notes and dedicated native PostgreSQL races. Verify focused API/runtime tests and types; preserve unknown native checks as explicit skips.

## Task 3 — seven-language browser and terminal recovery

**Files:** `src/lib/terminal-session.ts`, `src/lib/browser-workbench.ts`, `src/components/vm/terminal-panel.tsx`, `src/components/browser/use-browser-workbench.ts`, `browser-workbench.tsx`, computer/browser copy families, and UI/helper tests.

- [x] Reproduce lost response/reload, legacy records, damaged storage, missing/rotated output, same-ID mismatch, unmount, newer drafts and stale owners against production fixtures.
- [x] Persist versioned identity with readback before dispatch. Bind late completion to original data. Expose exact receipt checks, output availability and explicit cancel-first local review in all seven languages. Browser recovery never restores an old private lease.
- [x] Run focused source/UI checks and inspect English and Arabic narrow screenshots, keyboard focus, output scrolling and light/dark states.

## Task 4 — review and final release gates

- [x] Obtain one fresh focused review after the integrated feature. Re-grade by user effect, repair Important/Critical findings once with reproducing RED→GREEN tests, and record deferred minors/rulings.
- [x] Run full source and full production UI suites on the final code, types/build, format/diff, audit/licenses, bundle, generated API stability and clean migration. Do not replace absent native/container/physical-phone proof with fixtures.
- [x] Update Browser/Terminal contracts, localization, upgrade/key-backup instructions, changelog, evidence and broad release audit. Goal 7 stays active while other requirements remain.

## Ledger

Task 2: complete locally, native proof unavailable — operator mutations now use a separate router mounted before live-agent lookup, so exact authenticated receipts and matching replay survive agent deletion. Effectful bodies require UUIDs; generated responses wrap receipt and optional live result. Private worker authority is transported only inside the existing encrypted envelope and checked at actual effects. Host-shell creation/launch and Browser release/close/takeover boundaries are guarded. Every PostgreSQL runtime now requires the existing control key; migration/backup/deployment notes and a disposable-only native two-process CI race gate were added. Final focused evidence: 33 tests, 32 passed, zero failed, one explicit native PostgreSQL skip in `%TEMP%/acos-operator-task2-final.log` (29.9 seconds); API types passed in `%TEMP%/acos-operator-task2-types.log`. API generation passed in `%TEMP%/acos-operator-api-generation.log`. Initial HTTP, host-shell, cleanup, worker-in-transit and durable-key RED tests preceded their fixes. No real PostgreSQL or remote CI run is claimed.

Task 2 test corrections: public Browser control deliberately masks the private lease. Two new test teardowns incorrectly attempted cleanup with that masked value, leaving their already-failed browser processes open; only the identified test child processes were stopped, and fixtures now use their isolated shutdown path. A duplicate-input assertion also counted asynchronous multiline DOM events before their network reports drained. The fixture now serializes event reporting and waits for a coordinate-bound page marker before/after replay; the full focused group then passed. These were fixture defects, not evidence of a production replay. Worker acknowledgement/error response bodies are released after use.

Task 3 next: frontend integration is intentionally still pending. Current full workspace type checking fails on eight missing-request-ID call sites in Browser/Terminal UI; the API, scripts and mockup packages pass. Do not deploy this intermediate contract or use earlier full-suite/build results to attest it. Add versioned local identity/readback, exact late-response correlation, receipt validation/query/review, seven-language copy and updated production browser fixtures before final review and full release gates.

Task 1: complete — initial missing-service/migration RED and deleted-agent regression RED were repaired; final focused migration/service run passed both tests (no skips), including authentic ciphertext swapped across requests, invalid key/input, missing runtime state, and cleanup during stop. Workspace types passed. Logs: `%TEMP%/acos-operator-request-core-final.log` and `%TEMP%/acos-operator-request-core-final-types.log`. No commit or publication; native PostgreSQL races and HTTP/executor integration belong to Task 2. Previous turn classified **progress**: the deleted-agent effect fence changed authoritative code and passed its regression and workspace types.

Task 1 progress: The additive migration and encrypted receipt service are implemented but not connected to HTTP or executors yet. Focused migration/service tests passed (2 tests, no skips) after the deleted-agent regression was observed RED and fixed GREEN. Every effect now rechecks the agent under a row lock; effect/completion/failure writes also predicate on the original owner and live database deadline. Workspace type checking passed. Evidence: `%TEMP%/acos-operator-request-deleted-agent-red.log`, `%TEMP%/acos-operator-request-deleted-agent-green.log`, and `%TEMP%/acos-operator-request-owner-fence-types.log`. Task 1 remains in progress; this is not integrated or native PostgreSQL proof, and prior full meeting-inbox gates do not verify these new changes.

Previous goal turn: **progress** — full meeting-inbox gates completed (862 source passes, five environment skips; 339 Chromium passes), API fingerprints matched, evidence was updated, and the secret-scan workflow was prepared without an Action license dependency. The portable local scanner authorization remains pending and does not block this work.

Pre-flight: Task 1 produces private owner handles and public projections consumed by Task 2; Task 3 must never store/receive the private owner. Task 2 changes generated request/response types, so Task 3 and browser fixtures must deploy with it. Full integration, not the core alone, completes this plan.

Ruling: Keep the existing checkout and all uncommitted work, on a new local `codex/` branch — a new worktree from HEAD would omit the required uncommitted baseline — the cost is that final publication still requires an explicit reviewed candidate across the whole tree.

Ruling: Persist encrypted Terminal output but no Browser result/lease — output recovery is useful, while a saved browser lease would confuse history with current authority and persist sensitive pixels — lost/rotated keys make old terminal output unavailable and Browser recovery requires fresh observation/control.

Task 3 progress: versioned Browser/Terminal identity, verified storage readback, exact late-response correlation, selected-language receipt inspection and cancel-first Terminal review are implemented. Focused helpers passed 14/14; workspace types passed. Expanded production Chromium fixtures passed 52/52 in 2.0 minutes before a visual audit identified a contradictory unknown heading after a confirmed completion. Both surfaces reproduced that defect in `acos-operator-ui-complete-heading-red.log`; the corrective state display awaits its final green run. A same-ID changed-intent response defect was independently reproduced and repaired (`acos-operator-ui-late-red.log`, then the expanded green suite). Real phones/native acceptance remain unverified.

Ruling: Share a separate seven-language operator recovery pack between Terminal and Browser rather than duplicating the same messages — both use the same receipt states and privacy rules — cost if wrong: a small shared component to split later. The bundle gate initially counted all seven new packs as shared code; it now applies the existing one-selected-pack model and an explicit aggregate family cap (18,000 raw / 8,000 gzip bytes). The measured recovery feature adds about 11 KiB raw / 3.3 KiB gzip to the preceding checkpoint. Allocate 15,000/4,000 additional total bytes (1,345,000/396,000), leaving existing asset/media/family caps fixed; cost: that explicit additional transfer allowance, not a claimed performance optimization.

Previous intervening phone explanation was read-only and made no implementation progress. This continuation resumed the available frontend work instead of treating phone installation as a blocker. No commit, installation, credential change or publication occurred.

Task 3: complete locally — the final source helper group passed 14/14 and the rebuilt production Chromium group passed 52/52 (2.1 minutes), including all seven recovery languages, incomplete/rotated output, server lookup after reload, legacy records, changed-record clearing, exact same-ID late responses, current authority, focus and narrow RTL. The visual audit found and repaired contradictory unknown headings after recorded completion with two observed RED tests; both are green in the final group. Workspace types and production build pass. Selected-language bundle: 1307.4 KiB raw / 384.5 KiB gzip; operator packs total 11.8 / 5.4 KiB. Logs: `%TEMP%/acos-operator-task3-{source-final,ui-final,types-final,build,bundle-final}.log`. The one fresh integrated review is now in progress under Task 4; this is not the whole release gate or native-device proof.

Task 4 review: the single fresh integrated reviewer (`operator_recovery_final_review`) returned two Important findings and no Critical/Minor findings. Both severities stand because they can lose a user's unreviewed recovery data or execute effects after authority expires. The reviewer declined unrelated preserved work, native PostgreSQL/Docker/CI, physical-device/native-language/accessibility, secret/history, full UI runtime and 24-hour verification; those remain primary-owned release requirements, not passing review claims. No second review was requested.

Task 4 single repair pass: (1) three production UI regressions reproduced destructive Browser storage retry, Browser new admission overwriting an intervening record, and Terminal retry overwriting a newer saved command (`acos-operator-review-storage-red.log`). Raw-snapshot comparison now preserves these records until explicit review. The rebuilt focused Browser/Terminal suite passed **55/55** in 2.2 minutes (`acos-operator-review-ui-green.log`). (2) Five real filesystem regressions reproduced expired mutations after a held workspace lock (`acos-operator-review-file-fence-red.log`), and an actual browser drag reproduced failure to check authority between awaited effects (`acos-operator-review-drag-red.log`). Durable guards now revalidate under the file-lock transaction and at publication steps; drag checks each step and releases a held button on interruption. Four additional regressions showed expired requests creating an empty workspace (`acos-operator-root-fence-red.log`); guarded creation now rejects them. The final focused source group passed **34**, skipped **1 native PostgreSQL gate**, failed **0** (`acos-operator-review-source-green.log`). A transient unrestricted epoch check also blocked stopped-state readback; the final guard applies this check only to operator-guarded creation, and the existing stopped-state regression passes.

Task 4 native gate: extend the disposable-only PostgreSQL test with `DATABASE_POOL_MAX=1`, a successful actual file publication through the production guard factory, and a separate-connection advisory-lock/expiry race. This protects transaction reuse against nested-pool deadlock but remains skipped here; no native proof is claimed. Local API/worker/source and whole UI suites are being rerun on the final code. The API regeneration preserved **252/252** file fingerprints. Workspace production build, audit, license, clean PGlite migration and bundle gates pass; bundle is **1308.2 KiB raw / 384.7 KiB gzip** under the explicit 1,345,000/396,000-byte ceiling. Final English dark and Arabic light recovery screenshots were inspected and retained in `test-results/operator-reviewed-focused/`.

Continuation classification: the intervening phone explanation was read-only (**no implementation progress**). This continuation revalidated the worktree and resumed available code repairs and gates. The missing phone/native environments and pending scanner permission did not prevent development progress. No installation, paid call, credential change, commit or publication occurred.

Task 4: complete locally — final full source **891 total / 885 passed / 0 failed / 6 skipped**, 693.4 seconds; final full rebuilt Chromium **363/363 passed**, 13.6 minutes. Both original handles returned exit zero. Five native PostgreSQL checks and one Windows symlink fixture remain explicit skips. Workspace types/build, full format and diff checks, production audit/licenses, bundle, 252 unchanged generated API fingerprints and clean PGlite migration all pass. Final evidence and external exclusions are in `docs/verification/2026-09-27-operator-recovery.md`; the broad release audit and public contracts have been updated. No further review pass was requested. There were no deferred Minor findings in the focused review. The branch stays active for the larger Goal 7; no commit, publication or claim of a clean candidate was made.

Next scope is evidence-backed, not a new completion definition: the source-language follow-up confirms 15 Turkish authored role playbooks, shared handoff contracts and application-generated Terminal text. Older-history browsing/retention, the remaining route/visual/accessibility audit and native/deployment/public-candidate gates remain required. See `docs/verification/2026-09-27-source-language-follow-up.md`. This continuation is **progress**: changed production guards/storage behavior, added and passed reproductions, completed full current-code gates, and updated the requirement audit.
