# Primary route foundations — 28 September 2026

Status: this focused checkpoint passed. This extends the Goal 7 route inventory; it is not full
release, native-language or real-device acceptance. The preceding goal turn
completed and verified the 30-guide / ten-tool capability library, so it was
progress. The current checkout remains the authoritative, uncommitted working
tree on `codex/oss-operator-recovery`.

## Scope and method

The product is a web workspace for an operator managing experts and projects.
This review applies Apple HIG accessibility, readability, layout, feedback and
input principles to web controls. Native Apple navigation conventions are not
requirements for this web application. The existing editorial headings,
restrained status colors and team portraits remain its visual identity.

`tests/ui/route-foundations.spec.ts` checks eight reachable surfaces: Home,
expert directory, New expert, empty Projects, New project, Skills & tools, empty
Approvals and the unknown-route page. The matrix covers all seven locales,
light/dark appearances and 320 × 740 / 1366 × 900 viewports. Each surface records
a capture and measurements; each combination checks application errors,
unexpected fixture requests and absence of project/expert creation.

Role queries use the browser's exposed accessible controls, with accessible-name
assertions. Bounds include clickable associated labels. Collapsed content and
Radix's hidden form inputs are excluded by accessible-role queries, rather than
misclassified as visible controls. Measurements check horizontal page overflow,
duplicate IDs and controls below 28 px on phones / 20 px on desktop. These are
the HIG minimums used as a review floor; they do not prove every recommended
44 px phone target or complete WCAG conformance. Native screen-reader testing
and physical-device input remain separate.

Existing route-specific suites continue to own form validation, permission
handling, language-file failures, loading/error/empty states, focused keyboard
flows and mutation recovery. The matrix does not replace those tests or prove
that every state is visually accepted. Captures need actual inspection; their
existence alone is not a passing visual review.

## Reproduced finding and correction

**Critical — Home's View all target was only 16 px high.** This was reproduced
in both English light and Arabic dark at 320 px. Apple HIG
`accessibility.md > Mobility` recommends sufficiently sized controls (44 × 44
default, 28 × 28 minimum on phones). The standalone navigation action fell below
that minimum. Its desktop height also fell below the 20 px minimum.

The link now has a 44 px minimum phone height, 32 px desktop height, horizontal
padding and an explicit keyboard focus ring. Source: `pages/dashboard.tsx`.

The first probe (`acos-route-foundations-initial.log`) also reported controls
inside closed disclosures and hidden native form inputs. Those were measurement
false positives. After changing the probe to accessible-role queries, the
unchanged product still failed exactly the genuine View all finding in both
phone cases: `acos-route-foundations-red.log`, two failed; session 34942 terminal
exit 1 collected. No product change was used to silence hidden-control reports.

References read from the apple-design skill include accessibility, layout,
typography, color, iOS/macOS design, entering data, text fields, loading and
feedback. Relevant guidance: `layout.md > Best practices` calls for previews
across localizations and text sizes; `typography.md > Ensuring legibility`
requires contextual legibility testing. Actual contrast claims require computed
colors; screenshots alone are not used to invent contrast ratios.

## Current verification

- Full workspace types and production build passed:
  `acos-route-foundations-build.log`, session 27616 terminal exit 0 collected.
- Bundle passed unchanged limits after the touch-target correction:
  **1311.0 KiB raw / 387.9 KiB gzip** for code with one selected language per
  surface, `acos-route-foundations-bundle.log`. The separately documented
  capability-library allowance remains in force; no new ceiling was raised.
- Production Chromium passed **42 tests, zero failures, 4.4 minutes**:
  `acos-route-foundations-ui.log`, session 50980 terminal exit 0 collected. This
  is 28 matrix combinations × eight routes (**224 route states**) plus 14
  existing Home, New expert and New project interaction/recovery tests. All
  exposed controls passed accessible-name and minimum target-size checks;
  duplicate IDs, page overflow, unexpected API requests and page errors were
  absent in this scope. Captures and 224 measurement records are under
  `test-results/route-foundations-final/`.
- The corrected English View all target measures **79.94 × 44 px** on phone and
  **79.94 × 32 px** on desktop. This closes the reproduced size finding.
- Desktop content scrolls inside the shell. A normal fullPage screenshot does
  not include that scroller's lower content, so the test now captures overlapping
  scroll segments too. The extra English/Arabic × light/dark desktop run passed
  **four tests, 38.9 seconds**, `acos-route-foundations-scroll.log`, session 2856
  terminal exit 0 collected. `test-results/route-foundations-scroll/` includes
  32 initial route captures and 36 extra scroll segments. Product/build source
  remained unchanged throughout both runners.
- Full formatting and `git diff --check` passed:
  `acos-route-foundations-format.log`, session 68303 terminal exit 0 collected.
- `test-results/route-foundations-final/build-manifest.json` records all **198
  built files**; HTML SHA-256 is
  `442d12fcee6854c3dbfaced7dedadf2e2e53c74a80195a578a686dc612c90816`.
  The adjacent `capture-manifest.json` fingerprints **549 images and measurement
  files** across the two final output directories. These identify local evidence,
  not a reviewed source commit or remote CI result.

## Visual inspection

The initial three English light phone images were inspected before correction.
The following **16 final images** were then inspected, independently of the
automated measurements. This is sampling across all seven scripts/locales and
all eight routes, not native-speaker review or visual acceptance of all 224
combinations.

| Locale / appearance / viewport     | Captures inspected                                                        | Observation                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| English / dark / desktop           | Home, directory, empty Projects, empty Approvals, New expert, New project | Clear heading/action hierarchy, restrained status colors and readable form grouping. Stored Turkish expert names remain source identities rather than untranslated application labels. |
| English / light / phone            | Unknown route                                                             | Explanation and home action fit the narrow panel.                                                                                                                                      |
| German / light / phone             | New expert                                                                | Long role names and action labels wrap without losing their controls.                                                                                                                  |
| Russian / dark / phone             | New project                                                               | Long project-type and priority labels wrap within the form; submit remains distinct.                                                                                                   |
| Turkish / light / phone            | Skills & tools                                                            | Thirty guides and ten tools remain searchable and grouped; the long list scrolls normally.                                                                                             |
| Simplified Chinese / light / phone | Empty Projects                                                            | Search, history boundaries and first-project action stay in frame.                                                                                                                     |
| Traditional Chinese / dark / phone | Empty Approvals                                                           | Status choices, count, reload and empty explanation remain readable.                                                                                                                   |
| Arabic / dark / phone              | Home, New expert                                                          | Right-to-left alignment, mixed-script icons, field labels and action order remain legible.                                                                                             |
| English / light / desktop scrolled | New expert lower section                                                  | Identity fields, advanced disclosure and create/cancel controls remain visible below the initial viewport.                                                                             |
| English / dark / desktop scrolled  | New project lower section                                                 | Project type, priority and submit stay on one organized desktop row.                                                                                                                   |

## Remaining audit

Continue the remaining profile/chat/computer, Project Studio, Operations,
Team Studio, Company Room and Settings surfaces, their state combinations and
text-size/reflow behavior. The subsequent [workspace checkpoint](2026-09-28-workspace-route-foundations.md)
adds their default-view matrix and records two findings from actual visual review.
Expanded advanced controls, every loading/error state,
complete text-size behavior and all visual combinations are not attested by this
default-state matrix; their route-specific evidence still needs final review.
The final combined release suites and external environment requirements remain
open in the release-readiness ledger. No publication or real 24-hour claim was
made.
