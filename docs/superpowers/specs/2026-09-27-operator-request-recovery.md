# Durable operator requests

Goal 7 requires recoverable Terminal and Browser operator actions. The [source audit](../../verification/2026-09-27-operator-recovery-audit.md) is the verified starting point. Existing local holds and activity events are not admission or idempotency records.

## User outcome

An operator sends a reviewed action once. If the reply disappears, reopening the same tab can check that exact action without sending it again. Recorded terminal output is recoverable when its encryption key is available. Browser recovery shows execution metadata, never private browser-control leases or stored screenshots. A completed command can have a nonzero exit code; an accepted action with an unknown outcome must remain visibly uncertain.

All seven current languages, Arabic RTL, phone-sized controls, original source text, explicit confirmation and keyboard focus remain required. No new mobile application, hosted service, paid dependency, public port or automatic replay is introduced.

## Identity, privacy and authority

- Each effectful Terminal/Browser request requires a client-generated UUID. Kinds are `terminal_sandbox`, `terminal_host`, `browser_take_over`, `browser_navigate`, `browser_input`, `browser_release`, `browser_close`. Browser observations and exact-lease heartbeats stay read/maintenance protocols, not new effects in this receipt system.
- Bind the UUID to agent ID, kind and canonical exact validated input, including authority and private lease when present. Preserve whitespace and Unicode in commands/text. Do not infer identities for legacy pending requests.
- Use a domain-separated HMAC under the existing `RUNTIME_CONTROL_KEY` for request binding. Neither input nor hash is returned in public receipts. Terminal results use authenticated encryption with that key and a payload envelope bound to request ID, agent and kind. No plaintext command, typed text, URL, lease, stdout/stderr or arbitrary error goes into the receipt table/logs.
- Reuse the existing runtime key rather than introduce a second deployment secret. Durable PostgreSQL operator mutations require it; an absent/invalid key rejects admission. Ephemeral PGlite development can use a process-local random key, never a persisted plaintext fallback. Backups need the matching protected key to recover terminal output. Rotation or a lost key can make old input binding/output unavailable; it must never authorize execution of an accepted UUID again.
- Store no browser result body, screenshot, page title or private lease. Browser receipts provide fixed status metadata and instruct the operator to refresh the current page and obtain current authority explicitly.

## State and effect boundary

The additive `operator_requests` table keeps identity after agent deletion, with no cascading foreign key. Record agent, kind, input HMAC, owner UUID, runtime-control version, database-clock deadline, timestamps, state and bounded fixed result metadata. Terminal ciphertext/nonce/tag are a correlated optional tuple, limited to 8 MiB of ciphertext text; fixed fields never contain copied input.

States: `reserved`, `dispatched`, `complete`, `not_dispatched`, `unknown`.

1. Reserve inside a transaction after locking the runtime-control singleton, before any effect. Check existing identity first: a matching replay returns the original receipt, never ownership. Changed scope/input returns a conflict. Database failure admits nothing.
2. Before every actual effect or next compound-command step, verify exact ownership, live database-clock deadline and runtime-control version. Transition `reserved` to `dispatched` before the first effect. One owner can check again for later steps; another HTTP request never receives that owner token.
3. Stopped or changed execution epochs reject new effects. Explicit release/close remain cleanup paths under their existing exact private-lease rules. Stop/resume never revives a previously admitted effectful request.
4. Completion requires the same live owner. A late/replaced owner cannot record success. Expired reserved work reads as `not_dispatched`; expired dispatched work reads as `unknown`. The GET projection never mutates or revives rows.
5. A rejection before dispatch is `not_dispatched`; after crossing the boundary, an exception defaults to `unknown` unless the executor supplies a verified completed result. Screenshot or HTTP response failure after an effect cannot become a definite failed effect.
6. Accepted UUIDs never become reusable, including known pre-effect rejections. A new action requires an explicit new identity after review. This is at-most-once application dispatch for one accepted identity, not exactly-once external delivery or remote cancellation.

## Protocol and UI

Expose authenticated exact GET `/api/agents/:agentId/operator-requests/:requestId`, independent of live agent/activity windows and available while stopped. Reject noncanonical scope and query fields. Responses omit ownership, input digest, key material and browser private data. Terminal output is a separate optional decrypted result with explicit availability (`available`, `unavailable`, `not_recorded`, `not_applicable`); missing output does not change completed execution into permission to rerun.

Effectful POST/DELETE responses carry the public receipt and an optional live result. A replay can recover terminal output; browser replay returns metadata only and requires a fresh observation/current lease. Old mutation payloads without a request UUID fail before activity or effect. Deploy generated clients and API together.

Persist the new request version before browser dispatch with verified storage readback. Preserve the original submitted identity through late completion. Retain damaged and legacy records for explicit inspection/clearing; never silently upgrade them into server receipts. Receipt reads, reload, selection, language changes and local clearing must dispatch no effect. Current terminal drafts and received output stay source content; missing/decryption-failed output is described honestly in every locale.

## Acceptance and limits

- Test canonical input, secret exclusion, encryption/correlation/tamper/key rotation, duplicate concurrent admission, cross-scope reuse, absent agents, database failure, stop/resume, deadline expiry and stale completion.
- Test the migration from the existing chain, constraints and agent-deletion retention. Add native PostgreSQL race coverage to the dedicated native gate; PGlite is not multi-process proof.
- Test real local HTTP/browser effect counts and controlled Terminal execution in a disposable workspace. Never run a user's stored command or use live provider credentials.
- Verify seven-language UI recovery, reload, storage failures, legacy/corrupt records, lost replies, old owners, navigation/unmount and phone/RTL/keyboard behavior.
- Finish with one fresh focused review, RED→GREEN repairs and full local release gates. Document native PostgreSQL, Docker, real phones and native accessibility/language acceptance separately when unavailable.
- Do not purge accepted identities as part of retention. Any future encrypted-output expiry must retain the small permanent deduplication receipt and clearly report unavailable output.
