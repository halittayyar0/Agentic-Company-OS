# Durable Terminal and Browser recovery

An action has one client-generated UUID, scoped to its expert, action kind and exact validated input. Server admission records it before any effect. Matching repeated requests return the original receipt; a changed scope or input is a conflict. An accepted identity never receives a second execution owner, even after expiry, failure or key rotation. This is at-most-once application dispatch, not a guarantee that an external system executed exactly once.

## Lost replies

The tab persists versioned recovery data and verifies storage readback before dispatch. It never retries the action automatically. **Check server record** uses authenticated `GET /api/agents/:agentId/operator-requests/:requestId`; it neither executes nor cancels anything. Exact records remain readable after deletion of the expert, though the current profile interface requires an existing expert.

| Recorded state | Meaning                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| Reserved       | Accepted; dispatch is not yet recorded.                                           |
| Dispatched     | The effect boundary was crossed; completion is not yet recorded.                  |
| Complete       | Completion was recorded. Terminal success/exit code is separate from this state.  |
| Not dispatched | The server recorded that this accepted request did not cross the effect boundary. |
| Unknown        | It may have executed; the final outcome was not recorded reliably.                |

A missing record is inconclusive. Terminal output is restored only when its authenticated encrypted result is available and matches the original request and fixed result metadata. Lost keys or damaged ciphertext leave the completed state intact and mark output unavailable. Do not repeat a command merely to obtain its output.

Browser receipts never store or recover typed input, URLs, screenshots, titles or private leases. Inspect a fresh image and obtain current control explicitly. Recovery reads cannot grant browser authority. Private leases remain in memory, with bounded exact-lease cleanup on leaving the tool and expiry as fallback.

## Local review

Original commands, whitespace and Unicode remain source content. Terminal drafts and the latest reply stay in this browser tab. Browser text and address drafts remain in memory; only request metadata survives reload. These drafts do not synchronize to another device.

Terminal version 2 records carry the language captured when the command was submitted. Version 1 records retain their original server recovery identity without a locale. Browser recovery continues to use version 1. Legacy records without a protocol version have no server recovery identity and cannot be queried as new requests. Damaged records are retained for explicit review. Review starts on Cancel and requires an acknowledgement before clearing. Clearing only removes the local warning, never cancels or repeats execution, and never changes a server receipt. Intervening changes to local metadata, including a version 2 Terminal locale, prevent clearing. Late replies must match the complete original request and cannot erase newer drafts or import an old browser lease.

New Terminal requests include an explicit output locale in their durable identity. Omitted-locale legacy API calls keep the original identity and default new app-authored output to Turkish. A changed locale with the same request UUID is a conflict. Changing the interface language never retranslates a saved receipt or resends its command; external program output always stays source text. See the [Terminal localization checkpoint](verification/2026-09-27-terminal-output-locales.md) for implementation and verification status.

Storage retry and new dispatch also compare the actual saved raw value with the observed snapshot before writing. A damaged or intervening record is preserved until its own explicit review; retrying local storage is never permission to discard recovery data.

## Deployment and retention

Migration **0025** adds the receipt table without a cascading expert foreign key. Deploy the matching generated API and UI together: old mutation clients without request UUIDs are rejected. PostgreSQL installations, including combined API/worker deployments, require a valid `RUNTIME_CONTROL_KEY`. Keep that key protected alongside database backups; it authenticates request binding and encrypts saved Terminal output. A missing or rotated key can prevent output recovery and matching-input replay, but never authorizes an old UUID to execute again. Development PGlite may use an ephemeral process key and does not establish persistence across restarts.

Terminal admission has a 180-second database-clock deadline; Browser admission uses 60 seconds. Owner identity, runtime version, expert existence and deadline are checked at actual effects and completion. Worker delivery carries private ownership only inside its existing encrypted envelope. Accepted identities are retained permanently for deduplication. Future output cleanup must retain the small identity receipt and explicitly report unavailable output.

Filesystem operations revalidate after acquiring the workspace lock and before each publication step, including workspace creation. PostgreSQL revalidation reuses the lock transaction, so a one-connection pool does not require a nested connection. Browser dragging rechecks authority between awaited move/press/release steps. If interrupted while holding the button, cleanup releases it on the already captured page and keeps the outcome unconfirmed. Filesystem and browser effects cannot be rolled back by a database transaction; this protocol does not promise atomic external effects.

## Evidence limits

The local source and production-browser checks cover controlled requests and failures. Real PostgreSQL multi-process races, production Docker topology, physical-phone HTTPS, native language/accessibility acceptance and real 24-hour endurance require their own evidence. A configured CI job or private-phone guide is not a passing run. See the [release audit](verification/2026-09-27-release-readiness.md) for current outstanding gates.

## Autonomous Terminal presentation

Agent Terminal operations use their existing autonomous operation receipts, distinct from operator request UUIDs. New reservations retain only a validated seven-value execution locale as presentation evidence before any effect. It is excluded from command, approval and operation identity. Safe pre-effect retry keeps that language; successful and uncertain recovery use it without translating prior history or replaying an uncertain command. Legacy receipts without this field retain their legacy summaries. Native process output and operator notes retain their source form within the existing output caps/redaction. Incremental UTF-8 stream decoding preserves characters split between process chunks.
