# Discoverable model-turn recovery

Continue Goal 7 after the Operations recovery release gates finish. Preserve the existing manual-command and model-turn protocols; no publication, installation or paid model calls.

## Verified gap

Before this implementation, `components/studio/project-meetings.tsx` mounted model-turn recovery only for `selectedMeetingId`. `useMeetingTurnPending` returned nothing when no meeting was selected. A saved intent whose meeting was missing from the list therefore had no recovery entry. A malformed intent rendered an error paragraph without a read/review/clear path. The manual-command panel was separate and did not solve these cases.

The existing authenticated model-turn receipt GET already addresses project, meeting and request identities independently of the meeting list. Reuse this read-only protocol. Model-turn `running`/`unconfirmed` results must never trigger automatic retries or a replacement identity.

## Required outcome

- Expose saved model-turn records for the current project independently of the selected meeting and list availability. Show the exact meeting/request identity and original prompt/participant choices without inventing a meeting title.
- Enumerate only the project's storage namespace. Bound display work and expose any truncation; never silently treat failed enumeration as an empty inbox. Preserve data from other projects and the separate ordinary-draft/manual-command stores.
- Validate stored top-level and input shapes strictly. Damaged records remain visible as local evidence; explicit clearing compares the exact reviewed key and raw value so replacements survive.
- For valid records, retain the existing exact-identity dispatch guard and read-before-explicit-retry behavior. Acknowledgement must compare all saved input, not just a reused request UUID. Clearing local recovery never cancels accepted server work or restores a deleted meeting.
- Provide seven-language review/error/clear copy, phone and RTL layout, cancel-first confirmation, busy duplicate/dismissal guards and focus restoration when the cleared row disappears.

## Tasks

- [x] Write failing storage tests for project discovery, malformed values/keys, storage enumeration/read failures, stale clearing and same-UUID changed input. Implement strict scoped enumeration and clearing helpers.
- [x] Replace selected-only recovery with a project-level inbox while preserving selected-meeting new-turn guards and exact receipt review.
- [x] Add seven-language copy and browser scenarios for unlisted/deleted meetings, unavailable lists, corrupt records, lost replies across reload, same-identity retry, changed-storage races and keyboard/phone/RTL behavior.
- [x] Obtain the required fresh focused review, repair accepted findings with reproducing tests, run applicable gates and update `docs/meeting-turns.md`, localization and release evidence.

## Review focus

Storage is evidence, not authority for new model work. No enumeration, read, reload, meeting selection or local clearing may start a model. Missing server records permit only an explicit original-identity retry; accepted unknown/running work does not. Corruption must neither overwrite original evidence nor make every future recovery permanently inaccessible. Source text and newer identities must survive stale completions.

## Status

Previous goal turn was progress: the missing recorded-outcome defect was reproduced and repaired, focused checks passed, documentation was updated, and final full suites were started. This continuation collected their terminal results without restarting either live process. Goal 7 remains active beyond this local feature checkpoint.

- Storage tests first failed because scoped enumeration/clearing exports did not exist; nine focused tests then passed. Added strict top-level parsing, 20-record pages and explicit 1,000-key scan increments. Enumeration/read failures never count as an empty inbox. Clearing compares the reviewed raw value; valid acknowledgements compare the original saved input, including when the UUID was reused.
- The project-level inbox is now independent of the selected meeting and list availability, with seven-language copy and explicit damaged-data review. New-turn mutations retain the originally dispatched intent through acknowledgement. Two browser tests first failed against the old build on missing unlisted/damaged recovery panels.
- The initial Project Studio suite passed 69 scenarios. Four further edge cases reproduced the deleted-meeting/404 clearing gap and covered stale clearing, enumeration failure, paging and same-UUID replacement input. After the fix, 20 focused browser scenarios passed.
- The review fix first failed on the missing recorded reply, then passed all 20 focused browser scenarios again. Ten focused source tests passed, including a new RED→GREEN malformed-reply guard. English and Arabic 320px outcome screenshots were inspected. Final workspace types/build passed.
- The initial 1293.4 KiB raw / 380.3 KiB gzip artifact failed the previous total allowance. Final reviewed code measures 1296.0 KiB raw / 381.0 KiB gzip under 1,330,000/392,000 bytes. Seven turn packs measure 28,154/11,767 bytes; the explicit family cap is now 29,000/12,000. Outcome review added 3,608 raw / 1,453 gzip bytes across seven packs; per-asset/media and other family caps are unchanged.
- Final production dependency audit (no known vulnerabilities), license policy, bundle, full formatting and clean PGlite migration gates passed. Full source: 867 total, 862 passed, zero failed, five explicit environment skips in 658.3 seconds. Full Chromium: 339 passed in 12.7 minutes. Fresh API generation compared 239 fingerprints before/after with zero differences. Documentation and workflow-only follow-ups passed separate formatting checks; `git diff --check` passed.

## Final review ledger

- The fresh focused reviewer found no Critical/Important defects and one Minor: an unlisted meeting's completed receipt was read but its replies/skipped participants were not displayed before acknowledgement.
- Ruling: Regrade inaccessible recorded outcomes to Important and expose them before acknowledgement — for an unlisted meeting, this inbox is the available route to review the lost response — the cost if overgraded is additional localized UI and bundle bytes.
- Ruling: Own final build/source/browser evidence in this task — the reviewer did not run release gates — reporting earlier gates as current would hide regressions.
- Ruling: Keep native-language, physical-device and screen-reader acceptance explicitly unverified — browser emulation cannot prove those environments — the cost is remaining deployment/accessibility risk until real-device acceptance.
- Ruling: Preserve the unchanged backend protocol and its separate native PostgreSQL durability gate — this review covered the browser inbox — multi-process/restart behavior remains unproven locally.
- Ruling: Do not add speculative storage reordering machinery without a grounded browser reproducer — current enumeration reports failures and allows explicit refresh/continuation — an unusual mutation may require another refresh.
- Ruling: Preserve unrelated working-tree changes — the focused review did not audit them — whole-release readiness still requires broader verification.
- Final: fixed inaccessible recorded outcome — unlisted-turn browser scenario RED→GREEN, 20 focused browser scenarios passed; malformed reply content RED→GREEN, 10 source tests passed; final full suites: 862 source tests passed with five explicit environment skips and 339 browser scenarios passed.
- No deferred minor finding remains. The broader Goal 7 release audit is still open; this task did not create a commit or publish the working tree.
