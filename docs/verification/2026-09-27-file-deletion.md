# Reviewed file deletion checkpoint — 2026-09-27

Goal 7 remains active. This checkpoint implements complete-scope deletion review and local recovery; it does not mark the File Explorer or the whole release complete.

Follow-up: the [File Explorer checkpoint](./2026-09-27-file-editor.md) adds seven-language listing/creation/editing and draft recovery. The remaining-work section below records the state at this earlier deletion checkpoint.

## Implemented

- A read-only preview endpoint returns every file and directory in the selected scope, including empty directories and the target itself. Binary files are hashed without converting them to text.
- Operator deletion requires the exact reviewed version and rechecks it under the cooperative workspace lock. Changed bytes, new children and replacement objects invalidate the review. Absent targets cannot produce a new successful deletion response.
- Scope inspection rejects symlinks/junctions, special files and workspace-root deletion. It is bounded to 1,000 entries, 64 MiB of file content, 32 levels below the target, 2,048-character relative paths, and a five-second work deadline checked between filesystem calls. A hung filesystem call cannot be interrupted by that deadline.
- The seven-language review dialog displays the complete scope, selected-locale counts, original filenames and explicit confirmation. It uses semantic themes, RTL and 44px controls. Closing the dialog restores keyboard focus to its opener; after deletion or removal of the opener, focus returns to the file-list refresh control. Invalid or partial response manifests cannot enable deletion.
- The exact pending request is saved in the current browser tab before dispatch. The serialized recovery-size limit is checked before storing, including JSON-escaped source paths. Lost or malformed replies become unconfirmed; reload never resends. Read-only inspection and explicit local-warning review support recovery. Late responses only update a matching local request.
- Operator file write/delete admission now checks the persisted emergency-stop state, including a stop written by another process. The local epoch is rechecked before effects. This is not an atomic cross-replica stop-versus-filesystem transaction.

See [workspace file contracts and limits](../workspace-files.md) and [localization scope](../localization.md).

## Verification

| Check                                           | Result                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Full root suite                                 | 777 total: 772 passed, 5 skipped, 0 failed                                                          |
| Final full production browser suite             | 201 passed, 0 failed; includes all 13 deletion cases with final keyboard assertions                 |
| Focused filesystem / HTTP / recovery cases      | 10 passed before the runner regression fix; final root suite includes their current versions        |
| Runner, Settings and recovery regression        | 6 passed                                                                                            |
| Final workspace type checks                     | Passed                                                                                              |
| Production builds                               | Passed; frontend rebuilt for the final focus-return change                                          |
| Database migration chain                        | Passed on process-lifetime PGlite                                                                   |
| Formatting, dependency audit and license policy | Passed; audit reported no known production dependency vulnerabilities                               |
| OpenAPI generation stability                    | 224 generated files identical across two consecutive runs                                           |
| Final selected-language bundle                  | 1218.7 KiB raw / 355.2 KiB gzip; passed unchanged 1,300,000-byte raw and 364,000-byte gzip ceilings |
| Combined verification command                   | Exit 0; final UI focus change subsequently verified as described below                              |

The production-browser cases cover all seven locales, complete-scope confirmation, exact request versions, changed scopes, lost and malformed replies, reload recovery, missing targets, invalid manifests, unsupported scopes, blocked/corrupt storage and missing language packs. They use controlled API fixtures. Backend tests exercise real local filesystem operations and HTTP/PGlite integration, including concurrent deletion, same-content replacement, added children, root/path/junction/budget limits, admission ordering and persisted emergency stop.

Visual review: English desktop dark mode at 1365px and Arabic phone light mode at 320px. The full directory list scrolls within the dialog, exact paths remain selectable, and the dialog does not overflow horizontally. Chromium viewport checks do not establish physical-phone, Safari, native IME or screen-reader compatibility.

An exploratory 18-case browser run passed 17 cases and found a 36px-wide desktop delete trigger. The minimum width was corrected; the subsequent 13-case deletion run passed. The five existing file-editing cases also passed in that exploratory run and are covered again by the full suite. The first combined verification attempt stopped on formatting in `routes/vm.ts`; it was corrected before restarting verification. A later full attempt found a Settings test process failure after its assertions passed: a delayed logging worker inherited the relative `--import tsx` argument after the test changed into a temporary directory. The runner now resolves the loader to an absolute file URL before starting test processes. A regression child process proves the old preload fails outside the workspace and that the new preload and its inherited worker both start and exit normally. The Settings and recovery regression run passed all 6 cases. Failed attempts are retained and are not passing evidence.

Local evidence: `%TEMP%/acos-delete-unit.log`, `acos-delete-ui.log`, `acos-delete-ui-verified.log`, `acos-delete-codegen-stability.json`, `acos-delete-loader-regression.log`, `acos-delete-focus-types.log`, `acos-delete-final-ui.log`, `acos-delete-final-bundle.log`, `acos-verify-20260927-file-deletion-loader-failed.log`, `acos-verify-20260927-file-deletion-format-failed.log`, and `acos-verify-20260927-file-deletion.log`. Screenshots and traces are under `test-results/file-deletion-focused/` and `test-results/file-deletion-verified/` and the final `test-results/ui-release-smoke/`. These temporary/ignored files are local evidence, not portable release attestations.

The combined verification command passed before the final dialog focus-return change. That UI-only change received a fresh workspace type check, production build, complete browser run, bundle check and final formatting check; server, schema, generated clients, recovery helpers and root-test inputs were unchanged. Keyboard assertions now cover Escape returning to the opener and successful deletion returning to the file-list refresh control in every locale.

## Remaining work and limits

The File Explorer's listing, creation and editing controls still require complete seven-language/theme migration and durable draft recovery across route changes/reloads. Browser controls, Project detail/Studio, project chat, global/project Operations, additional API/provider messages and authored playbooks remain in Goal 7. Native-speaker review is still needed.

Deletion has no trash/rollback. A failed response can follow partial filesystem effects. Tab-local request IDs are not server deduplication keys or durable server receipts. Recovery is not synchronized to a phone or another browser. The operator Terminal also still needs durable server result recovery.

The lock coordinates cooperating application processes only. Host writers and privileged commands can bypass it; filesystem effects do not roll back with a failed database transaction. Internal agent deletion tools retain their separately authorized semantics. Native PostgreSQL and POSIX filesystem guarantees were not established by these Windows/PGlite tests.

Native PostgreSQL multi-process proof, Docker topology, live providers, a physical phone over private HTTPS, and a real 24-hour run remain unverified. The five root-suite skips are four native PostgreSQL checks and one Windows output-symlink test that reports `EPERM`. No native PostgreSQL, Docker or Tailscale executable was found on this environment's PATH. The [phone access instructions](../mobile-access.md) use the existing browser interface without a separate AgenticOS phone app or mandatory paid hosting. Nothing was installed, committed or published.
