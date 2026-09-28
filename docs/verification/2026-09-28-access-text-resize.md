# First-run, authentication and shared overlays with large text

Date: 28 September 2026. Branch: `codex/oss-operator-recovery`; base commit
`81151c63e4bbf35fad39256566b3e362fb3325d0`. This is an uncommitted working-tree
checkpoint, not a clean public release candidate. Goal 7 remains active.

## Scope and repairs

The Apple design review continued through first-run language choice, sign-in,
session-service and language-download recovery, command search, navigation and
emergency confirmation. It follows the [primary-route text-size checkpoint](2026-09-28-text-resize.md).

- Language choice now declares the preview's selected language, with English
  secondary names marked separately. Its cards and actions fit the narrow view.
- Authentication cards, retry states and the sign-in action reflow. The sign-in
  action can grow vertically, with phone spacing that preserves readable words.
- Dialog and AlertDialog share viewport bounds, one explicit grid column,
  vertical scrolling and wrapping. The close target stays 44 pixels.
- Navigation destination names wrap instead of disappearing behind ellipses.
  Phone insets, brand glyph and footer controls leave space for readable labels.
- Search input space is preserved. Expert names and roles now occupy separate
  lines with a compact portrait. Their source identities remain unchanged.
- Search keeps the selected result visible when its list shrinks, using a
  ResizeObserver that scrolls only the result list and disconnects on unmount.
- The emergency reason count stays together, and error-card phone padding leaves
  more room for readable text. Existing confirmation and error behavior remains.

The authentication, emergency authorization and agent execution protocols were
not changed in this layout checkpoint. No service or dependency was added.

## Method

`tests/ui/access-surfaces-text-resize.spec.ts` has 34 cases: all seven languages
in both phone themes, plus English/German/Arabic desktop variants, with two
flows per variant. Phone dimensions are 320 × 560; search also shrinks to
320 × 280. Desktop dimensions are 1366 × 900.

`tests/ui/helpers/large-text-audit.ts` sets Chromium's standard font to 32 pixels
and fixed font to 26. It verifies the 32-pixel root before and after direct CDP
captures. Playwright's screenshot helper is not used for this evidence because
the preceding checkpoint found it could reset the font preference.

The helper waits for surface animations and fonts, measures horizontal content,
painted text clipping, controls and fixed-surface bounds, and checks accessible
names. Deliberately hidden accessibility labels and decorative shapes are
excluded. Navigation and expert-name clipping have separate explicit checks.
Vertical content scrolls where needed; a screenshot is a viewport sample, not
proof that every part of a tall form fits at once.

Interactions cover keyboard language selection, preview language, pending auth,
service retry, invalid-key clearing, successful login, failed language download
and recovery; empty search, keyboard result selection before/after height
reduction, menu traversal and focus restoration; and one failed stop request
with reason preservation and cancellation. Protected workspace requests remain
absent during unauthenticated phases. All credentials and mutations are fixtures.

## Failures retained and corrected

1. Initial six-case probes included an incorrect emergency-copy property,
   measurements during entrance animations, and false clipping from cmdk's
   hidden label/decorative shapes. These probes are not final acceptance.
   The calibrated probe still failed six cases with actual setup/auth overflow,
   clipped destinations and emergency content wider than its container.
   See `acos-access-text-red.log` and `acos-access-text-calibrated-red.log`.
2. Initial layout repairs passed six cases in `acos-access-text-repair-1.log`.
   The first bundle exceeded the unchanged raw cap: 1313.9 KiB against 1313.5 KiB.
   Sharing the dialog foundation and removing obsolete icon overrides resolved
   it; no performance limit was raised.
3. The expanded run had 26 passes and eight failures, all from the fixture
   changing authentication state while the successfully opened document still
   initiated its first workspace requests. Ending that document before the next
   unauthenticated scenario fixed the measurement boundary. Its full rerun passed
   34/34 in `acos-access-text-final.log`; no authentication guard was weakened.
4. Visual review then found expert names squeezed out of search and awkward
   sign-in word wrapping. Stronger assertions reproduced the missing names and
   the selected last result becoming fully offscreen after height reduction in
   `acos-access-text-readability-red.log`. Layout repairs fixed the names; the
   diagnostic record showed a 149-pixel list retaining the old taller-list scroll
   position. The resize observer corrects that specific behavior.
5. The count probe initially counted text-node fragments instead of distinct
   rendered lines. It now compares line positions. A 0.99858 viewport ratio from
   subpixel rounding led to a 0.99 visibility threshold; the earlier partial or
   wholly hidden result still fails. Diagnostic/failure logs remain preserved.

## Latest verification

Logs below are in the host temporary directory. Every completed runner listed
below has its terminal result collected; these are focused selections unless
explicitly labeled full workspace.

| Gate                                 | Result                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final large-text matrix              | **34 passed, zero failed, 1.7 minutes**; `acos-access-text-reviewed.log`, session 74831, exit 0. All stronger readability/selection checks included.                                                                                                                                                                                        |
| Measured states                      | **201**, with one PNG and one measurement record per state, in `test-results/access-text-reviewed/`.                                                                                                                                                                                                                                        |
| Full workspace types/build           | Passed; `acos-access-text-resize-build.log`, session 74948, exit 0.                                                                                                                                                                                                                                                                         |
| Bundle                               | Passed unchanged limits: **1312.9 KiB raw / 388.6 KiB gzip**; `acos-access-text-resize-bundle.log`.                                                                                                                                                                                                                                         |
| Shared-dialog and library regression | **162 passed, zero failed, 6.3 minutes**; `acos-access-dialog-regression.log`, session 37645, exit 0. Twelve existing suites cover setup/auth/shell/search/emergency, expert details, file editing/deletion, approvals, Project Studio and the skills library; workspace foundation matrix cases were excluded from this focused selection. |
| Format and whitespace                | Full workspace formatting passed in `acos-access-text-format.log`, session 36912, exit 0. Final documentation formatting and `git diff --check` were repeated after recording the regression result.                                                                                                                                        |

The existing full source result remains 1,313 passed / zero failed / six skipped,
from `acos-text-resize-full-source.log`. It includes the capability library and
history repairs but predates this access/layout checkpoint. It is not presented
as a newly rerun full gate. The five native PostgreSQL skips and Windows symlink
setup skip remain explicit.

## Visual evidence and remaining work

Twelve final captures were actually inspected across all seven languages, both
themes, desktop setup, sign-in/recovery, navigation, emergency and short-height
search. The selected search result and full German sign-in caption are visible
in the repaired captures. This sample does not cover every measured state or
constitute native-speaker review.

`test-results/access-text-reviewed/visual-inspection-manifest.json` identifies
those twelve images and hashes. The capture manifest fingerprints 402 PNG/JSON
files. The build manifest fingerprints 198 production files; HTML SHA-256 is
`fe1b5b0487394cdce2664c480d5b0b36d24117875ac7abc01c1e4a3f19f89b04`.
Product/build source stayed unchanged through the final matrix and the ensuing
shared-dialog regression runner.

Large-text acceptance for the other workspace routes, expanded/recovery-state
acceptance and the final combined full browser/release run remain open. Physical
phone HTTPS, Safari, native keyboards, full-page zoom, screen readers and native
language review remain unverified. This simulated viewport change does not prove
a real phone keyboard or TLS connection. Native PostgreSQL, Docker, the full
secret scan, clean reviewed candidate and remote CI also remain outstanding.
Nothing was installed, committed, pushed or published; no real 24-hour claim is
made. See the [readiness ledger](2026-09-27-release-readiness.md).
