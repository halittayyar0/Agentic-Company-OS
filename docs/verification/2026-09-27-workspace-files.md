# Reviewed workspace files checkpoint — 27 September 2026

This checkpoint records the local Windows working tree using Node 24.19.0. Existing work is preserved and Goal 7 remains active. It adds file-integrity safeguards to the existing Computer editor; it does not complete that surface's design or seven-language migration.

## Changes

- File reads return a SHA-256 content version and an explicit editable flag. Only complete, lossless UTF-8 files without NUL bytes within the 128 KiB editor limit can be saved through the editor. Source reads are bounded to 256 KiB and regular files. Missing-file errors retain the relative workspace path and existing domain error contract.
- The HTTP writer requires the reviewed version or `missing` for create-only publication. Concurrent writes based on one version cannot both replace the file. Creating an existing name cannot empty it. Unknown input fields are rejected. This changes the earlier alpha API contract; generated clients and the self-hosting guide were updated.
- Writes stage and flush a unique file in the destination directory before rename. Create-only publication uses a hard link. Failure cleanup removes only that operation's temporary link. Cooperating file writers, deletions, directory creation and `touch` share an agent queue; native PostgreSQL additionally uses an advisory lock. `touch` now preserves existing contents.
- The client checks a successful write response against the exact submitted path, byte count and content hash. A failed or inconsistent response preserves the draft and requires a fresh read plus explicit comparison before another save. Matching current content can be accepted without a second write. An oversized draft remains intact. The textarea adapter preserves untouched BOM and mixed line endings despite the browser's newline normalization.
- Database shutdown now joins initialization before closing either backend, and concurrent callers await the same close promise. A focused test exposed a startup/close race that otherwise left the filtered file test process running. The regression test checks natural child-process exit after an immediate shutdown request.

The exact API, filesystem guarantees and exclusions are documented in [Reviewed workspace file edits](../workspace-files.md).

## Evidence

The complete local verification command finished successfully with exit 0. This is a working-tree checkpoint; the outstanding environment and product work below prevent treating it as a finished release.

| Check                                                                      | Result                                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Focused file editor browser suite                                          | 5 passed, 0 failed                                                                                  |
| Focused file/API/sandbox suite before the missing-file regression addition | 31 total: 30 passed, 1 native PostgreSQL skip, 0 failed                                             |
| Missing-file, approved effect-boundary and early-shutdown regressions      | 3 passed, 0 failed                                                                                  |
| Full root test suite                                                       | 764 total: 759 passed, 5 skipped, 0 failed                                                          |
| Full production browser suite                                              | 172 passed, 0 failed                                                                                |
| Workspace type checks and production builds                                | Passed                                                                                              |
| Database migration chain                                                   | Passed on process-lifetime PGlite                                                                   |
| Formatting, dependency audit and license policy                            | Passed; no known production dependency vulnerabilities reported                                     |
| Selected-language bundle budget                                            | 1225.0 KiB raw / 353.8 KiB gzip; passed unchanged 1,300,000-byte raw and 364,000-byte gzip ceilings |
| Combined `pnpm run verify`                                                 | Passed; exit 0                                                                                      |
| API generation stability                                                   | Two successful runs; 219 generated files, 0 changed entries on the second run                       |
| Visual review                                                              | File conflict comparison at 390px in Turkish/dark mode; not a full Computer design review           |

The file tests exercise complete raw-byte hashes, BOM/CRLF, readonly truncated and binary previews, stale versions, concurrent updates and creates, a failed rename retaining original contents, and nontruncating `touch`. A real HTTP integration test exercises validation and conflict responses against process-lifetime PGlite. A native PostgreSQL test observes a separate connection's advisory-lock wait before permitting a write; it is skipped without `DATABASE_URL`.

The browser tests use the production build with controlled API fixtures. They check read-only previews, create-only conflicts, exact source/newline preservation, stale-source review, failed comparison reads, lost responses and inconsistent write receipts. They do not establish real provider, native filesystem power-loss, PostgreSQL multi-process or physical-phone behavior.

Exploratory failures are retained rather than counted as successful evidence: the first browser assertion expected raw CRLF in a textarea (the browser displays normalized LF); one verification run stopped on formatting; the next found the missing-file domain-error regression. That error was fixed without weakening the existing approved effect-boundary assertion. A filtered regression run then exposed the early database shutdown race and was stopped after confirming the owned test process remained running. The corrected targeted regressions completed successfully.

Local logs: `%TEMP%/acos-file-editing-http-focused.log`, `%TEMP%/acos-file-editing-ui-verified.log`, `%TEMP%/acos-file-editing-domain-regression-fixed.log`, and `%TEMP%/acos-verify-20260927-workspace-files-verified.log`. API stability metadata is in `%TEMP%/acos-file-editing-codegen-stability.json`; the inspected screenshot is under `test-results/file-editing-verified-focused/`. Temporary logs and ignored screenshots are local evidence, not a portable release attestation. Final report formatting and diff whitespace were checked after recording these results.

## Remaining work and limits

Native PostgreSQL, Docker topology, a real phone over private HTTPS, live provider calls and a real 24-hour run remain unverified. `docker`, `psql` and `tailscale` are unavailable on PATH. The [phone access guide](../mobile-access.md) uses the existing browser interface and private HTTPS, with no separate app or mandatory paid hosting service.

The five root-suite skips are native PostgreSQL replica ownership, operation-receipt races, heartbeat/recovery lock ordering and the new cross-connection file lock, plus one Windows output-symlink check where creating a link returned `EPERM`. Process-lifetime PGlite does not establish any of those native PostgreSQL guarantees. Chromium viewport and keyboard fixtures are not physical-phone, Safari, native IME or screen-reader testing.

The file lock coordinates only participating processes sharing the same database and filesystem. Host editors and arbitrary external programs can bypass it. A database failure cannot roll back a published file. A process crash can leave a temporary file. Platform ACL preservation, hard-link support, directory synchronization and power-loss behavior require deployment-specific verification. This is not a claim of OS isolation or exactly-once execution.

File drafts still need preservation across route changes/reloads. Directory deletion still needs separate review protections. The Computer frame, terminal and browser still need their seven-language, theme, keyboard and interrupted-action review. Project detail/Studio, project-scoped chat, global/project Operations, additional API/provider errors and source playbooks also remain in Goal 7. Native-speaker review is outstanding. Nothing was installed, committed or published.
