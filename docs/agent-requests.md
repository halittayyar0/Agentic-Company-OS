# Durable expert requests

The authenticated API provides one send identity for a direct expert conversation, a project conversation or a new project. The Expert profile's Conversation tab uses this contract for questions, assigned work and recurring responsibilities. Project Studio uses the same receipt flow with an explicit project scope.

## Send and recover

`POST /api/agents/{agentId}/requests` accepts:

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "kind": "ask",
  "locale": "en",
  "content": "Summarize the current work."
}
```

Generate a new UUID for each intentional new request and retain the exact payload before sending it. Reuse that UUID and payload to recover an uncertain send. The example UUID is illustrative, not a reusable installation default. `expectedConfig`, obtained from the agent record's `configVersion`, adds a comparison against the reviewed prompt, model and permissions when the request is admitted. It is optional for API compatibility; clients omitting it do not get stale-configuration rejection.

| Field                  | Meaning                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind: ask`            | Direct or project-scoped conversation with this active expert. A bounded turn can use its allowed tools and create tasks or experts.                                                    |
| `kind: delegate`       | Create one finite project coordinated by this expert.                                                                                                                                   |
| `kind: continuous`     | Create one continuous project, initially queued, with a one-hour cadence.                                                                                                               |
| `locale`               | Required: `tr`, `en`, `de`, `ru`, `zh-CN`, `zh-TW`, or `ar`. Direct chat receives this explicit language directive. It does not translate source content or guarantee model compliance. |
| `content`              | Required nonblank text; at most 32,768 characters for chat and 8,000 for project creation.                                                                                              |
| `modelMode`, `modelId` | Optional per-turn chat selection. Manual mode requires a valid model identifier. Project-creation requests use the coordinator's saved selection and reject these overrides.            |

Optional `taskId` binds an `ask` request to an existing project and its coordinator. It is a positive 32-bit integer; project-creation kinds reject this field. Omitting it selects direct conversation. A missing project or a changed coordinator produces a stored `PROJECT_CHAT_UNAVAILABLE` rejection before message admission. The runtime rereads and locks the project in the same transaction as the expert lease, admission message and receipt, using its current brief for the turn. Both messages retain the exact project ID; history is bounded by expert and project together. Unknown input fields are rejected. Model availability and tool authorization are still checked independently by the existing runtime.

Scoped receipts include their original `taskId`, even after the project is deleted. Reusing that identity for another project or direct chat is a conflict. Historical direct-request hashes are preserved byte for byte; the new scope uses a separate hash domain and requires no database migration because the receipt envelope is already JSON. Replaying an existing result is checked before current project/agent availability and never starts a replacement turn.

`GET /api/agents/{agentId}/requests/{requestId}` only reads the stored receipt. It does not start work and remains usable during an emergency stop or after the expert is archived. A missing receipt does not prove that a concurrent send will never commit: recover using the exact identity and payload, never generate a replacement identity automatically.

Both routes sit behind the existing operator-authentication, Host/origin and global API protections. POST additionally permits at most 12 requests per client address per minute **per API process**, including replays. GET uses the global API limiter. Multi-replica deployments still need an edge quota if they require a distributed rate limit.

## Interpret the receipt

| `deliveryState` | What it establishes                                                                                                                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `complete`      | This bounded request has a stored result. Inspect `outcome`: `queued` is a newly queued project; `reply` is a model reply; provider/empty-reply/tool-limit/unknown-tool/deferred-tool/approval-review/round-limit outcomes are separate from successful work.                                                                                |
| `rejected`      | A known admission check failed before a user chat message or project committed. `failureCode` identifies stale configuration, emergency stop, capacity, unavailable expert, busy expert, or unavailable API runtime. The same identity remains rejected after conditions change. Review and deliberately create a new intent if appropriate. |
| `unconfirmed`   | This request was reserved and may still be running or may have stopped. A saved `userMessage` proves admission, not tool success. An absent message can mean a crash before admission. Reading or replaying the receipt never takes over or restarts the request.                                                                            |

The stored response includes the request/agent identity, kind, outcome, any saved messages or created project, and actual observed model/provider where available. `replayed` identifies recovery reads. Reusing an identity for a different expert, content, kind, locale, model override or expected configuration returns HTTP 409 with `AGENT_REQUEST_CONFLICT`.

