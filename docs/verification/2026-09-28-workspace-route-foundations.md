# Workspace route foundations — 28 September 2026

Status: this focused checkpoint passed after the two repairs below. Goal 7 remains active; this is an
uncommitted working-tree checkpoint, not a public release attestation. The prior
goal turn made progress through the primary-route target correction and its
42 + four passing browser checks.

## Scope

The shared `tests/ui/helpers/route-audit.ts` now measures both the eight primary
routes and the remaining workspace surfaces. The new cases use the existing
route fixtures, preserving each suite's source records and authority boundaries.
No dependency or service was added.

| Suite             | Measured views per locale / appearance / viewport          |
| ----------------- | ---------------------------------------------------------- |
| Expert details    | Settings, tasks, sampled statistics, conversation          |
| Settings          | Language/appearance, providers and original model metadata |
| Company Room      | Source transcript, composer and membership disclosure      |
| Team Studio       | Authored team preview and configuration                    |
| Operations        | Fleet and project operations                               |
| Project Studio    | Workspace, plan, team, delivery and meetings               |
| Computer          | Terminal and scoped recorded activity                      |
| Browser workbench | Read-only remote frame and control surface                 |
| Workspace files   | File list and open editor dialog                           |

There are **18 view states × seven locales × two appearances × two viewports =
504 measured states**, in 252 new Chromium cases. Phone is 320 × 740; desktop is
1366 × 900. The probe verifies selected language/direction/appearance, accessible
control names, duplicate IDs, page overflow and target dimensions. Tabs and
numeric fields are included. The size floor remains 28 px phone / 20 px desktop,
with associated clickable labels counted; this does not establish that every
control meets the recommended 44 px phone size or complete WCAG conformance.

Desktop captures include overlapping shell-scroll segments. Dialog controls are
measured inside the dialog. A full-page phone screenshot can include content
outside the physical viewport beneath a fixed overlay; it does not mean that
the overlay itself is that tall. Production bundle and selected locale are real;
network responses and the remote-browser image are controlled fixtures.

## Findings and repairs

### Important — operation identity collapsed beside long metadata

Visual inspection of the Arabic dark desktop project-operations capture found
the short expert name `Mina` and attempt ID stacked one character per line.
`AttemptLedger` used a `minmax(0,1fr) auto` grid at a viewport breakpoint, while
the card itself was narrow. The metadata track consumed the identity's space.
The strengthened test reported the name paragraph as hidden before correction.

The identity and runtime/model metadata now occupy separate full-width rows.
The matrix checks that the short source name is visible and occupies one text
line, using actual rendered text ranges. The corrected Arabic capture was
inspected: the name, cycle, attempt ID, worker and model are legible again.
This follows the apple-design layout and typography guidance to test actual
localizations and preserve readable content. It is a layout repair, not a change
to attempt selection, receipts or agent execution.

### Test fixture — Project Studio returned another expert's activity

The initial English phone capture showed an activity error. Its shared fixture
returned all three project events for `/api/activity?agentId=1&taskId=101`,
including agent 2's event. Production's scoped history validator correctly
rejected that response. The server implementation already filters these fields.

The fixture now applies agent, task, cursor and limit filters with descending ID
order and a continuation header when needed. Product validation was preserved.
All Studio matrix variants now require the coordinator's two records in Computer,
exclude the other expert there, and require that other expert's record in the
task-wide plan/delivery history. Team and meeting content must also finish
loading before capture. This repairs evidence quality; it is not an API fix.

## Execution record

- Initial smoke checks passed **12/12**, then **8/8** including two primary-route
  cases after helper extraction. Logs: `acos-workspace-foundations-initial.log`
  and `acos-workspace-foundations-workbench-initial.log`; sessions 92284 and
  22319 exited zero.
- The initial complete matrix passed **252/252, 9.0 minutes**;
  `acos-workspace-foundations-ui.log`, session 52722 terminal exit zero collected.
  Its 504 measurements are in `test-results/workspace-foundations-final/` on the
  preceding primary-route build. This pass did not catch either finding above;
  it is not healthy-default-state acceptance for those affected views.
