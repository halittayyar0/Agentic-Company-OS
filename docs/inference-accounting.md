# Understanding model usage records

This feature is being developed on the durable accounting branch. It is not yet
part of a published release. Invocation-owned late evidence and atomic usage
correction are implemented in this draft; remaining entry-path, platform and
whole-feature acceptance checks are still required before publication.

Open a project or an agent and expand **Model usage records**. The panel explains
why usage accounting is waiting and shows the exact request ID. It supports
Turkish, English, German, Russian, Simplified Chinese, Traditional Chinese and
Arabic. Arabic uses the application's right-to-left layout; request IDs remain
readable from left to right.

| Status                            | Meaning                                                                                                                                                      | Next step                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Response window open              | The recorded response deadline has not passed. This does not prove that the agent or worker is still running.                                                | Wait, or check the saved records.                                                                                                                  |
| Usage needs verification          | A dispatched request has unknown usage, its response window expired, or accounting could not be persisted. New inference in the affected scope stays fenced. | Preserve the request ID for diagnosis. Inspect the saved records and provider usage history. Refreshing cannot resolve missing evidence by itself. |
| No unresolved usage               | No unresolved accounting marker is blocking this scope.                                                                                                      | Review the task's own status, budgets, approvals and permissions. This status does not mean the task succeeded or authorize execution.             |
| Current status cannot be verified | The latest read failed or returned evidence for another scope.                                                                                               | Previously displayed records remain visible with their observation time. Check again when connectivity is restored.                                |

## What checking does

**Check saved records** performs an authenticated, read-only request. It does not
call a model, resend a previous request, clear an uncertain marker, resume a task
or grant permissions. While the panel is open, it refreshes every five seconds.
When collapsed, it checks every thirty seconds. Background tabs stop polling.
These reads do not consume model tokens.

Project inspection includes its rooted task family and unresolved requests from
the current task owner's agent, because either can prevent further inference.
Settled history from unrelated task families is excluded. Agent inspection shows
that agent's records. The latest twenty records are shown, with unresolved
records first; the unresolved count covers the whole scope.

## Reading usage honestly

- **Reported usage** means the provider supplied consistent token counters.
- **Reported minimum** is a known lower bound. It is not a complete total.
- **Usage unknown** means there is no recorded usage receipt; it does not mean
  zero tokens were used or that no charge occurred.
- **Cost not reported** means the provider did not report a dollar amount. The
  application does not invent a price from the model name or token count.
- **Prepared; not dispatched** identifies a reserved request without an
  acknowledged dispatch marker. A stale reservation still requires diagnosis;
  a browser refresh cannot grant permission to replay it.

Known usage and the attempt settle atomically under a unique ordinary inference
ID. Persistence retries reuse the same ID and payload; they do not perform a
second inference. Original receipts remain immutable. A parsed late response
from that exact invocation can supply a separate verified usage observation.
The backend validates its identity, route, counters and dollar lower bounds,
then atomically authorizes one effective receipt at the original time. Saved
evidence can be reconciled in bounded background batches after a restart;
missing, partial or conflicting evidence stays fenced.

This changes accounting only. It does not recover response content, declare the
interrupted task successful, execute tools, resume a task or grant permission.
Task/family budgets, organization totals and operations history read the same
effective usage. Unknown dollars remain unknown. Historical worker health and
outage records remain intact, and failed billing receipts do not count as
successful provider responses.

A later conflict revokes complete provenance while preserving saved token and
dollar lower bounds. The request remains fenced even if its physical marker
had already settled and a newer request exists. The inspection API presents
that request as uncertain. No manual zero-cost reset or blanket replay option
is provided. The internal owner identity is correlation metadata, not proof
that a worker is alive and not a browser authorization token.

## API

`GET /api/inference-accounting?scopeType=task&scopeId=123`

Use `scopeType=agent` for agent inspection. IDs must be positive 32-bit integers.
The endpoint is mounted behind the same operator authentication and host/origin
guards as the rest of the application. Responses use `Cache-Control: no-store`.
Invalid or ambiguous scopes return 400, missing scopes 404, and unverifiable
storage or projection failures 503 with a fixed error. There is no write or
reset endpoint.

The OpenAPI contract defines the bounded snapshot, durable marker states and
nullable usage evidence. The response includes no prompts, message content,
credentials, local paths or lease-owner identities. A single SQL statement
observes the rooted scope, markers and keyed receipts consistently.
