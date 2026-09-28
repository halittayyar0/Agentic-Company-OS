# Authored agent instructions — implementation checkpoint

Status: applicable local implementation/review gates passed for this feature under Goal 7. This is a focused checkpoint, not a public release attestation or proof of later Terminal changes.

## Implemented

- Six authored translation packs plus the canonical Turkish catalog cover all 15 role playbooks, shared manager/specialist rules and workforce handoff contracts. Language-only agents and the primary agent compared complete bodies and contracts against the source. The fresh reviewer subsequently caught one missed citation-proximity clause in both Chinese research roles; this is now explicit in each script. Native-speaker acceptance remains open.
- Catalog GET and agent creation accept a validated optional locale, preserving Turkish for omitted legacy parameters. Generated API contracts were refreshed.
- Explicit custom instructions retain their exact text and custom provenance even when a template key is also supplied. Startup no longer replaces these new custom records with stock instructions. This does not recover custom text already lost in older installations.
- Startup selects the workspace locale for managed prompts. Future managed agent turns select the current workspace language without renaming stored agents or replacing custom instructions.
- Workforce installation uses localized role and handoff instructions while retaining its immutable request locale, permission boundaries and durable replay behavior. The canonical `crew` orchestration identity remains unchanged; the translated display field named `team` maps to it.
- Creation and managed profile previews now use the selected-language catalog. Custom submission preserves exact whitespace and Unicode. An inline language selector keeps the operator on the same form; late or failed catalogs preserve edited drafts and block submission of an unverified managed prompt.
- Shared shell translations load before committing a language change, preserving the mounted form. Cancellation rejects late results. Initial translation failure can reload before a draft exists; a failed surface translation during editing can return to the last loaded language without discarding the draft.
- Managed profile instructions explain that editing and saving creates a custom prompt. Language changes leave custom instructions and edited drafts intact.

## Evidence

- Observed missing-module RED: `%TEMP%/acos-authored-locales-red.log`.
- Five actual HTTP/seed/runtime flow regressions failed before integration, including a startup that replaced explicitly supplied custom text: `%TEMP%/acos-authored-flows-red.log`.
- Arabic workforce installation failed because its base role instructions remained Turkish: `%TEMP%/acos-authored-workforce-red.log`.
- Expanded focused catalog, HTTP/seed/runtime, workforce localization and durable install/replay suite: 17 passed, zero failed or skipped. `%TEMP%/acos-authored-backend-2.log`. This includes all seven persisted workspace preferences selected after seeding, both chat/task prompt construction, exact custom-source preservation, all workforce member playbooks/contracts and the 9,000-character role bound.
- The focused production browser suite passed 44 scenarios: `%TEMP%/acos-authored-ui-focused-2.log`. It covers all seven managed previews, custom drafts across uncached language changes, delayed/failed catalogs, shell cancellation and existing creation/profile/setup flows. Four additional English/Arabic light/dark phone captures passed their initial controls/overflow checks: `%TEMP%/acos-authored-visual.log`.
- Visual inspection then found the active Settings tab partially clipped. A stronger assertion against its actual scroll viewport failed as expected: `%TEMP%/acos-authored-tabs-red-2.log`. The repair reveals the selected tab horizontally on selection, language or size changes without scrolling the page vertically. The updated production build passed 27 authored-instruction, setup and onboarding scenarios, including the four stronger phone visibility checks: `%TEMP%/acos-authored-tabs-green.log`. The resulting English dark/Arabic light screenshots were visually inspected in `test-results/authored-tabs-green/`. Related existing creation/profile locale scenarios are checked separately.
- Workspace typecheck passed again after the tab visibility implementation: `%TEMP%/acos-authored-tabs-types.log`. The updated production UI build passed: `%TEMP%/acos-authored-tabs-build.log`.
- The 21 related existing expert creation/profile locale scenarios also passed on that build: `%TEMP%/acos-authored-tabs-related.log`. Together the two current runs cover 48 distinct focused browser scenarios. Both runners exited successfully; no preview was left running. Scoped format and diff checks passed.
- API generation and stability passed: `%TEMP%/acos-authored-codegen-stable.log`; all 252 before/after fingerprints matched.
- Scoped formatting completed. One transient Windows file-write failure on the workforce test resolved on retry; this was not counted as a passing initial command.
- The first browser integration attempt had 30 passes and 12 failures. Seven failures came from missing profile GET fixtures and one from an over-strict test locator; those are not product RED evidence. Three fresh-form validation failures and initial failed-language recovery exposed real regressions and were repaired before the 44-scenario passing run. `%TEMP%/acos-authored-ui-focused.log` retains the failed attempt.

