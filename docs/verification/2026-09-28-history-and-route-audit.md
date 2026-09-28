# History and route acceptance — active audit

Status: **in progress**, not a complete route or release attestation. Goal 7 retains all original requirements. The preceding goal turn was progress: three obsolete full-suite fixtures were corrected, 39 focused checks and full types passed, and the complete source rerun was started. This continuation confirmed that same runner live before making further decisions; no imported product/test source was edited while it ran.

## Current evidence

- The generated-tool production build's `dist/public/index.html` SHA-256 is `33FDFC5E8624714FDCD803400FC0D9C7EC84098AF56319FF3210FCB7E1A5BDA6`. This identifies the rendered HTML, not every asset or a clean source commit. The workspace remains dirty on `codex/oss-operator-recovery`.
- Full Chromium already passed 406/406. A separate capture-only configuration exercised 18 existing Home, authentication, language setup, New project, Projects and shell scenarios against that same build on localhost port 4186: **18/18 passed, 30.5 seconds**, `acos-route-acceptance-capture.log`, session 24451 terminal/exit zero collected. It made no source/build change. Extra captures were necessary because several earlier page screenshots predated the current build.
- Root viewed 14 current captures, preserved without image edits in ignored `test-results/route-audit-2026-09-28-before-history/`. `manifest.json` records original paths and SHA-256 hashes. The copied names are listed below; this is a partial inspection, not all route/theme/locale/state combinations.
- The original full source rerun then completed with 1,290 passes, zero failures and six environment skips (1,296 total); session 40069 is terminal/exit zero collected. It predates the history/contrast repairs. Its complete checkpoint is tracked in the generated-tool execution ledger. Passing screenshots do not establish real phone HTTPS, native input, Safari, assistive technology, native-speaker acceptance or real provider behavior.

## Findings that change the next action

### 1. Activity pagination omits an existing row when timestamps are out of ID order

`routes/activity.ts` filters `id < beforeId`, but orders by `createdAt DESC, id DESC`. `setNextCursor` returns the minimum loaded ID. An isolated actual Express/PGlite probe inserted IDs 1, 2, 3 with event dates September 3, 1, 2. Following every returned cursor reached only IDs 1 and 3; ID 2 was omitted. The task-specific activity route, already ordered by ID, reached all three.

Observed RED: `acos-history-pagination-probe-red.log`, **one passed / one failed**, 23.7 seconds, session 12598 terminal/exit one collected. The temporary probe refuses an external database or production process and uses only its own process-lifetime PGlite. Product source was unchanged. Next: carry this case into the repository pagination regression, align ordering with the existing integer cursor, and verify filtering plus inserts between page requests. A new timestamp cursor or API-body migration is unnecessary for this existing contract.

### 2. Project form/search placeholder contrast is too low

Current Arabic light New project capture shows faint placeholder examples. Source confirms `placeholder:text-muted-foreground/50` on the name, `/55` on the brief and `/65` on the Projects search. The semantic text color itself is appropriate; reducing its opacity causes the problem.

Computed from current HSL tokens and their opaque card backgrounds, using sRGB compositing and WCAG relative luminance:

| Theme | Name, 50% | Brief, 55% | Search, 65% | Full semantic color |
| ----- | --------: | ---------: | ----------: | ------------------: |
| Light |    2.28:1 |     2.51:1 |      3.09:1 |              7.06:1 |
| Dark  |    3.08:1 |     3.44:1 |      4.25:1 |              8.10:1 |

These are calculations from source values, not color estimates from the PNG. Next: remove the three opacity reductions, retain visible labels and layout, rebuild and inspect the actual rendered result. This is a concrete accessibility repair; it does not require a broad visual restyle.

### 3. Older records remain inaccessible from several bounded views

The source inventory at the start of this audit confirmed these boundaries:

- Computer activity: 20 current records, no older-page action; following agent events uses this live slice.
- Project Plan and trace: 200 current activities; export correctly states `fullHistory: false`.
- Delegations: up to 200 loaded assigned direct-child tasks and one 200-activity window for the selected task.
- Projects directory: 200 loaded roots; search/status filtering operate only on that sample.
- Expert statistics: explicitly labeled samples of 200 activities/messages; recent tools render 40. These counters must remain sampled, with any history access separate from lifetime-statistic claims.

Implementation direction within the existing flows: explicit older/newer/latest page controls, scoped cursor validation, one bounded visible page, readable loading/error/empty states, and preservation of the currently loaded page on a failed continuation. Pause automatic replacement while reading an older page. Keep Computer's live-follow logic tied to the newest feed, not historical events. Reset/cancel pending reads when the expert/project/selected child changes. Do not retain unbounded arrays, invent full-history counts, rewrite source summaries, or modify durable action/request identities. Translate every added control in all seven language packs and verify phone/RTL/keyboard behavior. Current task snapshots remain visibly distinct from historical activity; trace export must identify the selected page boundary. The implementation checkpoint below supersedes the initial missing-controls finding.

