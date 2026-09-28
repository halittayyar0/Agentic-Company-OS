# Workspace routes with enlarged text

Date: 2026-09-28. Branch: `codex/oss-operator-recovery`, base HEAD
`81151c63e4bbf35fad39256566b3e362fb3325d0`. This is an uncommitted local verification
checkpoint, not a clean release candidate.

## Scope and method

The nine existing workspace route suites now include 17 enlarged-text variants:
all seven locales on 320 × 740 phone viewports in light and dark themes, plus
English dark, German light and Arabic dark at 1366 × 900. The complete selection
contains 153 cases covering 306 route states: Browser, Company Room, Computer /
Terminal, four expert profile views, file list/editor, fleet/project Operations,
five Project Studio views, Settings and Team Studio.

Chromium's actual font preferences are 32 px standard and 26 px fixed width.
Direct CDP captures preserve these preferences; Playwright's regular screenshot
path would reset them. Measurements cover root/content extents, nested painted
text clipping, button labels, selected tab visibility, accessible names, duplicate
IDs and control minimums. Top, bottom and visible panel-start captures supplement
the numeric checks. These are text enlargement tests, not full-page zoom, native
Dynamic Type or physical-device acceptance.

The existing UX contract deliberately supports horizontally scrollable tab strips
and named, focusable timeline groups. Those regions are measured separately from
accidental content overflow. The first probe incorrectly treated their offscreen
items as clipping; correcting that test did not waive selected-tab bounds or
actual content clipping. Enlarged-text keyboard checks now exercise End/Home,
focus visibility and restoring the original tab, plus directional scrolling for
overflowing named timeline groups.

## Findings and changes

- Phone padding was scaling with enlarged type at multiple nested levels, leaving
  too little room for profile, computer and project content. Fixed phone insets
  preserve room while the text remains enlarged; desktop spacing is retained.
- Explicit single-column grid tracks and `min-width: 0` on the terminal fieldset
  remove intrinsic minimum-width overflow.
- File row spacing and its 44 px delete target preserve space for filename and
  metadata. Source values are unchanged.
- The operations ring stays within its container instead of doubling its graphic
  size with the font. Its horizontal interval timeline retains keyboard access.
- Project team names and roles wrap instead of being ellipsized in narrow cards.
- Computer selections need horizontal reveal on selection, resize and keyboard
  focus. The expert profile's existing reveal behavior is shared in the Tabs
  module; it neither takes focus nor changes vertical scroll.

## Investigation evidence

All logs below are in the host temporary directory. Failed runs are retained.

| Run                                      | Result                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `acos-workspace-text-red.log`            | 12 failed / 15 passed; included invalid assumptions about intentional scrolling.                                                             |
| `acos-workspace-text-calibrated-red.log` | 9 failed / 18 passed; isolated real nested overflow in Terminal, profile, files, ring and Project Studio.                                    |
| `acos-workspace-text-repair-1.log`       | 2 failed / 25 passed; layout repaired, selected Terminal tab partly outside its strip.                                                       |
| `acos-workspace-text-repair-2.log`       | 4 failed / 23 passed after adding stronger keyboard checks; selected tabs fit, but Home could leave the focused computer tab partly clipped. |

The second production build's base gzip total exceeded its existing budget. The
third build measured 1,344,883 raw bytes / 398,142 gzip bytes; the skill-library
allowance was 2,048 gzip bytes, so base code was 396,094 bytes against the unchanged
396,000-byte base cap. Neither build is a passing performance checkpoint.

## Expanded and visual review

`acos-workspace-text-expanded.log` completed with 131 passed / 22 failed (8.6 min).
The failures exposed Turkish/Russian computer tabs wider than their strip,
Russian Project Studio tabs, and German/Russian Settings search/grid squeezing.
Computer tabs now have a bounded width and can wrap; Settings gives search and
clear controls separate phone rows. The subsequent complete matrix passed
**153/153, zero failures, 7.1 minutes** in `acos-workspace-text-reviewed.log`.

