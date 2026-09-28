# Computer frame and Terminal checkpoint — 27 September 2026

This records the local Windows working tree with Node 24.19.0. Existing work is preserved and Goal 7 remains active. The Computer frame and Terminal have been redesigned; file-editor and browser-control internals remain separate unfinished work. The previous [workspace file integrity checkpoint](./2026-09-27-workspace-files.md) remains historical evidence for its own changes.

## Changes

- Added selected-language packs for Turkish, English, German, Russian, Simplified Chinese, Traditional Chinese and Arabic. The Computer frame, command input, authority selection, validation, recovery, status and activity explanations use them. Original commands, output, saved names and event summaries remain source content.
- Replaced the fixed dark frame, decorative execution rail and misleading live badge with semantic theme colors, clear shared-workspace scope and a bounded activity list. The latest 20 records are labeled as periodically refreshed, including project filtering when applicable. Failed refreshes preserve prior records. Counts follow the selected locale and dates include the display timezone.
- Uses shared manual-activation tabs with directional keyboard navigation. Following is off initially, responds to newer recorded agent events and avoids interrupting typing or dialogs. Manual tool selection disables it. Expert profile tab changes retain mounted Computer state while inactive polling and browser control are suspended.
- Rebuilt the command console with 16px command input, 44px command controls, separate workspace/host drafts and explicit host authority. The shared validated form uses React Hook Form, Zod, `noValidate`, associated errors, first-error focus, a busy state and duplicate-submit protection. Enter inserts a newline; Ctrl/Command+Enter submits outside IME composition. Preset buttons prepare drafts without executing.
- Persists the exact local request identity before POST. Missing or damaged storage blocks dispatch. A lost or malformed reply becomes unconfirmed and cannot automatically resend. Explicit acknowledgement clears only the local warning; the console does not claim cancellation or server reconciliation. Late replies merge with newer drafts only for the same local identity. A confirmed response clears the submitted draft only if it was not edited while waiting.
- Keeps at most six responses visible and only the latest response in tab recovery storage. Raw output, exit code and duration remain inspectable. Clipboard failure leaves selectable output with visible feedback. The new language packs are counted by the bundle verifier while retaining its overall transfer ceilings.

See [Computer workspace and command recovery](../computer-workspace.md) for the current product and storage contract.

## Evidence

The complete local verification command finished successfully with exit 0. This is a working-tree checkpoint; the outstanding product and environment work below prevent treating it as a finished release.

| Check                                           | Result                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Computer and Terminal production browser cases  | 16 passed, included in the complete run with the final older-event guard                            |
| Full root test suite                            | 767 total: 762 passed, 5 skipped, 0 failed                                                          |
| Full production browser suite                   | 188 passed, 0 failed                                                                                |
| Terminal recovery and language-pack unit tests  | 3 passed, included in the root suite                                                                |
| Workspace type checks and production builds     | Passed                                                                                              |
| Database migration chain                        | Passed on process-lifetime PGlite                                                                   |
| Formatting, dependency audit and license policy | Passed; no known production dependency vulnerabilities reported                                     |
| Selected-language bundle budget                 | 1206.9 KiB raw / 351.9 KiB gzip; passed unchanged 1,300,000-byte raw and 364,000-byte gzip ceilings |
| Combined `pnpm run verify`                      | Passed; exit 0                                                                                      |
| Visual review                                   | English desktop dark mode at 1365px; Arabic phone light mode at 390px and 320px                     |

The browser cases cover all seven locales, exact Unicode/whitespace source, separate authority drafts, reload recovery, explicit host dispatch, keyboard tabs and form validation, IME suppression, interrupted and malformed replies, editing a new draft during a pending request, profile tab changes, blocked/corrupt storage, stale activity, working-directory errors, oversized input, clipboard failure, permissions/safety stops, missing language assets and following new events without interrupting typing. They use the production build and controlled API fixtures; host commands and providers are not actually executed by these tests.

An exploratory run had seven failures: six were caused by an omitted chat-history fixture response, confirmed from the request trace; the desktop case exposed the shared textarea's smaller responsive font. The fixture was completed and Terminal explicitly retains 16px text on desktop. Corrected focused runs passed. The failed run is not counted as passing evidence.

Local logs are `%TEMP%/acos-computer-ui-focused.log`, `%TEMP%/acos-computer-ui-verified-focused.log`, `%TEMP%/acos-computer-ui-form-verified.log`, `%TEMP%/acos-computer-unit-final.log`, `%TEMP%/acos-computer-types-final.log`, and `%TEMP%/acos-verify-20260927-computer-terminal.log`. Screenshots are under `test-results/computer-verified-focused/`, `test-results/computer-final-focused/` and `test-results/computer-form-verified/`. Temporary logs and ignored screenshots are local evidence, not portable release attestations. Final report formatting and diff whitespace were checked after recording the results. API/OpenAPI source and generated clients were not changed in this UI checkpoint; generation stability belongs to the preceding file-integrity checkpoint.

## Remaining work and limits

The command UUID is local recovery identity only. The operator command endpoint still lacks a durable server receipt and read-only result recovery. A client timeout or navigation does not cancel server work. Workspace path restrictions are not operating-system isolation. A returned exit code does not prove project completion.

File-editor and browser internals still need full localization, theme and interaction review. File drafts need recovery across reloads/routes; directory deletion needs reviewed scope. Project detail/Studio, project chat, global/project Operations, additional API/provider errors and authored source playbooks remain in Goal 7. Native-speaker review is outstanding.

The five root-suite skips are four native PostgreSQL checks (replica ownership, operation-receipt races, heartbeat/recovery lock ordering and cross-connection file locking) and one Windows output-symlink check that returned `EPERM`. PGlite does not prove the native PostgreSQL guarantees.

Native PostgreSQL multi-process proof, Docker topology, live providers, a real phone over private HTTPS and a real 24-hour run remain unverified. Automated Chromium layouts, synthetic composition and key events do not establish physical-phone, Safari, native IME or screen-reader compatibility. The existing [phone access route](../mobile-access.md) requires no separate AgenticOS application or mandatory paid hosting service. Nothing was installed, committed or published.
