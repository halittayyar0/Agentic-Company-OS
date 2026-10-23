# Explicit table results: development evidence

A genuine local Qwen file task previously read the held notes but returned
bullets instead of the requested pipe rows. Its judge falsely accepted the
format. That failure remains recorded in the schema-recovery verification note;
this change does not retroactively turn it into a success.

The operator can now choose a saved table contract with ordered column headings.
The server validates the actual proposed table before reserving completion or
calling the judge. Legacy free-text tasks remain unchanged. Required operation
success, scoped tool permissions, leases, accounting, review and bounded step
recovery remain enforced. This verifies structure, not facts or row completeness.

## Evidence collected before candidate freeze

- 111 focused tests passed without skips, cancellations or retries: parsers,
  request identity, API creation/readback/conflicts, draft/reuse, prompt safety,
  format gating in seven languages for finite and continuous tasks, and bundle
  ownership/size boundaries. A deliberately permissive controlled judge could
  not bypass a bad table. The independent delegation/language suite also passed
  54 tests, including child-only layout selection and malformed-input rejection.
- 17 Chromium cases passed at 320px: seven languages in light/dark mode,
  200% text, incomplete drafts, reload, lost acknowledgement and deliberate
  removal; English/Arabic saved-layout reuse also passed. These are browser
  fixtures, not physical-device or genuine model acceptance.
- All library/application/script type checks passed. The workspace build passed
  before final bundle-only refinements; later frontend production builds passed.
  Dependency audit reported no known vulnerabilities; license policy passed.
- A fresh owned PostgreSQL 17.10 migration test passed, preserving old task and
  receipt data and rejecting malformed layouts. A separate real native install,
  authenticated API, restart and binary backup/restore preserved finite and
  recurring layout fixtures, Unicode headers and request identities. Those
  fixtures were cancelled deliberately before inference. They prove durability,
  not task quality. Both owned database processes were verified stopped.
- Bundle checks passed with original ceilings retained. New source-owned layout
  code has separate strict bounds: 5,808 raw / 2,520 gzip bytes with one selected
  language (6,500 / 3,000 cap); 9,186 raw / 4,972 gzip including seven new packs
  (10,000 / 5,500 cap). Mixed legacy chunks receive only exact new-fragment
  credit. Hash mismatch, borrowed source, overflow and unexpected guards fail.

The initial phone snapshot exposed vertically split removal labels at 200%
text. A failing width regression reproduced it; stacked mobile controls fixed
it. The original failed browser artifacts remain private. Early saved-view
fixture tests used the wrong translation-key name and failed before a click;
correcting that fixture produced two passing cases. Initial bundle failures are
retained, including a 21-byte reuse overage, draft integration and generic locale
filename collisions. The final checks do not enlarge any original cap.

Native migration proof: owned directory `acos-result-format-migration-UAFjHs`.
Native durability proof: owned directory `acos-native-install-proof-h7CdMW`.
Private raw evidence is kept outside the published source; no credentials or
held raw request bodies are included here.

## Remaining acceptance

Fresh genuine held-file acceptance on a clean frozen candidate, its original
cross-platform/security checks, main integration, exact-main native archives
and public-byte delivery are still required. A broad development source run was
started while development continued, so its result must not be labelled frozen
candidate acceptance. Prepared version 0.5.9 is not a public release.

The older 0.5.8 actual-main platform workflow 39990571669 did not qualify:
macOS Intel source job 120540952665 exceeded its original 45-minute deadline
while installing Chromium, before source tests started. GitHub's annotation
confirms the timeout; the source-job log was unavailable on retrieval. Both
native installation/UI jobs and Apple Silicon source tests passed, but the
aggregate gates correctly failed. This failure blocks the older release and
is retained; no rerun or timeout increase has been used to erase it. It does
not prove a product source-test failure or a successful Intel source suite.

Physical phones, native-speaker review, signing/notarization, general model
reliability and a 24-hour soak are not certified. The broader Goal remains active.
