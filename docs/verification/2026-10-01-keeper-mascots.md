# Keeper mascot release checkpoint

The built-in roster now uses ten original Keeper characters instead of employee
portraits. Role assignment, specialist fallbacks, custom image precedence and
reset are shared by the existing avatar component. The seven profile language
packs, application mark, README preview and contributor asset notes were updated.

## Passed evidence

- PR [#32](https://github.com/halittayyar0/Agentic-Company-OS/pull/32) passed all eight checks: source/build/audit/UI, Windows native runtime, container installation/endurance, both macOS architectures and security analysis.
- The full Chromium UI suite passed 946/946. Local phone profile and custom image/reset checks also passed; their fixtures do not establish physical-phone acceptance.
- The local production build, formatting, typecheck and bundle budget passed. The mascot atlas is 56,724 bytes, down from the removed 110,826-byte portrait atlas.
- Squash commit `b577eae30a173a8a346fde99a2c3034527f413e8` has the same source tree as the passing PR head. Distribution run [36782602275](https://github.com/halittayyar0/Agentic-Company-OS/actions/runs/36782602275) built the immutable multi-platform image and passed installation/resume before packaging.
- Public [v0.3.7](https://github.com/halittayyar0/Agentic-Company-OS/releases/tag/v0.3.7) ZIP and checksum were downloaded anonymously. ZIP SHA-256 is `835824b73ba52d948554ccb957b4cfc76df5898106639243b0782908677926f3`; its distribution commit and image digest match the workflow metadata and release tag.
- Anonymous registry access returned the image index with Linux AMD64 and ARM64 manifests at `sha256:ae1ad0dc7d77957b95708bdc0228daaa30c03d42c2131978b54ecbed5cf532a9`.

## Limits and next work

The Windows wall-clock verifier passed with `verified24h: false`. Physical phones,
native-speaker review and a real 24-hour soak remain unverified. The intermittent
Windows restart investigation [#29](https://github.com/halittayyar0/Agentic-Company-OS/issues/29)
remains open; passing subsequent runs do not establish its root cause.

The next concrete installation gap is the backup guide's binary redirection on
older PowerShell. A separate change adds file-based backup instructions and a
real restore drill to disposable installation acceptance.
