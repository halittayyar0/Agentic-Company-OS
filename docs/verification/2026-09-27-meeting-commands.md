# Durable manual meeting commands — 2026-09-27

Goal 7 remains active. This checkpoint follows [meeting forms and drafts](./2026-09-27-meeting-forms.md); it is not a whole-product release attestation.

## Changes

- Migration `0024_project_meeting_commands` stores immutable, compact command outcomes. Every manual meeting write requires a UUID: creation, metadata/roster/cancellation, founder note, decision, action, action update and completion. The domain change and receipt commit in one transaction under the existing runtime-control lock. Unexpected faults roll back both. Accepted business rejections remain rejections on replay.
- Identity binds normalized input, kind, project, meeting and action scope. A changed payload conflicts; an identical retry returns the original HTTP status and body before consulting changed/deleted domain records. A scoped receipt GET never writes. Compact receipts contain identifiers and fixed errors, with a 2048-byte ceiling and no copied meeting text.
- The API now returns `ProjectMeetingCommandResult` for manual writes. Current details are read through GET. OpenAPI and generated clients describe the UUID requirement and compact responses. Metadata PATCH cannot bypass start/completion, and title-only edits preserve the roster. Explicit action tracking remains available after meeting closure.
- The browser saves exact input before sending, keeps one unresolved manual command per project, validates returned scope, and pauses new changes while an outcome is uncertain. Recovery survives same-tab reload and remains visible without a listed meeting. Result checks never dispatch; a missing receipt enables an explicit retry with the original identity. Review clears only a matching submitted draft. Newer edits and rejected drafts are retained.
- Damaged local command data is kept until review/copy and explicit clearing. Storage failures send nothing. Request validation also enforces the API's byte limit for non-Latin text, and timestamp length. A stale acknowledgement cannot release a replacement identity.
- Creation now saves a draft first; starting its model round is an explicit second action. Recovery controls, review, failure and storage states use all seven language packs. The shared Apple HIG approach continues: explicit feedback, retained input, cancel-first review, restored focus, phone-sized controls and Arabic RTL. Long dialog action labels wrap.

## Verification ledger

| Check                                            | Result                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| Full source/server suite                         | 842 total: 837 passed, 0 failed, 5 skipped; 690.7 seconds                  |
| Final focused meeting source/API/migration suite | 31 passed, 0 failed; 25.2 seconds                                          |
| Full Chromium suite                              | 307 passed, 0 failed; 11.7 minutes, before the final focused follow-ups    |
| Final Project Studio browser suite               | 61 passed, 0 failed; 3.1 minutes, on the final production build            |
| Workspace types and all production builds        | Passed; workspace types and all production builds                          |
| API generation                                   | Passed; second generation produced identical files                         |
| Database generation                              | Passed; no schema drift after migration 0024                               |
| Format / audit / licenses / diff                 | Passed; full format check, production audit, license policy and diff check |
| Selected-language bundle                         | 1256.3 KiB raw / 370.3 KiB gzip; passed                                    |

The full source and Chromium runs preceded the final browser byte/timestamp checks, stale-acknowledgement return guard, dialog label wrapping, readable localized input summaries and OpenAPI description/minimum-property refinements. The final focused source and browser checks cover these follow-ups; the full 307-test run is not claimed against the final rebuilt artifact. Test doubles are local: no real model call, paid service or external action was used.

The first API test proved the missing-identity defect against the old route. Expanded tests caught an optional/default interaction that could clear a roster on a title-only PATCH; the update now uses a genuinely optional roster. A forced receipt-insert failure verifies complete rollback and safe retry. Tests also cover two router instances, identical concurrent creation, changed-input/kind conflicts, immutable rejections, later edits surviving an old replay, bulk completion without duplicates, read-only observations and retained identities after deletion.

Browser evidence covers seven-language lost replies and reloads, receipt observation without replay, exact-identity retry for creation, preservation of newer drafts, explicit model start after draft save, rejected completion, storage failure and damaged-record review. Initial legacy assertions were updated to require the new UUID and compact outcomes. Two final phone-size assertions initially measured the dialog during its opening transition (about 42.7 px). They now wait for settled geometry while retaining the 44 px minimum, and passed in English, German and Arabic. Native-device, native-input-method and screen-reader acceptance are not established by Chromium emulation.

The gzip allowance is explicitly revised from 376,000 to 380,000 bytes for exact-intent validation, recovery review and localized readable summaries. The measured delta from the prior checkpoint is about 4.6 KiB gzip. Raw/per-asset ceilings remain unchanged; all meeting packs total 44.0 KiB raw / 16.4 KiB gzip, below their unchanged 50,000/22,000-byte aggregate limits. This does not claim to pass the previous gzip ceiling.

English and Arabic final review screenshots were visually inspected: original source text remains intact, field labels are localized, and phone dialogs fit without horizontal overflow. Final client storage and seven-pack parity checks also passed (10 tests).

Evidence is local under `%TEMP%/acos-meeting-commands-*.log`, `%TEMP%/acos-meeting-command-client-red.log`, and ignored `test-results/meeting-commands-*` directories. These are local outputs, not portable release attestations. API upgrades and retention are documented in [meeting turns and recovery](../meeting-turns.md).

## Limits and continuing work

- Four source checks need a real PostgreSQL database: advisory ownership, operation-receipt races, production heartbeat/recovery ordering and cross-connection file locks. One Windows symlink test skipped because symlink creation returned `EPERM`. PGlite two-router tests do not prove independent native PostgreSQL connections or process restart recovery.
- Docker and `psql` are unavailable on the current shell path. Native PostgreSQL/Compose acceptance remains unverified. No native dependencies were installed.
- Physical phone/private HTTPS, Safari, native input methods, assistive technology and native-speaker acceptance remain outstanding. [Phone access](../mobile-access.md) uses the existing web UI and private HTTPS; no custom mobile app or required paid service was added. Browser-local drafts do not sync between devices.
- Corrupted or unlisted **model-turn** intents still need their own inbox/review; the new manual-command inbox does not cover that separate protocol. Paged history, retention, broader Operations/settings localization and the remaining release audit continue under Goal 7. No real 24-hour endurance claim is made.
- No commit, push, publication, real credential change or paid operation was performed.