For unconfirmed work, inspect message history, projects and durable tool receipts before intentionally starting another request. An external tool may have acted even when its reply was lost. Operations reconciliation concerns the underlying tool receipt; it does not automatically mark or rerun the higher-level send receipt. There is no general exactly-once claim or automatic recovery of a partially executed chat.

## Persistence and ownership

- Migration `0021_agent_interaction_requests.sql` adds the receipt table without changing earlier tables. A short transaction reserves the identity under the runtime-control lock. Only that reservation's creator dispatches the request.
- Project creation, the existing workforce membership snapshot, and the final project receipt commit in one transaction. A receipt-write failure rolls the project back. A crash between reservation and that transaction can leave an unconfirmed request with no project.
- Chat lease acquisition, current configuration validation, user message and admission receipt commit together. The final message and completion receipt also commit together after checking the exact API runtime and the still-active, unexpired agent lease owner. An old owner cannot commit a final response or clear a replacement owner's lease.
- Provider errors and other system-generated stops are stored with message role `system`; they are not model-authored replies. Historical system notices are excluded from model conversation history. The legacy response property remains named `agentMessage`, so clients must inspect its actual `role`.
- Receipts have no agent foreign key. Removing conversation records must not make an old send identity executable again. Back up receipts with the database and retain them for as long as clients may replay identities. They contain conversation results and belong inside the same private operator boundary.
- Production, remote access and restart durability require PostgreSQL. The development PGlite fallback is process-lifetime memory. The local tests exercise PGlite transactions and real HTTP, with injected model/tool behavior and no paid provider calls; they do not prove native PostgreSQL replica races.

## Expert Conversation client

The Conversation tab saves the exact send identity and payload in this browser tab's `sessionStorage` before dispatch. Unavailable storage blocks new sends. A reload recovers the pending receipt with GET, including after archiving or emergency stop. A locale or model change never rewrites an existing intent. When the receipt is missing, the operator can explicitly recover the same identity and original payload; there is no automatic POST retry. The server may admit it once if it was never recorded.

A visible ordinary reply, queued project or known rejection releases the local pending record. Rejected text remains in the composer. System notices and unconfirmed work require explicit review before clearing the tab's pending record; clearing does not cancel server work or repair an unknown tool outcome. Late replies received while the profile tab is hidden keep the recovery identity until their result is shown. Browser-tab storage is not a cross-device outbox and closing the tab may remove it; server receipts still belong to the database.

The interface has selected-language packs for all seven supported locales. It preserves source messages, names, model identifiers and activity text. Enter inserts a newline; Ctrl/Command+Enter sends outside IME composition. Both composition and recovery acknowledgement use the shared React Hook Form/Zod form boundary, inline errors and first-invalid focus. Recovery uses an AlertDialog with Cancel focused initially. The request type distinguishes one conversation turn, a queued project and recurring work with a one-hour cadence. A queue receipt never claims that work ran or finished.

Project Studio shares this interface with a fixed conversation request type and the coordinator's saved model selection. A saved manual model is included explicitly in the intent; automatic selection remains automatic. Its tab outbox and draft keys include both the coordinator and project ID; direct and other-project records are kept separately. Scope is validated on history, receipts and restored intents. Clearing a pending record compares its exact request identity, so a late result cannot clear a newer record. Project conversation hides the expert-wide activity sidebar; the project workbench provides project evidence. The conversation scope does not narrow existing tool permissions or bypass approvals. There is no automatic transfer of history or browser-tab outboxes to a different coordinator.

History loads 50 messages per page with an explicit older cursor and a 500-message display limit. Reading older messages freezes the current view; new arrivals appear behind a button instead of moving the reader. Failed refreshes preserve loaded content. The latest 12 expert activity records can concern other work and are not a live execution trace. The browser display window is separate from the model's bounded context.

The existing `/agents/{agentId}/messages` and `/tasks` POST contracts are retained and do not acquire send deduplication simply because this new route exists. Other clients must migrate explicitly. Browser checks use controlled API fixtures; real provider execution, cross-device recovery and native PostgreSQL race behavior require separate evidence.
