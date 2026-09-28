# Primary route text resizing — 28 September 2026

Status: this focused checkpoint passed after the repairs below. Goal 7 remains
active. This is local working-tree evidence, not a public release or full
accessibility certification.

## Method and scope

`tests/ui/text-resize.spec.ts` changes Chromium's actual default font preference
from 16 to 32 px through
[`Page.setFontSizes`](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-setFontSizes).
It is a text-preference check, not pinch zoom, full-page browser zoom, a native
phone setting or a screen-reader test. Fixed-pixel secondary chrome can remain
unchanged; the root, heading and control font measurements are recorded.

The expanded probe covers all seven locales at 320 × 740, plus English, Arabic
and German at 1366 × 900. Phone uses light appearance except Arabic dark;
English/Arabic desktop use dark and German uses light. This is not every theme
and text-size combination. It visits Home, expert directory, new expert,
empty Projects, new project, Skills, empty Approvals and the unknown-route page.
It also opens expert advanced settings and the first skill using the keyboard.
After opening expert settings, Tab must reach the model selector and then the
custom-instruction switch; the focused switch must fit inside the viewport.
The test restores the browser font preference and detaches its CDP session in
a finally block. The shared route audit now includes searchbox controls.
Fixtures supply server records; production frontend code and locale chunks are
real. No external model is called and no project/expert is saved.

The audit checks root font size before and after direct viewport captures,
toolbar actions within the viewport, the shell content's own horizontal extent,
accessible names, control dimensions and duplicate IDs. Root-document overflow
alone missed content clipped inside the shell. Direct viewport and bottom
captures accompany the measurements; their existence is not visual acceptance.

### Probe calibration and evidence limits

The initial three tests passed, but visual calibration showed that Playwright's
full-page screenshot helper changed this emulated preference while preparing
the image. The early `text-resize-initial/` and `text-resize-calibration/`
captures therefore do **not** establish large-text acceptance. Direct CDP
captures were moved before screenshot helpers, font size was asserted again,
and the shared route audit gained an option to measure without capturing.
The corrected probe reproduced toolbar and inner-content clipping.

The expanded run also exposed three probe readiness errors: a lazy localized
route temporarily unmounted its heading while a raw DOM font read ran. The
test now awaits the fixture network's idle state and uses a locator for the
heading measurement. There are no permanent requests in these fixtures. This
is a readiness repair, not a product error or permission to ignore missing
headings. Closed-details descendants are excluded from overflow diagnostics.

## Product findings

- Four phone toolbar actions could extend beyond the screen when rem-based
  sizing grew. Their icon-only phone targets now remain 44 px, the action group
  does not shrink, and the page-title area can truncate. Content text still grows.
- Shared buttons could resist wrapping and inputs could impose intrinsic widths.
  Buttons now allow wrapping and bounded width; inputs permit shrinking.
- Home and directory headings used pixel-only responsive sizes. Their equivalent
  rem sizes now respect the default font preference and allow long words to wrap.
- Home's team portraits and the new-project team selector needed multiple rows.
  Loading and populated rows now wrap. The project status filter also wraps.
- Home submit and expert-create minimum widths exceeded the available card width.
  They now keep their normal minimum only when the containing width permits it.
- Implicit single-column grids, long German labels, directory guidance and skill
  titles could impose oversized intrinsic widths. Explicit constrained columns
  and word wrapping preserve the complete text. Skill category labels use their
  own line on phone.
- Open expert settings exposed overflowing custom-prompt and permission switches.
  Their rows now wrap; switches can move below their associated explanations.
- Visual inspection after the clipping repairs still found excessive word
  fragmentation because horizontal padding doubled with the font. Phone shell
  padding now remains 16 px and expert/skill card insets remain 20 px. Text keeps
  growing while more horizontal space stays available for reading. Normal
  16 px-default spacing is preserved.

### Selected model label: found after the matrix passed

The 92-case checkpoint below passed, but inspection of the German expanded form
showed that its selected model value was clipped. The full label is
`Automatische Auswahl (empfohlen)`, not just the visible prefix. A stronger
rendered assertion reproduced **449 px of content in a 138 px value box**.
The shared trigger's single-line value clamp caused this even though the outer
form no longer overflowed. The model-mode field now permits wrapping and an
automatic height, with bounded phone insets. The shared Select component and
other selection fields were not changed. The repaired German value measures
170 px wide and 120 px tall, with equal content and visible extents. It retains
the complete recommendation text. The initial green matrix did not close this
finding; the stronger rerun and inspected repaired image supply that evidence.

No dependency, service, authority boundary or agent execution behavior was added
by these layout changes. Existing source identities and authored content remain
intact. The apple-design typography and layout guidance informed the repairs.

## Execution record

- Calibrated initial probe: two phone cases failed and German desktop passed;
  `acos-text-resize-red.log`, terminal session 64256, exit one.
- After the first layout pass, English/Arabic Home and new-expert still overflowed;
  `acos-text-resize-repair-1.log`, session 27090, exit one, two failed / one passed.
- After bounding submit widths and wrapping the team crest, the original three
  cases passed in 25.5 seconds; `acos-text-resize-repair-2.log`, session 32155,
  terminal exit zero. Full types and build passed in `acos-text-resize-build-2.log`.
