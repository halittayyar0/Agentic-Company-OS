# Expert send integrity checkpoint — 27 September 2026

This records the local Windows working tree using Node 24.19.0. Existing work is preserved. Goal 7 remains active. This checkpoint adds the server contract needed for reliable Expert chat recovery; it does not complete the chat UI migration or the wider redesign.

## Changes

- Added authenticated `POST /agents/{agentId}/requests` for `ask`, `delegate` and `continuous` intents, with a required UUID and explicit locale. A canonical hash binds the identity to its exact expert, content, kind, language, model override and reviewed configuration. Conflicting reuse returns HTTP 409. Read-only `GET /agents/{agentId}/requests/{requestId}` recovers a receipt during emergency stop or after archiving.
- Migration `0021` adds the persistent receipt table and rejects duplicate identities, nonpositive expert IDs, malformed hashes and invalid delivery states. Previous schema snapshots are unchanged. Only the creator of a new reservation dispatches; existing unconfirmed reservations never acquire a new executor automatically.
- Project creation now shares one transaction helper with the existing `/tasks` contract. The coordinator, workforce roster, model pin, capacity rules and creation event are retained. Project creation and its completion receipt commit together; injected receipt failure rolls the project back. A crash between reservation and creation may leave an unconfirmed receipt with no project.
- Chat acquisition now checks the current locked expert configuration and atomically stores its user message and admission receipt. It uses the row actually claimed for permissions, prompt and model selection. Heartbeats require an unexpired lease. Final messages and completion receipts commit together only while the exact API incarnation and active expert lease still own finalization. Cleanup cannot clear another owner's lease.
- Model/provider fields report the observed provider response instead of assuming the originally selected provider served the turn. Provider errors, empty replies, tool limits, unknown/deferred tool outcomes, approval-tool records and round exhaustion have explicit outcomes and system message roles. System notices are excluded from model conversation history. Seven server-side language copies preserve original quoted tool evidence and identifiers. Tool-return counts are no longer presented as proof that every action succeeded.
- Updated the OpenAPI source and generated clients/validators. The new endpoint rejects unknown fields, invalid model identifiers and oversized project briefs. It deliberately rejects project `taskId` until that separate conversation flow is migrated. It inherits existing operator/Host/origin/global API protection and adds a per-process POST limit of 12 requests per client address per minute.

See the [request contract and recovery guide](../agent-requests.md) for receipt semantics, persistence, rate limits and client obligations.

## Evidence

| Check                                             | Result                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| Focused HTTP, runtime-fencing and migration tests | 23 passed, 0 failed                                                     |
| Full root test suite                              | 747 total: 743 passed, 4 skipped, 0 failed                              |
| API generation stability                          | 219 files; second generation changed/added 0 and removed 0              |
| Workspace type checks and production builds       | Passed                                                                  |
| Database migration chain                          | Passed on process-lifetime PGlite                                       |
| Formatting, dependency audit and license policy   | Passed; no known production dependency vulnerabilities reported         |
| Full production browser suite                     | 150 passed                                                              |
| Selected-language bundle budget                   | 1223.5 KiB raw / 352.8 KiB gzip; passed the unchanged transfer ceilings |
| Final combined verification                       | Passed; exit 0                                                          |

The focused tests exercise real local HTTP and PGlite with injected model/tool behavior: simultaneous sends, read-only recovery, replay under stop/archive, conflicting identity reuse across content and experts, both project modes, roster preservation, stale settings, durable rejection, lost/expired ownership, atomic admission and final-message rollback, atomic project rollback, unknown/deferred/throwing tool effects, all seven output locales, source-safe system notices, malformed input, and current prompt/permission use. They make no paid model calls and perform no real external tool effect.

The browser suite checks existing production UI flows against controlled API fixtures. No new UI was introduced in this server checkpoint; these checks are regression evidence, not browser proof of the new request API integration. Final report formatting and diff whitespace were checked after recording the results.

The first focused run exposed a synthetic fixture without a selectable model and an old drain test that expected a final message after lease revocation. The fixture now uses an explicit test-only free model ID with an injected provider. The drain test now verifies that the operation remains unknown and that the revoked owner cannot write a final message. The corrected focused run passed before the full suite started.

Logs are `%TEMP%/acos-chat-focused-final.log`, `acos-chat-types-focused.log`, `acos-chat-codegen-stability.json`, and `acos-verify-20260927-chat-requests.log`. The initial failed focused run remains in `acos-chat-focused.log`. Temporary logs are local evidence, not a portable release attestation.

## Remaining work and limits

The existing Expert chat UI and project-scoped chat still use legacy sends; they have not yet acquired the new request identity/recovery flow. Client integration, all seven chat UI packs, IME/keyboard behavior, bounded history, honest activity display, draft recovery and phone/RTL browser checks are next. Computer tools, project detail/Studio, global/project Operations, further API errors and source playbooks also remain in Goal 7. Other locales remain partial pending full route coverage and native-speaker review.

The four skipped root tests require native PostgreSQL ownership/race/heartbeat behavior or the Windows file-symlink capability that returned `EPERM`. No native PostgreSQL replica claim is made from PGlite concurrency tests. `docker`, `psql` and `tailscale` were unavailable on PATH. Docker topology, actual provider execution, a real phone over private HTTPS and a real 24-hour run remain unverified. The browser/private-HTTPS [phone access guide](../mobile-access.md) remains available without adding a separate mobile app or mandatory paid hosting. Nothing was installed or published to GitHub in this checkpoint.
