# Localization checkpoint — 27 September 2026

This records a local working-tree checkpoint, not a published release or a claim that all routes are finished. Existing uncommitted work was preserved. The final `pnpm run verify` invocation exited with code 0 under Node 24.19.0 on Windows.

## Changes covered

- Expert creation in Turkish, English, German, Russian, Simplified Chinese, Traditional Chinese, and Arabic: role names, identity fields, validation, permissions, model selection, and save feedback.
- Edited names and custom instructions survive catalog retries and failed saves. Suggested department labels are submitted using the original server department key. Unknown role names remain source content.
- Manual model selection requires a successfully loaded catalog entry with a connected provider and tool support. A failed refresh preserves the visible selection but blocks submission until a successful retry.
- Arabic selects and switch movement follow the page direction. The new-expert layout was checked at 320px, including custom instructions, validation, and mixed-script names. A fixture screenshot was visually inspected in the light theme.
- Shell language packs load on demand. Localized loading and recovery text remains available before loading. A failed shell pack does not mount authentication or workspace requests. Bookmarked URLs survive reload recovery.

## Verification results

| Check                                | Result                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Formatting                           | Passed                                                                                    |
| Production dependency audit          | No known vulnerabilities reported                                                         |
| Production dependency license policy | Passed                                                                                    |
| Root test suite                      | 700 total: 696 passed, 4 skipped, 0 failed                                                |
| Database migrations                  | Passed on process-lifetime PGlite                                                         |
| Workspace type checks and builds     | Passed                                                                                    |
| Production-build browser suite       | 67 passed; controlled API fixtures, not a real remote installation                        |
| Bundle budget                        | Passed: 1252.8 KiB raw / 352.7 KiB gzip, counting one selected pack per localized surface |
| Diff whitespace check                | Passed                                                                                    |

The total bundle ceilings remain 1,300,000 raw bytes and 362,000 gzip bytes. Page packs, shell packs, and media also retain separate checks. API generation was not rerun in this checkpoint; no API specification or generated client files were changed by this localization work.

## Skipped tests

Three tests require a real PostgreSQL connection, which was absent:

1. Advisory ownership across competing worker replicas.
2. Receipt, browser-affinity, and reconciliation races across independent adapters.
3. Production heartbeat and recovery lock ordering across two connections.

One filesystem test could not create a file symlink on this Windows host (`EPERM`): rejecting an overwrite through a linked output target without touching its referent. This is an environment skip, not passing evidence for that scenario.

## Remaining work

Localization is still partial. Expert profiles and their embedded tools, Teams, Company Room, Approvals, much of Connections/Settings, global and project Operations, Project detail/Studio, shared error boundaries, and many server errors still need review. Server role instructions and provider descriptions remain explicitly labeled source-language content. Native-speaker review is outstanding.

Docker, native PostgreSQL topology, real provider-backed agent work, and real-phone HTTPS access were not verified by this checkpoint. Follow [mobile access](../mobile-access.md) on the installed host and a real phone, including a mobile-data connection. No separate mobile app or mandatory hosted service was added. No actual 24-hour endurance run or GitHub publication is claimed.

Continue with the [release checklist](../release-checklist.md) and [localization guide](../localization.md). Goal 7 remains active.
