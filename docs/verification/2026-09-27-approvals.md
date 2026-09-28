# Approval inbox checkpoint — 27 September 2026

This records the local Windows working tree using Node 24.19.0. It preserves existing uncommitted work. It is not a published release, complete localization claim or real-provider execution report.

## Changes

- All seven languages cover approval decisions, categories, safety status, validation, pagination, history, host-command confirmation and recovery. Only the selected route pack loads. Exact agent text, commands, targets, digests and operator notes remain original source content. Decision audit summaries use the explicit request locale.
- The inbox distinguishes initial failure, stale data, an empty inbox and an empty older page. Draft notes survive refresh and pagination within the mounted page. An uncertain decision requires an explicit successful refresh; it is not automatically repeated. Notes are not persisted through reload or tab closure.
- Host confirmation includes the exact preview, target, digest and expiry inside the keyboard dialog. Its snapshot is invalidated by changes to the visible action or identity. Expiry continues while the dialog is open. Missing or invalid scoped previews cannot be approved. Closed previews are hidden, and consumption is not described as proof of success.
- Phone controls use at least 44px touch targets, source identifiers preserve their direction, Arabic tabs follow RTL, and small-screen card headings stack above requester links. Keyboard dismissal restores focus; a resolved card returns focus to the page heading.
- The decision transaction locks runtime control before the agent, approval and task. It blocks approval during emergency stop while allowing rejection, rereads the live scope and validates expiry after taking its locks. An optional `expectedArgsHash` lets new clients fence their reviewed digest; explicit null asserts an unscoped request. Host digest confirmation is also checked against the live row inside the transaction.
- The existing at-most-once reservation and capability redaction remain in place. Recording approval does not execute the action in the HTTP handler. Concurrent approve/reject requests record one decision event.
- Removed unreferenced visual-effect helpers, their unused styles and unused Team Studio copy. Existing total transfer ceilings remain unchanged.

## Evidence

| Check                                  | Result                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------- |
| Root suite                             | 722 total: 718 passed, 4 skipped, 0 failed                              |
| Focused approval/security tests        | 20 passed, including API, review guards and seven localized audit cases |
| Workspace type checks                  | Passed                                                                  |
| Production frontend and backend builds | Passed                                                                  |
| Migration application                  | Passed on process-lifetime PGlite                                       |
| API generation                         | 205 generated files; second generation changed 0 and removed 0          |
| Dependency security audit              | No known vulnerabilities reported                                       |
| Production dependency license policy   | Passed                                                                  |
| Selected-language bundle               | 1248.6 KiB raw / 353.5 KiB gzip; passed existing ceilings               |
| Full production-build browser suite    | 99 passed, including 19 approval scenarios                              |
| Formatting and diff whitespace         | Passed                                                                  |

The full `verify` command passed formatting, audit, licenses, root tests, migration, type checks and production builds, then stopped at one browser assertion that measured a reopening Arabic dialog during its entry animation. The test now waits for that animation to finish before checking the same viewport bounds. The complete 99-test browser suite, formatting and bundle gate then passed; no production code changed between these browser runs. Arabic light mode at 320px and English dark mode were also visually inspected in their settled states.

Logs are `%TEMP%/acos-verify-20260927-approvals.log`, `%TEMP%/acos-approvals-final-ui.log` and `%TEMP%/acos-approval-targeted.log`. Temporary logs are not a portable release attestation. Browser tests use controlled API fixtures. The decision expiry regression advances an injected clock after the lock calls; it checks timestamp placement without claiming a native PostgreSQL lock-wait test.

## Skips and remaining work

Three tests require native PostgreSQL: competing-worker advisory ownership; independent-adapter receipt/browser-affinity/reconciliation races; and two-connection heartbeat/recovery lock ordering. One filesystem test could not create a Windows symlink (`EPERM`). These are skipped evidence, not passes. The `docker`, `psql` and `tailscale` executables were not available on PATH during this checkpoint.

Native PostgreSQL replica behavior, production Docker topology, provider-backed agent work and an actual phone over private HTTPS remain unverified here. Follow the [phone-access guide](../mobile-access.md) on the installed machine; no separate AgenticOS phone app or mandatory hosted subscription was added. No real 24-hour run or GitHub publication is claimed.

Expert profiles and their embedded tools, Company Room, much of Connections/Settings, global and project Operations, Project detail/Studio, shared error boundaries, source playbooks and many server errors still need localization review. Native-speaker review is outstanding for all translated routes. Goal 7 remains active.
