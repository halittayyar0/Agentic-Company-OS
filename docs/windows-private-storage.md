# Windows private storage

Windows x64 packages use the adjacent `windows-private-helper.exe` to protect
private records and check that native setup runs with an ordinary user token.
The checker calls Windows metadata and security APIs directly. It reads no file
contents, starts no shell or model, changes no account privileges, and does not
need PowerShell for those operations. Other Windows features can still use
system tools.

Keep the entire extracted package together. If a helper is missing or its bytes
have changed, re-extract the complete verified package into a separate folder
and start it normally. Do not copy an arbitrary executable into the old folder
or grant broader access to the private data directory. Existing directories
and records are checked without changing their permissions. Secret contents
and protected actions remain unavailable when checks fail.

Source checkouts include the pinned Windows asset. API, worker, upgrade and
ChatGPT connection bundles share the copy in `artifacts/api-server/dist`.
Windows native bootstrap and PostgreSQL staging share the copy beside
`scripts/src/setup/bootstrap.mjs`; the portable container installer includes
that copy too. Unix native bundles do not execute or require this Windows
component. Packaging checks the C source and executable against the shared
manifest before copying it, and includes the runtime notice and
`windows-private-helper.provenance.json` beside each executable. The provenance
records the immutable original producer, both build inputs and native check
results; it remains available if the temporary CI artifact expires. Runtime launches
check the adjacent asset's exact digest, size, file type and canonical path.

Versioned Windows native packages from 0.5.10 require both executable copies in
their hashed inventory. Published 0.5.9 inventories remain readable, preserving
the guided upgrade baseline. An accepted old inventory alone does not prove a
successful upgrade.

## Building and checking the component

Build on Windows x64 with an appropriately licensed existing Visual Studio
C toolchain and Windows SDK. The reviewed source has been built with the local
Visual Studio 2022 toolchain and the hosted Visual Studio 2026 toolchain. Their
executable bytes differ; always use the provenance matching the pinned asset.
The script finds installed tools; it downloads or
installs nothing. End-user installation does not compile this component.

```powershell
python -B -X utf8 scripts/build-windows-private-helper.py --out C:\build\checker-first
python -B -X utf8 scripts/build-windows-private-helper.py --out C:\build\checker-second
node scripts/check-windows-private-helper-lifetime.mjs C:\build\checker-first C:\build\lifetime.json
node scripts/check-windows-private-helper-security.mjs C:\build\checker-first C:\build\security.json
```

Use fresh output paths. Builds use MSVC static analysis with warnings as errors,
static C runtime linkage and executable mitigations. The build record hashes
used headers, compiler binaries and linker inputs. The conformance commands
create only synthetic temporary fixtures and remove their owned files. They
resolve Windows temporary-directory aliases before checking canonical paths;
the production checker continues to reject redirected paths. PowerShell is
used only to construct and independently inspect test ACLs.

Two separate builds must produce identical executable bytes. Compare the exact
source and executable digests, run both conformance commands, then update the
asset and its pinned manifest together. A different compiler or SDK can produce
different bytes. Preserve original failures; a passing component is separate
from application, actual-main and final extracted-package qualification.

The executable is unsigned. No code-signing certificate, SmartScreen reputation
or compatibility beyond the qualified Windows target is implied. Foreign-owner
fixtures requiring another account and UNC shares are outside the current
conformance report. The C source is MIT; the static Microsoft runtime retains
its separate terms in the [runtime notice](../deploy/native-attribution/WINDOWS-PRIVATE-HELPER-NOTICE.txt).
