# Durable Operations reconciliation recovery

Execute inline under the existing Goal 7 mandate. Preserve unrelated work; no publication, paid service or installation.

## Required outcome

An operator can reload or leave the project after a reconciliation request loses its response, then review the exact receipt and original submitted input without replaying an external action. A bounded history window must not hide unresolved local recovery. Missing or damaged storage stays visible and never silently unlocks a changed decision.

## Design and contracts

- Add a read-only root-project/receipt endpoint independent of time windows and list caps. Return the existing safe receipt projection and recorded audit note/decision when present; omit command arguments, raw tool results, secrets and lease/host data. Root/descendant scope is checked on the server.
- Keep the existing immutable reconciliation write protocol. Persist exact normalized decision/note before dispatch; failed storage sends nothing. Every retry uses the saved values and requires a fresh exact read. A missing receipt is inconclusive, never proof that an effect failed.
- Store ordinary drafts and at most one unresolved reconciliation per project in session storage, bound to project and receipt. Recovery survives navigation and same-tab reload; browser storage is not a cross-device backup. Stale completions may clear only their matching saved record.
- Add a visible project recovery panel independent of the bounded receipt list. Allow read-only review and explicit local clearing after acknowledgement; clearing local recovery never cancels or changes server work. Damaged data remains reviewable until explicitly cleared.
- Keep source text intact and add recovery/validation copy in all seven language packs. Match the API's 2,000-byte UTF-8 note bound before storage or dispatch, including CJK/Arabic text. Use shared forms, phone-sized controls, RTL, cancel-first review and restored focus.

## Tasks

- [x] Add failing exact-read API/source tests; implement scoped safe receipt review and OpenAPI/client generation.
- [x] Add failing storage/identity/byte-limit tests; implement strict durable draft and pending-intent helpers.
- [x] Connect dialog and recovery panel; preserve exact input through failure, navigation and reload, including receipts absent from the list.
- [x] Add seven-language copy and browser scenarios for reload, read-only recovery, identical retry, missing/damaged storage, stale completion and focus/RTL.
- [x] Obtain focused source review, resolve findings, run applicable source/browser/build/API/format/bundle gates and update release evidence.

## Initial findings

- Previous checkpoint held reconciliation drafts only in a mounted component and used a bounded project snapshot for recovery.
- Client validation counted characters while the API limits audit notes to 2,000 UTF-8 bytes. This must be corrected with the recovery work.
- Prior checkpoint: full source 846 passed / 5 skipped, full Chromium 320 passed, final focused Chromium 18 passed. Native PostgreSQL, containers and physical-phone access remain separate unverified gates.

## Execution ledger

- API: additive exact read implemented with no-store responses, safe receipt/audit projection and root/descendant scope. Existing write semantics and schema remain unchanged. API clients regenerated successfully.
- Storage: strict intent/draft helpers implemented; five tests passed. Input is not yet wired to UI dispatch, so navigation/reload recovery is not yet delivered.
- Nine combined API/read-model/storage tests passed in 17.3 seconds; workspace typecheck passed. See the work-in-progress verification report for fixture repairs and remaining integration.
- No new review subagent was started yet. The final focused review remains required after integration.
- Follow-up integration: the dialog and route-level recovery panel now use saved drafts/intents and exact reads. Initial source/model/network checks passed 13/13 and Operations Chromium passed 23/23; new reload tests were observed failing against the prior artifact before implementation. The API regression set passed 4/4.
- Final review performed by a fresh read-only reviewer. Accepted two Important findings: stale dialog intent after explicit clearing, and valid-intent recovery trapped by a damaged companion draft. Added failing regressions, implemented fixes; focused source set passed 14/14. Final browser/full-suite verification is underway.
- Final: Ruling: regrade the receipt-state parser mismatch from Minor to Important — a legitimate `running` server response must remain readable in exact recovery review; rejecting it misreports availability and can strand investigation — cost if wrong: only a narrowly expanded contract regression test. The test failed before correcting `in_progress` to `running`.
- No review findings were declined; no minor findings were deferred. Full suite completion will be recorded after terminal results, not from live progress.
- Full source suite completed after fixes: 862 tests, 857 passed, zero failed, five explicit environment skips, 648.3 seconds. Final build/types, format, license/audit, PGlite migration and bundle gates passed; full Chromium and final generation stability remain in progress.
- Final: fixed cleared-intent resurrection — browser regression observed RED, then passed in full Chromium 327/327; fixed damaged-draft acknowledgement trap — source regression RED→GREEN and browser proof passed in the same full run. Corrected the receipt-state contract after its new test failed. Full source suite: 857 passed / 5 explicitly skipped / 0 failed.
- Tasks 3–5 complete locally. Final Chromium 327/327 in 12.2 minutes; API generation 239 fingerprints unchanged. Build/types, format/diff, bundle, audit, license and clean PGlite migration passed. No commit or publication; broader Goal 7, native PostgreSQL/container/phone acceptance and exact-candidate checks remain open in the release-readiness report.
