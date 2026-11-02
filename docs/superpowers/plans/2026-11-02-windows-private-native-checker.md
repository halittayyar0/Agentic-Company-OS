# Windows private checker implementation

Use the [design](../specs/2026-11-02-windows-private-native-checker-design.md). Work in the existing isolated PR100 checkout and preserve every rejected original CI record. Do not change source deadlines, skips, original test expectations or branch protections to obtain a pass.

1. RED: actual valid Windows vault operations under an unavailable system PowerShell. Retain failed-empty-vault cleanup and explicit-retry coverage with a missing bundled checker.
2. Implement and locally compile the minimal Win32 checker, deterministic recipe and bounded protocol. Verify actual owner/SYSTEM ACLs and read-only token role on owned fixtures, without application/model calls or privilege changes.
3. Bind the checked binary to reviewed source/build provenance and an immutable digest. Implement the fail-closed shared loader and replace only Windows storage/user-admission subprocesses. Retain deadlines, diagnostic redaction and all filesystem guards.
4. Ship the asset beside every relevant source/bundled/native/portable entrypoint; verify relocatable bundles and altered/missing asset failures. Update user recovery text in all seven locales where affected and document the build/unsigned boundary.
5. Review security and packaging, then run appropriate local source/type/build/format/secret/runtime checks. Update exact platform census only for genuine added cases; preserve old skip names and complete UI requirements. Commit/push under Halit Tayyar, no coauthors.
6. Qualify the new original PR candidate and ordinary protected merge. Fresh actual-main/source/native/genuine/distribution/public readback gates remain separate; all984-specific helper bindings must be replaced after the real repair identities exist.
