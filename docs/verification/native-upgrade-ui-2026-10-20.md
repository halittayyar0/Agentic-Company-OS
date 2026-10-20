# Native setup and upgrade UI verification

This change extends the standalone installer with a guided native update. It does
not require a separately installed Node.js, PostgreSQL or Docker. Native package
and actual model qualification remain separate release requirements.

## Verified from source

- 67 targeted tests passed, with no skipped or cancelled tests: native inventory,
  compatibility, candidate discovery, coordinator, setup HTTP session and browser
  journeys. This includes stale review, once-only execution, preparation
  cancellation and guarded recovery.
- After final layout and control changes, 32 setup/session/browser tests passed.
- Ten application browser tests passed, including the native upgrade pause
  explanation in all seven languages and no automatic resume request.
- Root typecheck and production build passed. The native bootstrap bundled and
  its CLI help ran under a Unicode path.

The setup browser tests use the actual protected HTTP session and a simulated
upgrade executor. They verify seven authored languages, Arabic RTL, light/dark
themes, desktop/390px layouts, 200% root text size, keyboard activation and error
focus, lost acknowledgement, cancellation/recovery, stale review, expired and
missing private links, explicit connection-key reveal and safe loopback links.
Screenshots were inspected. No physical-device claim follows from these checks.

The UI stores its display language in the live local setup session, separately
from saved workspace settings. Reopening the launcher's original private link
restores the operation and language. The bearer is removed from the address bar
and is never persisted in cookies or browser storage. A plain refresh without the
original fragment needs the original link; expiration needs a new START session.

Light and dark body, supporting text, primary actions and errors exceed 4.5:1
contrast. Control boundaries exceed 3:1 on the corresponding canvas and surface.
The version summary stacks on narrow screens and remains inside its panel with
large text. Progress is phase-based; no estimated percentage or ETA is displayed.

## Static audit scope

The installed premium auditor was invoked in strict mode. Its unmodified scanner
loops on a slash in the existing `home-start-recovery.spec.ts` fixture. A retained
diagnostic trace identifies inconsistent regex-prefix boundaries between discovery
and consumption. A local diagnostic wrapper kept those boundaries consistent,
without changing the installed skill or suppressing findings.

That diagnostic scan reports 63 findings in the existing main application, with
zero unresolved files. They include component false positives and existing native
select/form/textarea/scrollbar contract gaps. They are not a clean global audit.
The two findings in the touched emergency-control component concern its unchanged
Radix dialog trigger and shared Textarea owner; neither is an actionless literal
control. Existing audit fingerprints were not expanded or used to suppress new
findings. The installer is a separately documented pre-API ownership variant;
main-app audit results are not evidence that its inline HTML has been executed.

## Remaining release qualification

Before publication, qualify a freshly extracted final archive, a fresh public
v0.5.5 predecessor, the actual GUI upgrade and a new real local-model task after
manual resume. Require matching-host native package checks for all five supported
targets, source/security/browser CI, final branch review and public artifact hash
readbacks. This document alone does not assert those results or a published release.