- Stronger assertions then failed **both selected cases** against the unchanged
  product/fixture: `acos-workspace-foundations-red.log`, session 28215 exited one.
  The failures are preserved under `test-results/workspace-foundations-red/`.
- Full workspace types and build passed after repair:
  `acos-workspace-foundations-build.log`. The command wrapper then exited one
  because the bundle script was initially invoked at the root, where it does not
  exist. The corrected workspace command passed in
  `acos-workspace-foundations-bundle-corrected.log`: **1310.9 KiB raw / 387.9 KiB
  gzip**, unchanged budgets.
- Both reproduced cases passed after repair, **2/2, 10.7 seconds**:
  `acos-workspace-foundations-green.log`, session 61538 exited zero. Their final
  captures are in `test-results/workspace-foundations-green/`.
- The complete affected Operations and Project Studio suites passed **161/161,
  zero failures, 8.0 minutes**: `acos-workspace-foundations-repaired.log`, session
  98234 terminal exit zero collected. This includes 56 matrix cases remeasuring
  196 states on the repaired build and 105 existing interaction/recovery cases.
  Product and test source remained unchanged while the runner was live.
- Full formatting and `git diff --check` passed:
  `acos-workspace-foundations-format.log`, session 71550 exited zero. The final
  documentation edits were formatted and whitespace checked separately. The CI
  YAML also passed Prettier parsing/formatting; an initial ad hoc parser command
  used an unavailable module path and was not counted as verification.

## Visual review

Initial inspection covered Company Room, expert settings/tasks/statistics/chat,
provider settings, Team Studio, fleet/project operations, browser, terminal,
file list/editor and Project Studio workspace. It found the two issues above.
Further samples covered German expert settings, Russian sampled statistics and
both Chinese scripts in task/conversation views. Historical source identities,
prompts, model names, commands and transcripts intentionally retain their source
language. These are visual samples, not native-speaker translation certification.

**27 images were actually inspected**, spanning all seven locales. The exact
paths, variants and hashes are in
`test-results/workspace-foundations-repaired/visual-inspection-manifest.json`.
This sample includes both before-correction findings and seven post-correction
images: all five English phone Studio views, Arabic dark desktop operations and
Turkish light desktop operations. The two operation cards now preserve readable
identity and metadata; Computer displays the two scoped source records, while
plan/delivery retain task-wide evidence. The first-meeting action and team links
remain reachable in the narrow layout. Every matrix variant was not visually
reviewed.

The repaired build's manifest fingerprints 198 built files under
`test-results/workspace-foundations-repaired/build-manifest.json`. Its HTML
SHA-256 is `e58621d85cd1e76f13c54b3eb4316b1ab5a5294347f233400742dab7c4770067`.
The initial 504-state matrix used the primary-route build, whose manifest is
`test-results/route-foundations-final/build-manifest.json` (HTML SHA-256
`442d12fcee6854c3dbfaced7dedadf2e2e53c74a80195a578a686dc612c90816`).
Only Operations and Studio were rerun after this scoped repair; the other seven
workspace suites retain the initial matrix evidence pending the combined release
run. Both builds are local working-tree evidence.
The adjacent `capture-manifest.json` fingerprints **2,033 image/measurement
files** across the initial full matrix, two corrected cases and affected-suite
rerun. These include repeated captures and are not a count of unique reviewed
screens.

## CI and remaining acceptance

The new nine-minute matrix plus the earlier 12.1-minute source and 15.3-minute
browser baselines already sum to over 36 minutes before other new tests, setup,
native database checks or retries. The two general CI jobs now allow 60 minutes
instead of 35. This is a measured capacity adjustment, not a remote CI pass.

Expanded controls, recovery/loading states, first-run/sign-in/shared overlays,
text-size/reflow and complete keyboard/focus acceptance still need final route
review. The existing suites cover many interactions; the default-view matrix is
not a substitute for them. Native phone HTTPS, Safari, input methods, assistive
technology, native-language reviewers, live provider behavior and native
PostgreSQL/Docker evidence remain separate requirements. The final combined
release suites, content/history secret scan and reviewed clean candidate are
still outstanding. No publication or real 24-hour claim was made.
