# Combined local release gates — 28 September 2026

Status: combined local gates passed; public-candidate, disclosure and external-environment acceptance remain open. This is an uncommitted working-tree verification on
`codex/oss-operator-recovery`, based on HEAD
`81151c63e4bbf35fad39256566b3e362fb3325d0`. No staging, commit, push, tag,
publication, software installation or paid provider request was performed.

## What changed during this checkpoint

- Refreshed the complete source and production Chromium gates after the history,
  30-guide / ten-tool library, route foundation and text-resizing work.
- Corrected the release smoke test's obsolete eight-link expectation. It now
  checks all nine named destinations, including `/skills`, while retaining the
  drawer bounds, keyboard opening, dismissal and focus checks.
- Corrected the library loading test: it waits for the actual Skills route and
  its catalog-loading text, rather than matching either the route loader or the
  independent emergency-stop status. The deferred response, 30 results, six-item
  category filter and editable draft checks remain intact.
- Updated the first-run/Settings explanation in all seven languages. It now
  discloses outstanding translation review and preserved source/history content,
  instead of saying some application pages still use Turkish. The Arabic
  first-run assertion was updated to the reviewed wording; language persistence
  and RTL assertions remain unchanged.
- Added separate top/action captures for long Operations and deletion dialogs.
  Their earlier full-page captures did not show every part of the scrolled
  dialog. No product behavior or authority rule was changed for these captures.
- Set the default browser worker count to two, retaining serial cases within
  each file and isolated browser contexts. The first complete 903-case run took
  23.4 minutes with two workers; a single-worker browser gate plus the source
  gate leaves little room within the existing 60-minute CI job. This is a local
  measurement, not a successful remote CI run.
- Corrected the English/Turkish README localization description and consolidated
  the current transfer limits in `docs/localization.md`.

## Verification ledger

Logs named here are in the host temporary directory. A focused pass is not
presented as a full suite.

| Gate                                 | Result                                                                                      | Evidence                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Full source/server suite             | 1,319 total / 1,313 passed / zero failed / six skipped; 209 files, 1,301.6 seconds          | `acos-release-repaired-full-source.log`                                                                     |
| Full production Chromium             | 903/903 passed; zero failed, skipped or flaky; 33 files, 24.3 minutes                       | `acos-release-final-ui.log`; `test-results/release-final/ui-results.json`                                   |
| Workspace types and production build | Passed                                                                                      | `acos-release-repaired-build.log`                                                                           |
| Bundle                               | 1312.7 KiB raw / 388.7 KiB gzip; passed                                                     | `acos-release-repaired-bundle.log`                                                                          |
| Full repository formatting           | Passed before the final report; final edited documentation checked separately               | `acos-release-repaired-format-complete.log`                                                                 |
| Final edited files and whitespace    | Corrected UI assertion and final documentation formatting passed; `git diff --check` passed | `acos-release-language-format.log`; `acos-release-final-docs-format.log`                                    |
| Production dependency audit          | No known vulnerabilities reported                                                           | `acos-release-current-security.log`                                                                         |
| Production dependency license policy | Passed                                                                                      | `acos-release-current-licenses.log`                                                                         |
| Deterministic API generation         | 263 generated files before/after; zero changed hashes                                       | `acos-release-current-codegen.log`; `test-results/release-current/codegen-stability.json`                   |
| Clean local migration                | Passed with a new process-lifetime PGlite database                                          | `acos-release-current-migrate.log`                                                                          |
| Focused repair checks                | Six browser cases, then two first-run cases passed; shell locale parity passed              | `acos-release-repaired-probe.log`, `acos-release-language-repaired.log`, `acos-release-repaired-locale.log` |

The six source exclusions are five native PostgreSQL checks (sampler ownership,
operator identities, operation receipt/browser-affinity/reconciliation races,
heartbeat/recovery lock ordering, cross-connection file locks) and one Windows
output-symlink setup returning `EPERM`. These are skips, not passing evidence.
The migration command explicitly removed inherited database target overrides in
its child environment and selected development mode; it did not migrate an
operator database. This is not native PostgreSQL proof.

### Failed and interrupted runs retained

The first complete production run had **901 passes / two failures**, zero skips,
23.4 minutes (`acos-release-current-ui.log`). The failures were the old menu
count and ambiguous loading locator described above. The 1,381 source file
hashes and all 198 built-file hashes stayed unchanged during that run.

The next run was deliberately stopped after the first-run test expected the
retired Arabic sentence (`acos-release-repaired-ui.log`). Its error snapshot
showed the new intended sentence. That partial runner is not reported as a
completed suite. Its process-tree stop is recorded in
`test-results/release-repaired/aborted-run.json`; the source runner was retained.
The corrected first-run file passed both cases before the final full run.

## Build and visual evidence

The final build contains 198 files. Its HTML SHA-256 is
`b2cae3b0f743c935cc6034065443baf1880a631e0b2dbcbbc2cca48ecd6d2c26`.
The manifest is `test-results/release-final/build-manifest.json`.
All 1,381 present source hashes and all 198 build hashes, including both file counts, stayed unchanged throughout the final browser run. `test-results/release-final/full-run-provenance.json` records the comparison and test statistics. Product source also stayed unchanged during the final source run; the only intervening test edit corrected a UI `.spec.ts` assertion after stopping the earlier browser runner. The source runner discovers `.test.*` files and does not import that UI assertion. The evidence-document updates and README screenshot refresh were made after both runners completed; they do not change product source or built assets.

The current checkpoint includes 39 actually inspected retained images: 22 from the first full build and 17 from the repaired/final build, including 3 fresh captures from the successful full run. Paths, stages and hashes are in `test-results/release-final/visual-inspection-manifest.json`. Captures cover source-preserving chat, recorded/uncertain
operations, exact command approval, deletion scope and actions, project stop,
meeting recovery and forms, first-run text, Settings, the library and Home.
The long dialog review now includes the title/scope and the bottom controls.
The current README screenshot uses the final-build English desktop Home fixture.
Its SHA-256 is `aa442fd0d6234c02d580a58a775bc4296a3ec0fabe931a9ef13e7a7efcf40f48`.
All pictured work is fixture data, not real operator activity.

The route suites now provide combined local structural and interaction evidence
for every route in the [route inventory](2026-09-27-route-acceptance-inventory.md).
Default view matrices include all seven locales, both themes and phone/desktop.
Additional 32 px font matrices and focused failure/recovery/keyboard tests are
recorded in the earlier route checkpoints. Visual review is representative;
passing DOM checks or generating a screenshot is not visual review of every
combination, native-speaker approval or a physical-device test.

## Remaining release boundaries

- The checkout remains broadly modified. The initial disclosure path inventory
  covered 1,381 present files, with no sensitive runtime paths among candidate
  paths or the specifically checked history paths. It is a path/hash inventory,
  not a full content/history secret scan or an approved staging list.
- Full redacted content/history secret scanning, reviewed publication paths and
  exact-candidate clean-checkout verification remain required. The portable
  scanner download request remains unanswered; nothing was downloaded.
- Native PostgreSQL races and the production API/two-worker topology,
  Docker/Compose, actual phone access over private HTTPS/mobile data, Safari,
  native input methods, assistive technology and native-language review remain
  unverified here. Configured CI jobs do not establish those results.
- No real 24-hour run occurred. Short synthetic/local checks do not establish
  24-hour endurance or universal exactly-once external effects.
- Remote CI and GitHub publication remain maintainer-controlled. The library is
  implemented; this local checkpoint is not permission to publish an unreviewed
  tree or a claim that every release requirement has passed.
