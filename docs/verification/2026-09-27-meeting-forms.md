# Project meeting forms — 2026-09-27

Goal 7 remains active. This checkpoint follows the [meeting turn receipt work](./2026-09-27-meeting-turns.md). It covers the meeting interface and ordinary browser drafts; it does not establish publication readiness for the whole product.

## Changes and design

- Added selected-language meeting packs for Turkish, English, German, Russian, Simplified Chinese, Traditional Chinese and Arabic. Controls, states, validation, errors and draft recovery use the selected pack. Source meeting text remains original.
- Applied the Apple design skill's `entering-data.md > Best practices` and `feedback.md > Best practices`: visible labels, field-associated validation, explicit status, retained input and an actionable storage warning. Phone controls are at least 44 px high, long content wraps, and layout uses logical directions for Arabic. This is an implementation review, not Apple certification.
- Replaced the remaining meeting forms with the shared RHF/Zod submit boundary and shared selects. An unavailable stored owner stays visible until explicitly corrected. Controlled owner registration prevents a button's string value from replacing the numeric owner ID on blur.
- Added bounded tab-local session drafts for creation fields, participants, selected meeting, transcript prompt, decision/action text and owners, and closing summary. Exact draft whitespace is preserved across view changes and reloads. Delayed responses clear only their matching submitted draft.
- Corrupted draft storage requires review before clearing. Failed writes keep editable text in memory and block dispatch until storage works. Draft review defaults to cancel, restores focus, and preserves pending turn identities and server records.
- Background read failures preserve last-good records and drafts, identify the snapshot time, and disable writes until a read-only retry succeeds. A missing language asset offers localized reload.

## Verification

| Check                                     | Result                                                     |
| ----------------------------------------- | ---------------------------------------------------------- |
| Full source/server suite                  | 836 total: 831 passed, 0 failed, 5 skipped; 643.5 seconds  |
| Full Chromium suite                       | 295 passed, 0 failed; 11.1 minutes                         |
| Workspace types and all production builds | Passed                                                     |
| Final frontend types, build and bundle    | Passed after the language-asset/long-content follow-up     |
| Final focused Chromium suite              | 28 passed, 0 failed; 1.6 minutes, against the final build  |
| Production dependency audit               | No known vulnerabilities found                             |
| Production dependency license policy      | Passed                                                     |
| Repository formatting and whitespace      | Passed on final code; final report formatting also checked |

The broad browser run used the preceding production build. The final follow-up makes the main meeting boundary await both the form and recovery language assets, localizes numeric character/reply counts, and wraps long source identities. That follow-up receives a fresh frontend build, type/bundle checks and the focused Project Studio/meeting suite; the broad browser suite is not claimed to have run against those final changes. Overlapping focused counts are not added to the broad total.

The five source skips are four native PostgreSQL checks without `DATABASE_URL` (advisory ownership, receipt/reconciliation races, heartbeat lock ordering and cross-connection file locks), plus one Windows symbolic-link test denied with `EPERM`. None is counted as a pass. API/schema generation and clean PGlite migration results belong to the preceding checkpoint; this UI phase did not change the API or database schema.

Completed focused evidence:

- Nine source tests passed for seven-language key/placeholder parity, distinct Chinese scripts, exact draft round-trips, project/meeting isolation, corrupted/blocked/no-op/oversized storage, and the existing immutable turn intent/recovery contract.
- Seven language browser cases passed for touched validation, error association, first-error focus, retained creation fields and participant/owner selections across view changes/reload, successful decision submission with the correct owner, Arabic 320 px RTL, both themes, 44 px actions and no viewport overflow.
- Focused browser cases passed for corruption review/cancel, pending-intent preservation, blocked storage and recovery, stale detail retention/read-only retry, missing language reload, unavailable-owner correction, pending duplicate prevention and failed-write retention. The existing complete Project Studio flow initially needed its status assertion scoped to the meeting header because action status is now visibly labeled too; the final full suite includes that correction.
- Workspace types and all production builds passed.
- Selected-language transfer is 1238.1 KiB raw / 365.7 KiB gzip. The old 372,000-byte gzip limit failed. After unused copy and silent owner coercion were removed, this feature's measured increase is about 4 KB over the preceding checkpoint; the explicit ceiling is now 376,000 bytes. Raw/per-asset limits are unchanged. All meeting packs total 29.6 KiB raw / 12.3 KiB gzip, with separate 50,000/22,000-byte ceilings. This is a documented allowance change, not a claim to pass the old ceiling.

English dark and Arabic 320 px light form/record captures were visually inspected. Source fixture text remains Turkish by design. Synthetic composition/Enter checks are not native IME acceptance. Viewport and accessible-name checks are not physical-device or screen-reader acceptance.

Evidence is local under `%TEMP%/acos-meeting-locales-*.log` and ignored `test-results/meeting-locales-*` directories. These are local test outputs, not portable release attestations.

## Remaining work

Meeting creation, standalone transcript/decision/action writes, action updates and completion still lack the start command's durable identity/recovery contract. Lost acknowledgments for those commands require inspecting server records before another submit. Corrupted turn-intent review, an inbox for intents whose meeting is missing, paged history and compact receipt retention remain open. See [the meeting contract](../meeting-turns.md).

Other Goal 7 work remains, including Operations localization/design, older activity history, remaining provider/API/playbook copy and durable Browser/Terminal command receipts. Native PostgreSQL multi-connection/process-restart, Docker, physical-phone private HTTPS, Safari, native IME, screen-reader, native-speaker, POSIX and real 24-hour acceptance have not been established. The [phone access guide](../mobile-access.md) documents a private HTTPS route and a self-managed alternative; it is not evidence of a real phone connection.

No paid provider request, installation, commit, push or publication was performed. Goal 7 is not complete.