## Captures inspected

| Preserved capture                      | Observed state and review                                                                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings-en.png`, `settings-ar.png`   | English dark desktop and Arabic light phone: preference/provider hierarchy, labels, field grouping and wrapping inspected. The current alpha localization notice remains visible; final copy must reflect actual remaining acceptance limits. |
| `directory-ar.png`, `new-agent-ar.png` | Arabic light directory/filter and expert-role selection: primary action, source name, selected role, focus and mixed-script text inspected.                                                                                                   |
| `home-en-error.png`, `home-ar.png`     | English desktop retained-draft failure and Arabic phone composer: clear goal hierarchy, examples, main action and stacked supporting content inspected.                                                                                       |
| `new-project-ar.png`                   | Arabic 320px light form with keyboard focus: fields and type controls fit; placeholder contrast finding above remains open.                                                                                                                   |
| `projects-en-filtered.png`             | English dark phone filtered-empty state: search remains visible and empty state explains filter recovery; older-project access remains open.                                                                                                  |
| `auth-zh-TW.png`                       | Traditional Chinese desktop sign-in after language-asset recovery: focused labeled key field and disabled empty submission inspected. This is the recovered login state, not the earlier asset failure.                                       |
| `directory-ar-dark.png`                | Arabic dark phone directory after shell load: overall stacking and pagination inspected. Tall-image downscaling limits fine text assessment.                                                                                                  |
| `approval-en.png`, `approval-ar.png`   | Exact host-action approval, English dark desktop and Arabic light phone: original command/digest, confirmation field, visible focus and reachable approve/cancel controls inspected.                                                          |
| `workforce-ar.png`                     | Arabic team preview/install form: overall stacked hierarchy inspected; tall-image downscaling limits fine text assessment.                                                                                                                    |
| `room-ar.png`                          | Arabic light phone company transcript: source text, composer, keyboard hint, disabled empty send and membership disclosure inspected.                                                                                                         |

Apple-design references used for this inspection: `accessibility.md` (Vision), `layout.md` (Visual hierarchy), `typography.md` (Ensuring legibility), `color.md` (Best practices), `lists-and-tables.md` (Content), `scroll-views.md` (Best practices), `loading.md` (Showing progress), plus the mobile/desktop context pages. Applied principles are readable text, semantic appearance, clear hierarchy, visible continuation and preserved reading context for this web application. Native Apple platform integration is not claimed. Contrast/focus/zoom and all remaining reachable surfaces still require final acceptance after repairs.

## First repairs verified

The global activity route now orders by ID, matching its existing `beforeId` cursor. The repository regression uses the actual API/database and verifies skewed timestamps, exact scope/severity, inserts between page requests, unchanged source/timestamps, no omission/duplication, cursor termination and return to latest. The first repository RED also exposed a fixture mistake: task-activity responses intentionally reverse each bounded page into ascending ID order. That valid body contract is retained, and the test now accounts for it. The corrected RED has **two passed / one failed**, specifically the global omission (`acos-history-pagination-red-2.log`, 13.6 seconds). GREEN is **3/3, zero skips**, 17.1 seconds (`acos-history-pagination-green.log`, session 98449 terminal/exit zero collected). Task-route production behavior was not changed.

The three project placeholder opacity reductions are removed. A one-off browser measurement read actual computed placeholder colors and composited ancestor backgrounds from the rebuilt UI: all three fields measure **7.04:1 in light** (`rgb(76,90,107)` on white) and **8.09:1 in dark** (`rgb(172,186,200)` on `rgb(26,34,46)`). This exceeds the 4.5:1 check for the inspected text. `acos-route-contrast-rendered.log` and ignored `test-results/route-contrast-repair/measurements.json` record all six readings. Root inspected the new light/dark phone form images; labels, hierarchy and wrapping remain intact. The one-off preview/browser closed after measurement.

Renewed verification after these bounded repairs:

- Workspace types and production build: **PASS**, `acos-history-route-build.log`, session 96789 terminal/exit zero collected.
- Affected production Chromium: **7/7, 11.4 seconds**, `acos-history-route-ui.log`, session 54047 terminal/exit zero collected; New project validation/recovery and Projects filters/empty states, including Arabic phone keyboard/RTL.
- Full formatting: **PASS**, `acos-history-route-format-check.log`, session 33595 terminal/exit zero collected.
- Unchanged bundle gate: **PASS**, 1311.6 KiB raw / 386.5 KiB gzip, `acos-history-route-bundle.log`; no ceiling increased.
- Diff whitespace: **PASS**.

The earlier 1,290-pass source and 406-pass browser runs belong to the immediately preceding generated-tool checkpoint. The two repairs above have their own focused evidence and rebuilt output; a final full-suite candidate run still follows the remaining history work. No source/test runner is live at this checkpoint. Findings 1 and 2 are repaired; finding 3 (older-page controls) and complete route acceptance remain open. Next: implement the scoped bounded history navigation described above, first reproducing cursor/error/race cases and preserving Computer live-follow plus task/request identity. No install, credentials, spending, commit, push or publication occurred.

## Bounded history implementation

The preceding implementation goal turn made progress: it created the scoped reader/pager and seven-language controls, and captured a failing Projects browser case with no Older action. This continuation revalidated those files, integrated the consumers, and produced new evidence. The intervening phone explanation was informational; it did not establish a physical-phone connection.

- `record-history.ts` validates scope, bounds, unique IDs and the explicit continuation header. It preserves API source order, text and timestamps. Its pager retains only the visible data page plus cursor IDs; it commits navigation only after a valid response.
- Projects, Computer, Plan/trace, the Team child-task list and the selected delegation now have Older/Newer/Latest controls. Old-page polling is paused, failed reads preserve the visible page and retry target, and changing scope aborts/ignores previous responses. Current overview/roster data stays separate. Expert statistics still describe samples.
- Computer historical activity cannot drive live-follow; drafts and durable operator identities are preserved. Trace JSON identifies the selected page and both display/export ordering, alongside separately labeled current task facts and `fullHistory: false` / `receipts: false`.
- All seven shell, Computer and trace packs describe the page scope. Counts use the selected locale. Controls wrap at phone widths, use 44 px minimum targets and retain text directions. Error rendering is shared to avoid duplicate alerts/retry buttons.

### Reproductions and focused verification

- Initial Projects RED: one failure due to the missing Older action, `acos-history-navigation-red.log`, session 89139 terminal/exit one.
- Pager RED: four passes / one failure, `acos-history-core-red.log`. Hiding and resuming the tab wrongly refreshed latest and discarded the failed older target. `start()` now preserves that error/retry context.
- Final focused source checks: **22/22, zero skips**, `acos-history-focused-source-final.log`, 1.15 seconds. Covers scoped reads/source order, invalid/foreign/duplicate/oversized/bad-cursor rejection, deep navigation, failed return, retry retention, single flight and aborted/replaced late reads, plus existing trace/delegation projections and seven-language key/interpolation contracts.
- First integrated browser pass: **66 passed / one failed**, 2.3 minutes, `acos-history-navigation-ui.log`, session 11259 terminal/exit one. The failing new Computer test used an ambiguous Refresh selector; it now targets the workspace header. Real scope-rejection behavior is tested separately; normal fixtures now return valid scoped responses, including the API's ascending child-page order.
- Renewed workspace types and production build: **PASS**, `acos-history-navigation-build-7.log`, session 40078 terminal/exit zero. No package/dependency was added.
- The initial bundle failed at 1318.8 KiB raw / 389.3 KiB gzip. Removing the unused Tooltip provider, enabling elimination of unused dropdown templates and dropping obsolete project-window copy restores the unchanged gate to **1304.1 KiB raw / 385.7 KiB gzip**, `acos-history-navigation-bundle-5.log`. A measured vendor-grouping experiment increased gzip size and was reverted. No ceiling was raised and live dropdown behavior remains in the regression scope.
- Final production Chromium integration: **143/143 passed, zero failures, 5.9 minutes**, `acos-history-navigation-ui-2.log`, session 35200 terminal/exit zero collected. Covers history, Computer, trace, Projects, Project Studio and shell. New cases exercise seven-language phone/RTL/keyboard navigation, failed older-page recovery, retained drafts, historical/live-follow separation, selected-page export, foreign-scope rejection and late delegation replies. Existing operator/meeting recovery and source-preservation checks passed against the same production build.
- Full formatting passed (`acos-history-full-format.log`, session 1424 terminal/exit zero); subsequent documentation is formatted separately. Diff whitespace passed. No test/build/preview runner remains live.

Root inspected the final English dark and Arabic light phone pager crops, plus Arabic expanded trace and delegation views from `test-results/history-navigation-final/`. The final count label corrects the initial English singular wording. Controls wrap within the phone, source text/identifiers remain readable and isolated, and current-task facts retain their separate labels. These four captures are partial visual evidence, not a full route/theme/state audit. The directory's `build-manifest.json` records SHA-256 for all 196 built files; HTML SHA-256 is `4245207CF6EFF871EB377D51AE60278A92E5195F557862F9B2FA13EFF5D4A58A`.

The history implementation's focused local checkpoint is closed. Full release-candidate source/browser gates and complete route acceptance remain outstanding, as do the already listed external environments. The earlier full green runs are not evidence for this new build. Goal 7 stays active. The user's subsequent request for a broad useful tools/skills package adds work; no new tools or skills are claimed by this checkpoint.