The 153-case pass did not catch every visual defect. Actual image inspection found
an anonymous flex text item squeezing the Browser heading into single characters,
truncated browser identity, oversized chat decorations/insets, a squeezed file
breadcrumb, a broken meeting-action word and an enlarged team symbol overlapping
its fixed grid track. Additional text-range and geometry assertions reproduced
these issues. `acos-workspace-text-readability-red.log` recorded 11 failures / nine
passes; the overlap assertion was initially inserted in a different, unselected
test and was moved to its intended audit case before claiming that evidence.
`acos-workspace-text-symbol-red.log` then reproduced both the actual team overlap
and a split longest breadcrumb word (two failures).

Browser title and identity now use separate lines. Phone Browser/file insets and
chat decorations preserve text space. File breadcrumbs own a phone row, meeting
action spacing accommodates whole words, and team symbols match their 36 px
track. These are presentation changes; source identities and action semantics
remain unchanged.

Development-only component display names are retained in development and omitted
from production for the touched shared form/overlay/tab components. No bundle
limit was raised. Build 4 passed at 1312.7 KiB raw / 388.7 KiB gzip; the subsequent
visual repairs required further trimming. Builds 5 and 6 are retained failures;
build 6's base code exceeded its original gzip cap by 28 bytes.

The 153-case build manifest fingerprints 198 files, with `index.html` SHA-256
`323b9d44cb63faffec299e5006acab9b5c5e2380af8b6afdc8992a402b18953c`.
That build predates the final visual repairs; it is not the final candidate.

## Final build and capture evidence

Full workspace types and production build passed in
`acos-workspace-text-build-final.log` (session 49715, terminal exit zero).
`acos-workspace-text-bundle-final.log` passed unchanged limits at **1312.8 KiB raw /
388.7 KiB gzip**, including the separately budgeted skill library.

Full formatting and `git diff --check` passed after the repairs and report updates
in `acos-workspace-text-format-complete.log` (session 50169, terminal exit zero).
The initial formatting failure concerned this new report and was corrected.

The five affected enlarged-text suites ran 85 cases in
`acos-workspace-text-final.log`: **79 passed / six failed**, 5.0 minutes. All six
failures were a newly added single-line heuristic for long German or continuous
Chinese breadcrumb text. The rendered labels were readable in two lines; forcing
them to one line was not a valid phone requirement. The final assertion permits
two lines, while still rejecting the original character-by-character stack.
All 17 file variants are included in the ensuing regression run. Its result is
recorded separately; the six failed assertions are not described as a green run.

That final focused runner passed **280/280, zero failed, 10.4 minutes** in
`acos-workspace-text-regression.log` (session 35590, terminal exit zero collected).
It contains **263 normal-size flow checks plus all 17 enlarged-text file cases**.
Together with the 68 non-file cases in the preceding run, this completes the 85
affected enlarged-text cases on the final build, including the stronger visual
regressions. The normal flows cover all nine workspace suites, shared UI, shell
localization and the skills library. This is a focused selection, not the entire
repository browser suite.

Twenty images from the complete 153-case build and six from the repaired build
were actually inspected, across all seven locales, both themes and all 18 route
states. The repaired samples cover the Arabic Browser heading/identity, Turkish
conversation word, Russian/Chinese breadcrumb, German team symbol and Turkish
meeting action. This is representative visual review, not every capture or a
native-speaker review.

`test-results/workspace-text-final/visual-inspection-manifest.json` records those
26 image paths and hashes. Its capture manifest fingerprints 3,700 PNG/control/
measurement/keyboard files across the two builds and final regression run,
including repeated states and failed-run captures. Measurement counts are 306,
187 and 34 respectively. The final build manifest fingerprints 198 files, with HTML
SHA-256 `42bbe8bcf39cab3156011d22bc1820a692da4073f9e2ebf869f5138bfe07a89f`.
After the 280-case run, all 198 built-file hashes and the file count remained
unchanged; `regression-provenance.json` records that comparison. Product/build
source stayed unchanged during the final runners. The breadcrumb assertion was
calibrated between runners, not while a test process was live.

## Remaining release work

This checkpoint does not replace full source/browser release gates, a reviewed
clean candidate, full secret scanning, native PostgreSQL/container verification,
physical-phone HTTPS, Safari, assistive technology or native-speaker review.
No publication or real 24-hour run is claimed.
