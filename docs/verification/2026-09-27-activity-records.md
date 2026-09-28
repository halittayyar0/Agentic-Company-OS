# Activity and delegation records — 2026-09-27

Goal 7 remains active. This checkpoint replaces misleading activity-as-receipt and automatic stage-completion claims with bounded, source-labeled records. It does not establish that the whole product is ready to publish.

## Changed behavior

- The Plan view distinguishes task facts from activity records, tool intent from execution evidence, and counters from attempt identities. Missing planning/review/execution records remain missing even when the task is completed.
- Task-scoped activity excludes other tasks, removes duplicate IDs, orders records deterministically and retains at most the newest 200 supplied records.
- Source timestamps show the selected locale, an ISO datetime and explicit Europe/Istanbul timezone. The loaded snapshot time remains visible after a refresh failure.
- The Team view fetches only the selected delegated task's activity. Unknown roster IDs remain visible, historical agent associations survive ownership changes, and stored summaries are shown as records rather than simulated agent speech.
- Seven lazy language packs cover 69 interface strings and 50 detail labels each. Simplified and Traditional Chinese are distinct. Native-speaker approval remains outstanding.
- Filters and inline record details have keyboard operation, visible focus and 44 px controls. Both views use the page's vertical scroller and wrap content on phone widths.
- JSON downloads use activity-window@2 with explicit bounded-history/source metadata. The structured allowlist excludes raw commands, prompts, answers, arguments and unknown nested data; URL credentials/query/fragment are removed. Identifiers and retained URLs are never silently clipped. Summaries remain original content and still require operator review before sharing.

## Verification

| Check                           | Result                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused source/model/copy tests | 15 passed, including scope isolation, no invented completion, historical actors, source time, URL integrity and all locale fields/placeholders |
| Focused Chromium flow tests     | 10 passed on the final production frontend, including failed language-asset recovery                                                           |
| Full root suite                 | 812 total: 807 passed, 0 failed, 5 skipped; 613.8 seconds                                                                                      |
| Full Chromium suite             | 271 passed; 9.3 minutes                                                                                                                        |
| Workspace type checking         | Passed on final source                                                                                                                         |
| Production frontend             | Passed on final source                                                                                                                         |
| Selected-language bundle        | 1211.8 KiB raw / 357.9 KiB gzip; existing 372,000-byte gzip ceiling passed                                                                     |
| Repository formatting           | Repository format check passed; final report and whitespace check passed after updating                                                        |

The bundle checker initially counted all seven new trace packs as shared code and failed. The trace family is now registered under the same one-selected-pack accounting used by other localized surfaces, with a separate aggregate pack ceiling of 65,000 raw / 25,000 gzip bytes. The existing total cap of 372,000 gzip bytes and other ceilings were not raised.

English dark and Arabic 320 px light captures were visually inspected. Automated viewport checks are not physical-device acceptance. The full root/browser runs started before the last long-URL and language-asset recovery corrections. The 15 focused source tests and 10 focused browser tests then passed against the final source and rebuilt frontend. These focused counts are not added to the full-run totals. This is staged verification, not a claim that one combined verify invocation passed.

The five skips are four native PostgreSQL ownership/receipt/heartbeat/file-lock checks without a configured PostgreSQL database, and one Windows symbolic-link test denied with EPERM. None is counted as a pass.

Local evidence is under `%TEMP%/acos-trace-*.log` and `test-results/trace-locales/`, `test-results/trace-full-ui/`, and `test-results/trace-final-ui/`. These temporary/ignored files are local evidence, not portable release attestations.

## Remaining work

Project meetings have concrete unresolved reliability findings in the [meeting audit](./2026-09-27-meeting-audit.md). Operations localization/design, the `?view=operations` workbench entry, older-history browsing, other provider/API copy, authored playbooks and durable Browser/Terminal operator receipts remain open. A project-stop marker is still local and is not a server receipt.

This frontend checkpoint changes no API schema or database migration. API regeneration, native PostgreSQL, Docker and deployment gates are not newly established here. Physical-phone/private-HTTPS, Safari, native IME, screen-reader, native-speaker, POSIX and real 24-hour checks remain unverified. No paid model run, installation, commit, push or publication was performed.

See [Activity and delegation records](../activity-records.md) for the public contract.