- The wider matrix then reported eight failures / two passes in 1.6 minutes;
  `acos-text-resize-expanded-red.log`, session 74664, terminal exit one. Five
  failed cases contained actual clipping; three additional cases failed the
  transient-heading probe described above. Traditional Chinese phone and English
  desktop passed that stage. Failed evidence remains in its own output directory.
- The expanded ten-case probe then passed in 2.4 minutes;
  `acos-text-resize-expanded-repair-1.log`, session 14227, terminal exit zero.
  This precedes the final inset improvement and explicit switch-focus assertion.
- The full selected browser group then passed **92/92, zero failures, 8.8 minutes**;
  `acos-text-resize-final.log`, session 14201, terminal exit zero. This includes
  82 normal-size checks and ten large-text cases: 224 normal primary-route states
  plus 100 large-text states. It covers all seven languages, both normal-size
  themes, onboarding, authentication/recovery, expert/project forms, library
  handoff and shared controls. It is not the repository's complete browser suite.
- The selected-model assertion then failed against the unchanged build in the
  German phone case; `acos-text-resize-selected-model-red.log`, session 71120,
  terminal exit one. The rendered width record and captures are preserved in
  `test-results/text-resize-selected-model-red/`.
- Full types and production build passed after the final layout repairs;
  `acos-text-resize-build-final.log`, session 77720, terminal exit zero. The
  unchanged bundle gate passed at **1312.0 KiB raw / 388.3 KiB gzip** (tool output).
- Full repository formatting passed in `acos-text-resize-format.log`, session
  94460, terminal exit zero. `git diff --check` also passed. Documentation is
  formatted again after its final evidence update.
- The current production dependency audit found no known vulnerabilities;
  `acos-text-resize-security-audit.log`, terminal exit zero. The production license
  policy passed in `acos-text-resize-licenses.log`, terminal exit zero. These are
  dependency checks, not a source/history secret scan.
- Full source/server testing passed **1,313 tests, zero failures and six explicit
  skips**: 1,319 total in 209 discovered files, 772.8 seconds;
  `acos-text-resize-full-source.log`, session 95248, terminal exit zero. This run
  includes the history and capability-library changes that postdated the previous
  full gate. Product source stayed unchanged throughout the run. It precedes only
  the final model-mode field CSS repair; no backend or agent logic changed after
  the full gate. Five skipped checks require native PostgreSQL; the sixth is a
  Windows output-symlink setup that returned EPERM. Skips are not passes.
- Full types/build passed after the final model-mode correction in
  `acos-text-resize-selected-model-build-2.log`, session 41299, terminal exit zero.
  An intermediate build changed the department selector instead; inspection
  caught that draft, it was reverted, and only the intended model-mode field is
  changed in this final build. The final bundle gate passed unchanged limits at
  **1312.4 KiB raw / 388.4 KiB gzip**, `acos-text-resize-model-bundle.log`.

- The final affected suites passed **26/26, zero failures, 2.9 minutes**:
  `acos-text-resize-model-repaired.log`, session 57910, terminal exit zero. These
  are all ten large-text cases with the stronger selected-value assertion, seven
  expert-localization cases and nine onboarding cases. All 100 large-text states
  were remeasured. Product/test source stayed unchanged during the runner.

## Visual review and provenance

Twelve images were actually inspected across all seven locales. Three normal-size
samples cover English Home, Arabic specialty cards and the Arabic emergency
dialog. Seven large-text samples cover the growing Turkish/Russian headings,
English/Arabic keyboard focus, Simplified Chinese project actions, Traditional
Chinese skill disclosure and the German caption finding. Two inspected repaired
captures then verify the full German model caption and preserved English focus.
The sample is not every state or a native-speaker translation review.

Exact paths and hashes are in
`test-results/text-resize-model-repaired/visual-inspection-manifest.json`.
Its adjacent capture manifest fingerprints **1,418 image/measurement files** from
the 92-case checkpoint and corrected 26-case run; these include repeated views.
The repaired build manifest fingerprints 198 files, with HTML SHA-256
`0a90cf43903376bd3cf1d25c4379b99d925e08721b590b2b7ff3fa050461cf9a`.
The preceding 92-case build is separately fingerprinted in
`test-results/text-resize-final/build-manifest.json`, with HTML SHA-256
`4f32a6c621d844b960c08ea668c81fbfb9492e8dfc7bfd9cb54b135f47a746c3`.
These describe an uncommitted working tree based on
`81151c63e4bbf35fad39256566b3e362fb3325d0`, not a clean reviewed public commit.

## Remaining acceptance

Large-text acceptance remains open for first-run/authentication, shared overlays
and the other workspace routes. Full-page zoom, physical phone HTTPS, Safari,
native input methods and assistive technology are unverified. Docker, psql,
Tailscale and the two secret-scanner CLIs were still absent from PATH; checked
standard Docker/Tailscale/PostgreSQL installation locations were also absent.
Nothing was installed. The full content/history secret scan, complete browser
release suite, native database/container checks, reviewed clean candidate and
publication remain outstanding. No real 24-hour claim is made.
