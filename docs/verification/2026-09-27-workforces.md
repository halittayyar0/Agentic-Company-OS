# Team Studio checkpoint — 27 September 2026

This is a local working-tree checkpoint on Windows with Node 24.19.0. It preserves the existing uncommitted work and is not a published release or a claim that the complete application is localized.

## Changes

- Team Studio selection, preview, configuration, validation, safety messages, recovery and receipts now have separate Turkish, English, German, Russian, Simplified Chinese, Traditional Chinese and Arabic packs.
- All three server-authored catalogs translate member names, roles, missions, capabilities and handoff instructions. Canonical keys, hierarchy, version, templates and permission limits are preserved. The selected locale is explicit in preview and installation requests, and created agents and activity summaries use it. Operator-entered outcomes and existing manager identities remain unchanged.
- Phone layouts keep controls at least 44px high, wrap long labels, provide a direct configuration link and mirror Arabic handoff arrows. Arabic was visually checked at 320px in light mode; keyboard submission was exercised in English.
- Emergency stop blocks both roster-only installation and installation with a first task. Unknown safety, stale catalogs, missing managers, empty catalogs and language-file failures have distinct states.
- A UUID identifies each installation intent. Migration `0019` saves a request hash and original response in the same transaction as its team, optional task and activity events. Concurrent identical requests replay one result. Changed payloads and outdated reviewed versions are rejected; replay remains available after stop or manager deactivation.
- An unresolved request stays in the browser tab through a reload or route change. Editing is frozen until recovery or a confirmed rejection. A new regression test first reproduced the loss of recovery after navigating away during installation; the fix clears storage only when the receipt actually mounts. The operator explicitly chooses to create another team after success.

## Evidence

The full `pnpm run verify` pipeline passed with 707 root tests and 79 browser tests. The final navigation fix affected only the React page; afterward formatting, all workspace type checks, the production frontend build, the **complete 80-test browser suite**, and the bundle check passed again. The backend, migration and API specification were unchanged by that final fix.

| Check                                      | Result                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Root suite                                 | 707 total: 703 passed, 4 skipped, 0 failed                                  |
| Final production-build browser suite       | 80 passed; includes 13 Team Studio scenarios using controlled API fixtures  |
| Workspace type checks                      | Passed                                                                      |
| Production frontend and backend builds     | Passed                                                                      |
| Migration application                      | Passed on process-lifetime PGlite                                           |
| Migration constraints and snapshot lineage | Passed; duplicate IDs, invalid hashes/versions/response shapes are rejected |
| Packaged migration                         | SHA-256 matches the source `0019` SQL                                       |
| API generation                             | 204 generated files; second generation changed 0 and removed 0              |
| Production dependency audit                | No known vulnerabilities reported                                           |
| Production dependency license policy       | Passed                                                                      |
| Selected-language bundle                   | 1251.7 KiB raw / 353.3 KiB gzip; existing total ceilings retained           |
| Formatting and diff whitespace             | Passed                                                                      |

Local command logs are `%TEMP%/acos-verify-20260927-workforces.log` and `%TEMP%/acos-workforces-final-ui.log`. These temporary logs are not a portable release attestation. Browser fixtures exercise the UI contract; they do not prove real-provider operation or a remotely installed server.

### Skips and limits

Three tests need an unavailable native PostgreSQL connection: competing-worker advisory ownership; independent-adapter receipt/browser-affinity/reconciliation races; and two-connection heartbeat/recovery lock ordering. One filesystem test could not create a Windows file symlink (`EPERM`). These four skips are not passing evidence.

The new installation race was exercised against PGlite in one API process. Native PostgreSQL replica races, Docker topology, actual provider-backed work, and real-phone HTTPS access remain unverified. Session recovery does not cover closing the tab, clearing site data, or every browser's crash recovery. Base agent playbooks and common handoff policy text still contain Turkish; native-speaker review is also outstanding.

## Remaining Goal 7 work

Expert profiles and embedded tools, Company Room, Approvals, much of Connections/Settings, global and project Operations, Project detail/Studio, shared error boundaries and many server errors still need localization review. Continue the full release checklist, including real PostgreSQL/Docker and private HTTPS phone checks. No actual 24-hour run or GitHub publication is claimed.

The [phone-access guide](../mobile-access.md) uses the existing browser UI with private HTTPS and offers a self-managed network route. No separate mobile application or mandatory hosted subscription was added. Goal 7 remains active.