## Fresh integrated review and repairs

One fresh read-only reviewer inspected the complete integration, translations and relevant callers. The review found two Important issues and one Minor translation omission:

- Profile translation failures used reversed recovery handlers: initial failure did not recover; failure during editing reloaded and lost the draft. Both browser regressions were observed failing (`acos-authored-review-red.log`), then repaired by using reload only before a form exists and returning to the last loaded language while editing.
- A delayed English preference PUT could overwrite a newer German selection on the server while the browser stayed German. The observed regression ended with persisted `en` rather than `de` (`acos-authored-sync-red.log`). The page now serializes writes across effect cleanup and component remount, skips obsolete queued selections and allows a failed earlier write to release the queue. This orders this page's requests; separate browsers remain independent writers of the shared workspace preference.
- Both Chinese research playbooks now explicitly place supporting citations next to their claims, preserving the source evidence rule and the separate recency requirement. This small reversible text correction used source comparison and existing catalog/workforce invariants rather than a new test mirroring its exact sentence.

After the fixes, all 52 focused production browser cases passed (`acos-authored-reviewed-focused.log`), including both profile failures, delayed successful/failed preference writes, all locales, drafts and phone themes. The 17 focused backend checks also passed (`acos-authored-reviewed-backend.log`). Workspace types and production build passed (`acos-authored-reviewed-build.log`), followed by a refreshed API build for the Chinese copy correction (`acos-authored-reviewed-api-build.log`). No second reviewer was dispatched.

The first full browser run was intentionally stopped after the confirmed review findings; it is not a passing gate (`acos-authored-full-ui.log`). The first full source run passed 895 tests with six environment skips, but overlapped the final copy repair. The final run on the repaired source passed **895 tests, zero failures, six skips** (901 total across 187 files, 685.5 seconds; `acos-authored-reviewed-full-source.log`).

The subsequent full browser run ended with **382 passes and one failure** in 14.2 minutes (`acos-authored-reviewed-full-ui.log`). The failure was the legacy release-smoke harness treating the newly required `GET /api/agent-templates` as an unexpected request. Its separate mock router lacked this endpoint. The mock now validates the locale and returns the same authored catalog as the API; the application's production build did not change. The complete fixture-corrected rerun passed **383 scenarios, zero failures, in 13.4 minutes**, with exit code zero (`acos-authored-final-full-ui.log`, output `test-results/authored-final-full/`). Exec session 67943 is terminal and collected. The 382-pass run is not reported as a successful gate.

Full formatting initially reported the new review-package Markdown only, then passed after formatting; a subsequent complete format/diff check also passed (`acos-authored-reviewed-format.log`). Production dependency audit and license policy passed; a clean process-lifetime PGlite migration passed. Final workspace types and API build passed. The production bundle remains within the unchanged 1,345,000-byte raw / 396,000-byte gzip caps, measuring 1312.7 / 386.1 KiB (`acos-authored-reviewed-bundle.log`). English dark/Arabic light phone screenshots from `test-results/authored-reviewed-full/` were visually inspected.

## Remaining for this feature

The applicable local full-tree gates and final audit update are complete for this feature. The broader seven-language surface/history review remains active under Goal 7. Native-speaker review must judge linguistic quality; structural parity and source comparison do not replace it.

The preceding operator checkpoint (885 source passes with six skips and 363 Chromium scenarios) predates these changes. It does not establish the current full-tree result. Physical-phone private HTTPS, native PostgreSQL/Docker, native-speaker and actual 24-hour acceptance remain unverified. No installation, paid API call, credential change, commit, push or publication occurred.
