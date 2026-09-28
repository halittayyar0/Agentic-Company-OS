# Project meeting turn recovery — 2026-09-27

Goal 7 remains active. This checkpoint implements durable identities for meeting starts and scopes form callbacks to their original meeting. It is not a claim that the complete meeting UI or the full product is ready for publication.

## Changes

- Migration `0023` adds retained request identities, database-clock deadlines and constrained outcome states. A missing start ID fails before side effects. Accepted IDs cannot be reused after project/meeting deletion.
- The founder message and reservation commit together. Shared runtime-control locking replaces process-local start counters; competing API router instances share the same meeting/capacity checks.
- Matching replays observe running/unconfirmed state or return the stored HTTP outcome. Changed input conflicts. The receipt GET is read-only, including for expired reservations.
- Provider admission and transcript persistence require the live request, open meeting and active agent lease. Late responses cannot reopen completed/cancelled meetings, write through expired/replaced leases or erase replacement ownership.
- Emergency stop invalidates existing meeting reservations. Removing the stop cannot revive a pending round's remaining participants. Already dispatched remote calls may still complete and incur model usage.
- The browser saves exact input and identity before POST. Reloads/checks never send again. Only a 404 permits explicit retry of the original identity. Recorded/unconfirmed outcomes require review before clearing the marker.
- Seven selected-language recovery packs cover pending, running, recorded, unconfirmed, missing, storage and validation states. Simplified and Traditional Chinese are separate. The main meeting form remains partly Turkish.
- Unsent drafts are separated by meeting in memory; delayed callbacks only clear a matching draft for their dispatched meeting. This is not yet reload persistence for ordinary unsent drafts.

## Verification

| Check                                 | Result                                                    |
| ------------------------------------- | --------------------------------------------------------- |
| Full source/server suite              | 832 total: 827 passed, 0 failed, 5 skipped; 633.3 seconds |
| Full Chromium suite                   | 283 passed, 0 failed; 10.1 minutes                        |
| Workspace types and production builds | Passed                                                    |
| API generation                        | Byte-stable                                               |
| Drizzle schema generation             | No changes required                                       |
| Clean PGlite migrations               | Passed                                                    |
| Production dependency audit           | No known vulnerabilities found                            |
| Production license policy             | Passed                                                    |
| Repository formatting and whitespace  | Passed                                                    |
| Selected-language bundle              | 1224.2 KiB raw / 361.7 KiB gzip; existing ceilings passed |

The broad runs include the final stop-release invalidation, response-scope validation, mixed-direction UUID display and navigation-race test. Only formatting and documentation changed while they ran. These were separate verification commands, not one combined `verify` invocation. Earlier focused counts below are not added to the broad totals.

The five skips are native PostgreSQL advisory ownership, receipt/reconciliation races, heartbeat lock ordering and cross-connection file locking without a configured database, plus one Windows symbolic-link test denied with `EPERM`. None is counted as a pass.

Completed before those runs:

- 18 focused source/API/migration tests passed before the final stop-release and receipt-validation additions. The initial migration fixture omitted a required task owner; after correcting that fixture, all 18 passed.
- 34 Project Studio Chromium tests passed before the final mixed-direction UUID and receipt-validation changes and the navigation-race test. These include seven recovery languages, 320 px Arabic, both themes, lost response, explicit same-ID retry, storage failure and receipt identity mismatch.
- Workspace types and full production build passed on the final source used by the broad runs.
- API code generation was byte-stable. Drizzle generation reported no schema changes.
- Clean PGlite migration command passed. This is not a native PostgreSQL migration run.
- Production dependency audit found no known vulnerabilities; dependency license policy passed.
- Selected-language transfer was 1224.2 KiB raw / 361.7 KiB gzip, within the unchanged 372,000-byte gzip ceiling. The seven new packs have separate aggregate ceilings of 25,000 raw / 12,000 gzip bytes.

English dark and Arabic 320 px light recovery captures were visually inspected. The panel wraps and its controls remain readable; the surrounding older meeting form still shows Turkish labels. Viewport simulation is not physical-phone acceptance.

Evidence is local under `%TEMP%/acos-meeting-*.log` and `test-results/meeting-ui/`, `test-results/meeting-full-ui/`. These ignored/temporary files are not portable release attestations. No paid provider calls, installation, commit, push or publication were performed.

## Remaining scope and environment limits

Creation, direct transcript/decision/action writes and completion still need durable recovery identities. Full meeting translation, touched form validation, reload-persistent drafts, last-good-data handling, history pagination and compact receipt retention remain open. Corrupted local intents and intents for meetings no longer listed need an accessible review/recovery inbox. The final response snapshot currently duplicates historical meeting text and survives deletion; see [the retention contract](../meeting-turns.md).

Native PostgreSQL multi-connection/process-restart tests, Docker, physical-phone private HTTPS, Safari, native IME, screen-reader, native-speaker, POSIX and real 24-hour acceptance are not established here. Separate in-process router instances on PGlite are not evidence of a native multi-process deployment. No `verified24h` claim is made.

Other Goal 7 work remains: Operations localization/design and its workbench URL, older activity history, remaining API/provider/source-playbook copy, and durable Browser/Terminal command receipts. The project-stop browser marker is still local.
