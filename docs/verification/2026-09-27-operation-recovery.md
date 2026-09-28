# Durable Operations reconciliation recovery — 27 September 2026

**Local feature checkpoint verified.** The [implementation plan](../superpowers/plans/2026-09-27-operation-recovery.md) has an integrated recovery UI and completed local gates. The full Goal 7 remains active; this report does not certify the repository for public release.

## Implemented so far

- Added authenticated `GET /api/tasks/:taskId/operations/receipts/:receiptId`. It validates the root project and receipt identity, rejects unsupported queries, checks descendant scope, and reads by exact identity independently of history windows and the 200-receipt cap. Missing scope/receipt returns 404 and non-root scope returns 409. Responses use `Cache-Control: no-store`.
- The endpoint returns the existing safe receipt projection and its original immutable reconciliation audit when recorded. It excludes prompts, task briefs, argument hashes, raw results, lease tokens and host details. Audit text is selected only for this exact read, not for the bounded project list. GET does not reconcile or replay an effect. Existing reconciliation writes are unchanged.
- OpenAPI and generated clients include the additive read endpoint and audit envelope. The note description explicitly states the existing 2,000-byte UTF-8 bound.
- Added strict session-storage helpers for ordinary drafts and one unresolved decision per project. Saved input binds project, receipt and a local identity. It is normalized before dispatch preparation; damaged/unsupported records are retained. Failed or silently dropped storage cannot prepare an intent. Acknowledgement clears only the matching intent and submitted draft revision, preserving newer drafts and replacements.
- Connected ordinary draft saving, saved-intent dispatch, exact read-only review and an independent project recovery panel. The panel remains visible even when the project snapshot is unavailable or the receipt falls outside bounded history. Same-tab reload preserves input; closing a tab or switching devices is not a supported backup mechanism.
- Retries require an explicit fresh exact read and resend the saved normalized decision/note. Dispatch checks storage again immediately before writing. Recorded original notes, actor IDs and timestamps are shown separately from the attempted note. Clearing local recovery requires explicit acknowledgement and never changes server work.
- Added damaged-data review, safe local clearing, seven-language recovery copy and UTF-8 byte validation/counters. Client and server agree on the 2,000-byte note bound. Source evidence is preserved unchanged. Dialogs retain cancel-first focus, busy dismissal protection, 44-pixel action controls and RTL layout.

## Historical foundation checkpoint (before UI integration)

- Nine focused source/API/storage checks passed, zero failures, 17.3 seconds. They include the existing project projection and read-route regressions.
- The new API tests first failed on the absent export/endpoint. Valid test fixtures then needed the actual `lost` attempt state, a replay key and terminal timestamp; database constraints correctly rejected the invalid fixture setup. With valid rows, the exact read retrieved an old receipt hidden behind 201 newer receipts, rejected unrelated/child/missing project scopes, preserved the original audit and left both receipts and activity rows unchanged.
- Five storage tests cover normalization, independent project scope, immutable pending input, stale acknowledgement, newer draft preservation, retained damaged records, failed/silently dropped writes and the CJK byte boundary (666 versus 667 three-byte characters).
- Workspace typecheck and all production builds passed. A second API generation left all 239 generated-file fingerprints unchanged. The bundle gate passed at 1271.8 KiB raw / 374.8 KiB gzip. Source and documentation formatting are checked separately.
- Local evidence: `%TEMP%/acos-operation-recovery-api-red.log`, `acos-operation-recovery-api.log`, `acos-operation-recovery-storage-red.log`, `acos-operation-recovery-storage.log`, `acos-operation-recovery-focused.log`, `acos-operation-recovery-types.log` and `acos-operation-recovery-codegen.log`.

## UI integration verification

- The first two reload/browser tests failed against the previous build (missing recovery entry and lost ordinary draft), then passed after integration. The byte-boundary test and new network helper tests also failed first, then passed.
- Initial integrated artifact: 23 Operations Chromium scenarios passed in 55.0 seconds. They cover all seven languages at 320 pixels, original evidence and focus, lost-after-commit reload recovery outside history, exact retry, stale-intent dispatch rejection, storage write failure, damaged drafts and Arabic recovery when the project is unavailable. English and Arabic phone screenshots were visually inspected; no native-device claim is made.
- Four backend/read-route tests passed in 16.8 seconds. After review fixes, 14 focused source tests passed. Final workspace typecheck and production builds passed.
- Full source suite completed: **862 tests, 857 passed, zero failed, five skipped**, 648.3 seconds. Four skips require native PostgreSQL; one Windows symlink setup returned `EPERM`.
- Full Chromium completed on the final rebuilt artifact: **327 passed, zero failed**, 12.2 minutes. This includes 25 Operations scenarios and both review regressions. Damaged companion drafts remain reviewable after acknowledging the valid recorded decision, and explicitly cleared intent cannot resurrect from an old dialog.
- Final formatting, production dependency audit, license policy, clean PGlite migration and bundle checks passed. Fresh API generation compared 239 file fingerprints: zero changed and zero removed.
- The final UI measured **1284.7 KiB raw / 378.1 KiB gzip** for code with one selected pack per surface. All Operations packs total 96,471 raw / 35,537 gzip bytes (94.2 / 34.7 KiB). The prior budget correctly failed. Explicit ceilings increased from 1,310,000/386,000 to 1,320,000/389,000 bytes and Operations aggregate raw from 90,000 to 100,000 bytes; its 36,000-byte gzip cap and other individual/media/family limits remain unchanged. This is a reviewed feature allowance, not a claim of zero cost.

## Focused review and repairs

A fresh read-only reviewer examined the backend, storage, UI and API contracts. Two Important findings were accepted: cleared intent could resurrect from dialog memory, and a damaged companion draft could prevent clearing a valid intent. Reproducing tests failed first. Storage now owns the active identity after a successful read; only unsaved text uses the memory fallback. Damaged drafts remain visible and preserved while a valid intent can be acknowledged independently.

The reviewer also found that the exact-read parser accepted `in_progress` instead of the server's `running` state. It was regraded Important because an actual server response must remain readable during recovery; the new contract-state test failed before the correction. No findings were declined, and no minor issue was deferred. Both full suites passed after the fixes.

Local UI/review logs: `%TEMP%/acos-operation-recovery-ui-red.log`, `acos-operation-recovery-ui.log`, `acos-operation-recovery-ui-source.log`, `acos-operation-recovery-ui-api.log`, `acos-operation-recovery-review-source-red.log`, `acos-operation-recovery-review-contract-red.log`, `acos-operation-recovery-review-ui-red.log`, `acos-operation-recovery-review-source.log`. Full-run logs use `acos-operation-recovery-all-source.log` and `acos-operation-recovery-all-ui.log`.

Final gates use `%TEMP%/acos-operation-recovery-final-{build,format,audit,licenses,migrate,bundle,codegen}.log`; generation fingerprint counts were also collected from terminal output. Ignored browser artifacts are under `test-results/operation-recovery-release/`. These are local working-tree results, not a clean-commit or remote CI attestation. A refreshed path-only audit checked 1,216 candidate paths with zero sensitive-path matches and no historical paths in the specifically checked runtime-data directories. It does not replace a full secret-content/history scan.

The prior [Operations presentation checkpoint](./2026-09-27-operations-locales.md) remains historical evidence. Its 320 browser checks do not cover the new recovery implementation. Native PostgreSQL, Docker, physical-phone HTTPS and language/assistive-technology acceptance remain unverified. No installation, credential change, commit, push or publication was performed.
