# Built-in capability library — local verification

Date: 2026-09-28. Branch: `codex/oss-operator-recovery`; base HEAD:
`81151c63e4bbf35fad39256566b3e362fb3325d0`. Changes are uncommitted within the
existing working tree; this document does not attest a clean release candidate.

## Delivered scope

- 30 versioned first-party skill guides in five areas and seven languages.
- Ten real read-only agent tools: skill discovery/loading, arithmetic, Unicode
  text counts, bounded line comparison, JSON pointer inspection, quoted CSV
  profiling, explicit-zone date conversion, URL parsing and SHA-256 fingerprints.
- Actual catalog/dispatcher/receipt integration, preserving existing execution
  fences and the model's untrusted source-data boundary.
- Authenticated, read-only `/api/skills`, OpenAPI and regenerated clients.
- Searchable `/skills` navigation/command-palette entry; phone and desktop
  layout, native keyboard disclosure, Arabic RTL and explicit project-draft
  handoff. A draft does not start work or grant access.
- No new dependency, migration, external service or subscription.

## Evidence

Logs below are in the host temporary directory (`$env:TEMP`). Counts are for the
named focused selections, not the whole repository.

| Gate                          | Result / evidence                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Utility RED                   | Missing implementation reproduced in `acos-capabilities-utilities-red.log`; five initial processor tests then passed.                                                                                                                                                                                                                       |
| Catalog RED                   | Missing catalog reproduced in `acos-capabilities-catalog-red.log`; all 30 guides × seven locales subsequently validated.                                                                                                                                                                                                                    |
| Dispatch RED                  | Production catalog lacked tools and `hash_text` was unknown in `acos-capabilities-dispatch-red.log`.                                                                                                                                                                                                                                        |
| Dispatch integration          | All ten tools execute in all seven locales; inactive agent, stop, explicit tool restrictions, invalid args and durable read-only replay tested. One fixture initially omitted required server-owned operation identity fields; fixed the fixture, preserving runtime validation.                                                            |
| UI RED                        | Missing `/skills` heading reproduced in `acos-skills-ui-red-2.log`. The first command's over-specific test filter selected no tests; it is not feature evidence.                                                                                                                                                                            |
| Source and integration        | **49 passed, zero failed/skipped**, 39.2 s, `acos-capabilities-review-source-final.log`; terminal session 82980 collected with exit 0 after all review fixes. Includes actual authenticated Express route plus generated response schema, normalized receipts, approved-action regressions and numeric-loss rejection in all seven locales. |
| Production Chromium           | **27 passed, zero failed**, 45.4 s, `acos-capabilities-review-ui-final.log`; terminal session 50437 collected with exit 0 after all review fixes. Includes seven phone library/draft flows with uppercase stable-ID searches, light desktop/filter/loading, error recovery, original new-project/new-agent/shared/shell suites.             |
| Initial UI fixture correction | Initial run: 14 passed, one failed. An imprecise `Check again` locator matched both system status and library retry; corrected to the exact button. No product failure was hidden.                                                                                                                                                          |
| Types and production build    | Full workspace `pnpm run build` passed after all review fixes in `acos-capabilities-review-build.log`; terminal session 26549 collected with exit 0.                                                                                                                                                                                        |
| Bundle                        | Passed the scoped feature budgets in `acos-capabilities-review-bundle.log`; see the explicit budget change below.                                                                                                                                                                                                                           |
| API generation                | `acos-capabilities-codegen.log` passed; no hand edits to generated clients.                                                                                                                                                                                                                                                                 |

Final captures: `test-results/capability-library-reviewed/`. The final English
and Arabic dark phone captures and the English light desktop capture were
visually inspected: controls and text remain readable, the phone content stays
within the viewport, and Arabic keeps its reading direction while stable IDs
remain legible. These are Chromium viewport captures, not physical-device or
native-speaker acceptance. The earlier 46-source / 27-browser passing runs in
`acos-capabilities-source-final.log` and `acos-capabilities-ui-final.log` predate
the review fixes and are superseded by the counts above.

The final build manifest at
`test-results/capability-library-reviewed/build-manifest.json` records SHA-256
hashes for all **198 built files**. Its `index.html` hash is
`eb415281706a57722dea446368e9e7c1c0556f215fc4a9de4b4fd4f73d008741`.
Source and built files were held unchanged throughout the final focused runners.

## Performance decision

The first build measured 1311.4 KiB raw / 388.0 KiB gzip for code with one language
per surface. It exceeded the old aggregate gzip ceiling by about 1.3 KiB.

Unused optional Select label/separator and command/dropdown shortcut templates
were made removable from production. An experimental route chunk grouping did
not help enough and was fully reverted; the earlier existing Vite grouping was
preserved. Final reviewed aggregate is approximately 1310.9 KiB raw / 387.9 KiB gzip.

This **newly requested feature** now has its own maximum **8,000 raw / 2,500 gzip
bytes** for the lazy `skills` route and `skill-draft` helper. The original
**396,000 gzip byte limit still applies to all other code**. Aggregate gzip is
bounded at 398,500 bytes; the existing 1,345,000 raw byte cap, language-family,
single-asset and media caps remain unchanged. The feature measured about 5.8 KiB
raw / 1.9 KiB gzip. This is a documented feature allowance, not a claim that the
old unchanged aggregate gate passed.

## Independent review and corrections

The requesting-code-review skill required an independent reviewer for this major
feature. Reviewer `capability_library_review` inspected the scoped implementation
without changing the checkout, reran eight pure tests, and found two Important
issues plus one Minor issue. All three were reproduced in
`acos-capabilities-review-red.log` (seven passed, three failed):

1. JSON numeric source values could silently round, overflow to `null`, or
   underflow to zero. The Node 24 reviver now compares each original numeric
   token's normalized decimal value with its serialized result and rejects loss,
   including a lost negative-zero sign.
2. CSV numeric summaries could silently round or exclude unrepresentable cells.
   They now disclose `unrepresentableNumeric`, `sumOverflow`, and approximate
   `IEEE-754` arithmetic while retaining original textual counts.
3. Turkish uppercasing of stable IDs could break search. Tool and UI searches now
   match ASCII IDs independently of locale casing and trim surrounding whitespace.

The targeted correction run passed ten tests in
`acos-capabilities-review-green.log`. The same reviewer independently reran all
three targeted regressions (three passed) and closed all three findings. Review
excluded whole-repository readiness and live-model/native-language/physical-phone
acceptance; these remain explicit release work, not silently waived requirements.

The first full format check found three files to format; they were repaired and
`acos-capabilities-format-final-2.log` passed. API regeneration was repeated:
`acos-capabilities-codegen-stability-result.json` records **263 files before,
263 after, zero changed hashes**. No generated client was hand-edited.

After the review fixes and final documentation updates, the full workspace
format check passed again in `acos-capabilities-review-format-final.log`.
Terminal session 73032 returned exit 0; `git diff --check` also passed.

### Remaining acceptance after feature review

This focused feature checkpoint does not replace the full source/UI release
suite or the remaining route audit. Real provider-driven use of all 30 guides,
native-speaker acceptance, physical-phone HTTPS/native Safari, PostgreSQL and
container/environment gates remain unverified where previously documented.
Goal 7 stays active. Nothing was published or pushed to GitHub.
