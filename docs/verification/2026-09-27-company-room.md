# Company Room checkpoint — 27 September 2026

This records the local Windows working tree using Node 24.19.0. Existing uncommitted work is preserved. This is not a published release, a complete localization claim or evidence of real-provider execution.

## Changes

- Seven selected-language packs cover room membership, mentions, history, loading/empty/stale/error states, safety, send recovery and reply skips. Original message bodies and custom names are not translated. Explicit send locale guides the bounded model round; it does not prove provider compliance.
- The room uses one readable conversation surface and a collapsible roster on phones. Arabic uses RTL with isolated source identities; action targets are at least 44px. Mention selection works with the keyboard and does not interpret IME confirmation as submission. A renamed or departed selected member blocks sending until the draft is reviewed.
- Older messages load in pages of 50. New arrivals do not force a reader away from older messages; an explicit latest-message control returns to the bottom. Initial failures do not imply an empty room. Stale history or membership pauses new sends, and a pending membership mutation cannot overlap a new send.
- A browser send records its UUID, exact text, recipient IDs and locale in session storage before requesting the API. Unknown responses retain that intent and require explicit recovery. A response arriving after navigation leaves recovery available on the next visit. Storage write failure prevents dispatch. Ordinary unsent drafts are not persisted across reloads or language changes.
- Migration `0020` stores the request digest and an initial receipt in the same transaction as the founder message, after the runtime-control lock. Matching replays return the saved message, including during emergency stop or after membership changes. Changed intent returns a conflict. Only the transaction that inserts the receipt starts the bounded model round. API callers omitting `requestId` keep legacy behavior without this protection.
- A completed receipt means the bounded round finished, including skips. An `unconfirmed` receipt means the founder message exists but all replies are not verified. Recovery never restarts that round. Native PostgreSQL process/replica races remain unverified here.
- Receipts intentionally have no message foreign key: purging history must not make an old send identity executable again. They retain original message data and belong in the same protected backup scope. Automatic receipt retention is not implemented. Closing the browser tab or clearing its storage can lose its recovery identity; this is not cross-device draft synchronization.
- The shared skip link is clipped while idle and becomes a visible keyboard target on focus. CSS scanning is explicitly scoped to app sources, using Tailwind's [source configuration](https://tailwindcss.com/docs/detecting-classes-in-source-files#setting-your-base-path); unused template styles remain excluded with the existing live-import guard. Shared React/query and controls/icons vendor groups are co-located to reduce requests.

## Evidence

| Check                                 | Result                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Root suite                            | 728 total: 724 passed, 4 skipped, 0 failed                                                                                       |
| Focused room backend/migration checks | 10 passed, including a saved send replay during a held reply round, after stop and member removal, and a changed-intent conflict |
| Recovery/mention helpers              | 4 passed; exact token boundaries, malformed stored intents, denied writes, and seven-pack coverage                               |
| Workspace type checks                 | Passed                                                                                                                           |
| Production frontend/backend builds    | Passed                                                                                                                           |
| Migration application                 | Passed on process-lifetime PGlite                                                                                                |
| Packaged migration                    | `0020` SHA-256 matches the reviewed source SQL                                                                                   |
| API generation                        | 207 generated files; second generation changed 0 and removed 0                                                                   |
| Dependency security audit             | No known vulnerabilities reported                                                                                                |
| Production dependency license policy  | Passed                                                                                                                           |
| Full production-build browser suite   | 118 passed, including 19 Company Room/keyboard scenarios                                                                         |
| Selected-language bundle              | 1247.1 KiB raw / 354.6 KiB gzip; passed the explicitly revised ceiling                                                           |
| Formatting and diff whitespace        | Passed; final report formatting checked after results were recorded                                                              |

The combined `verify` command passed formatting, dependency audit, licenses, all root tests, migration, workspace types and production builds. It then stopped at one newly added skip-link test: the assertion read the old CSS `clip` property rather than the generated `clip-path`. The focused rerun also exposed the test's incorrect assumption that Tab navigation began at the document body; the shell intentionally focuses main content after navigation. The test now starts from that actual focus position and verifies keyboard traversal, visible size and activation. A later review corrected Turkish mention search to lowercase before stripping combining marks, preserving the dotted İ in searches such as İpek. The frontend type check, production build and full browser suite were rerun for that final change; the backend and root-test inputs were unchanged.
Arabic light mode at 320px and English dark mode at 390px were visually inspected in settled states. The shared skip-link check traverses from the shell's intentional main-content focus, verifies that the link becomes visible on keyboard focus, then activates it to return to main.

The aggregate gzip ceiling was explicitly increased from 362,000 to 364,000 bytes for the room's recovery, history and selected-language pack. The 1,300,000-byte raw ceiling, individual-asset ceilings and aggregate translation-pack limits remain enforced. This checkpoint does not claim to retain the previous gzip ceiling.

Logs are `%TEMP%/acos-verify-20260927-room.log`, `%TEMP%/acos-room-targeted.log`, `%TEMP%/acos-room-helper-tests.log`, `%TEMP%/acos-room-codegen.log` `%TEMP%/acos-room-final-ui.log`, `%TEMP%/acos-room-final-bundle.log`, and the focused `%TEMP%/acos-room-ui*.log` files. These temporary logs are not a portable release attestation. Browser tests use controlled API fixtures; the HTTP send-receipt test uses an injected reply function instead of a paid provider.

## Skips and remaining Goal 7 work

Three tests require native PostgreSQL: competing-worker advisory ownership; independent-adapter receipt/browser-affinity/reconciliation races; and two-connection heartbeat/recovery lock ordering. One Windows filesystem test could not create its symlink (`EPERM`). These four skips are not passes. The `docker`, `psql` and `tailscale` executables were unavailable on PATH during this checkpoint.

Expert detail and embedded tools, much of Connections/Settings, global and project Operations, Project detail/Studio, shared error boundaries, source playbooks and many server errors still need localization review. Native-speaker review remains outstanding. Docker topology, native PostgreSQL, actual provider work and a real phone over private HTTPS remain unverified. The [phone-access guide](../mobile-access.md) uses the existing browser UI and includes a self-managed route; no separate mobile application or mandatory hosted subscription was added. No real 24-hour run or GitHub publication is claimed. Goal 7 remains active.
