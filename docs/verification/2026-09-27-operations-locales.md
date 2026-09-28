# Operations presentation and reconciliation — 2026-09-27

Goal 7 remains active. This checkpoint follows [durable manual meeting commands](./2026-09-27-meeting-commands.md). It does not certify the whole product for release.

The mounted-room recovery limitations below describe this historical checkpoint. The subsequent [durable Operations recovery report](./2026-09-27-operation-recovery.md) records the exact-read API and same-tab reload recovery follow-up.

## Changes

- Global and project Operations use independent lazy packs for Turkish, English, German, Russian, Simplified Chinese, Traditional Chinese and Arabic. Known API states have translated labels; unfamiliar states retain their original identifier. Counts, durations, costs and timestamps follow the selected language, with an explicit `Europe/Istanbul` timezone. Source names, roles, model/tool IDs, action text and operator notes are preserved.
- A failed selected-language asset shows localized reload guidance before mounting Operations controls or its stream. A failed snapshot or instance refresh retains last good data and its age while disclosing the failure. Initial unavailable lists do not appear empty. Window limits and truncation are visible.
- Health samples remain global fleet evidence inside a project. Full minute coverage is separate from healthy minutes and from a real 24-hour endurance run. Missing samples remain unknown. UI truth labels derive from structured backend and transport state, not pretranslated labels embedded in the data model.
- Apple HIG principles guide readable grouping, retained input, explicit feedback, cancel-first confirmation and focus restoration. Phone summaries use two columns; team lanes precede health and mission history. Long source IDs wrap. The phone inspector opens on the appropriate side for Arabic, traps focus and returns it to its opener. If the opener disappears after reconciliation, focus returns to the project heading.
- Reconciliation uses React Hook Form, a real Zod schema and the shared validated form. Decision and a trimmed 1–2,000-character note are required. Duplicate submission and dismissal are blocked while pending. An uncertain reply freezes the exact submitted decision and note; a successful read must confirm eligibility before an explicit identical retry. A recorded decision remains immutable and never replays the original external operation.
- Open review keeps its selected receipt/evidence when bounded background data omits it. Async completions are scoped to their original project and receipt. A same-decision response with a different earlier note is displayed as recorded evidence without claiming that the new note was saved. Drafts and uncertainty survive dialog reopening while the room remains mounted.

## Review and verification

The independent source review found two substantive races: a fresh eligible read could enable a changed intent while an earlier request remained unresolved, and bounded snapshot eviction could close the dialog and discard input. Frozen submitted input, pinned selection and scope checks address both; the focused reviewer reported no further significant findings in the revised dialog/room files. This was source review, not an additional test run.

| Check                                   | Result                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Full source/server suite                | 851 total: 846 passed, 0 failed, 5 skipped; 677.0 seconds                                                       |
| Final focused Operations source checks  | 28 passed, 0 failed; 2.1 seconds                                                                                |
| Full Chromium suite                     | 320 passed, 0 failed; 11.6 minutes, before the final summary typography change                                  |
| Final focused Operations browser suite  | 18 passed, 0 failed; 41.0 seconds on the final rebuilt artifact                                                 |
| Workspace types / all production builds | Passed; final full workspace build exited zero                                                                  |
| Format / audit / licenses / diff        | Full format, production audit, license policy and diff check passed; final report formatting checked separately |
| Selected-language bundle                | 1271.8 KiB raw / 374.8 KiB gzip; passed                                                                         |

Earlier focused verification passed 27 source checks and 18 Chromium scenarios. The final enum-label test separately passed with the other three copy tests. Browser fixtures cover both Operations routes in all seven locales at 320px, preserved original model IDs, Arabic direction, inspector/confirmation focus, required-field focus, no horizontal overflow, a 44px reconciliation control, lost-after-commit replies, read-only recovery without replay, immutable opposite decisions, in-flight snapshot eviction, language-asset failure, stale data and light/dark presentations. They use local API doubles and do not call a paid provider or perform an external action.

The first expanded browser run exposed selectors that matched a hidden desktop inspector or duplicate source labels. Scoped region selectors corrected these without removing behavioral assertions. The focused 16-test run then passed; two additional race scenarios produced the 18-test run. Canonical API enum review added `starting` and `planning` labels; a new test checks every canonical state in each language.

Bundle limits are explicitly revised from 1,300,000 to 1,310,000 raw bytes and from 380,000 to 386,000 gzip bytes for selected Operations translations and guarded reconciliation. Each selected language contributes one pack to the transfer total. All seven Operations packs also have independent 90,000-byte raw and 36,000-byte gzip aggregate limits. Existing per-asset, media and other locale-family limits remain unchanged. This checkpoint does not claim to pass the previous total ceilings.

The full source run preceded the final compact phone summary, team ordering, two canonical labels and health-description wording. The 28 focused source checks and replacement full browser run cover these follow-ups. That full 320-scenario run preceded one final summary typography adjustment; the focused Operations browser suite covers the rebuilt artifact. All Operations packs total 81.2 KiB raw / 30.4 KiB gzip. The selected-language delta from the meeting checkpoint is about 15.5 KiB raw / 4.5 KiB gzip.

The original full browser attempt stopped after 295 completed scenarios without a terminal result. The missing process handle and process inventory confirmed it had stopped before restarting; it is not counted as a passing full run. English and Arabic phone screenshots were visually reviewed, prompting the final summary-label readability adjustment. Final screenshots were reviewed again: the English Intervention label fits without splitting, Arabic remains right-to-left, and the two-column metrics precede the team and history.

Evidence is local under `%TEMP%/acos-operations-*.log` and ignored `test-results/operations-*` directories. These are local outputs, not portable release attestations.

API regeneration checked 238 generated-file fingerprints and changed none. A clean local migration completed against PGlite. The release-readiness audit also checked 79 local documentation links with no missing targets. GitHub CI now includes the previously omitted native sampler-ownership and file-lock checks; the configured steps remain unverified until run against PostgreSQL.

## Limits and continuing work

- Reconciliation drafts and uncertain input are held in memory only while the room is mounted. Navigation, reload and tab-crash recovery still need durable intent storage and explicit review. The existing bounded project snapshot is the only receipt-read source in this flow; a missing receipt blocks retry and cannot prove absence. An exact scoped receipt read remains a backend follow-up.
- Four native PostgreSQL tests and one Windows symlink test were skipped. The symlink setup returned `EPERM`. Native PostgreSQL and Docker acceptance remain unverified: this shell has no `psql` or Docker command and no `DATABASE_URL`. PGlite fixtures cannot prove independent native connections or process restart recovery. No native dependencies were installed.
- Physical phone/private HTTPS, Safari, actual 200% browser/text enlargement, native input methods, assistive technology and native-speaker acceptance remain outstanding. Chromium viewport checks do not replace them. [Phone access](../mobile-access.md) uses the existing web UI over private HTTPS; there is no custom mobile app or required paid service. Local drafts do not synchronize between devices.
- Model-turn recovery inboxes, durable operator recovery on other routes, paged history, retention and the remaining release audit continue under Goal 7. Connections/Settings already has seven-language controls; the older meeting report's remaining-localization sentence is historical. No real 24-hour endurance claim is made.
- No API/schema, credential, external-service or publishing change was required by this checkpoint. No commit, push or publication was performed.
