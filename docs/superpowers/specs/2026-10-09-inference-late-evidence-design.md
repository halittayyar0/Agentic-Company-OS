# Late response accounting evidence

Status: implementation design for the unpublished durable accounting feature.
This extends the accepted scope in `.tmp/task6-durable-ordinary-inference-accounting-plan.md`;
it does not narrow its release requirements. User authorization covers routine
design/implementation; no paid calls, new authentication or external token upload.

## Purpose

A provider client can resolve after its host deadline has already rejected.
The current caller writes an immutable unknown receipt and fences further
inference. Its eventual response must be accounted without a second request,
overwriting the original receipt, treating unknown as zero or claiming the
interrupted task succeeded.

## Chosen design

Keep the original `usage_events` receipt immutable. Mint and persist an
invocation-owner UUID when reserving an inference. A call-local transport hook
reports only a parsed provider response's requested route, provider, opaque
response ID and complete usage counters. No content, prompts, credentials,
URLs, headers, process paths or lease secrets enter the evidence journal.
An owner UUID is a correlation identity, not a browser authorization token or
proof that the worker is alive.

`inference_response_evidence` stores at most one full response per attempt.
Admission rejects a requested-model mismatch before reservation/transport.
The journal writer locks the attempt, checks invocation identity, dispatch,
exact requested model/provider and bounded response ID/counters, then inserts
idempotently. Exact duplicate evidence is a persistence retry; conflicting
evidence durably poisons correction eligibility on the marker and commits an
uncertain fence before reporting the conflict. Restart or later exact retry
cannot erase that poison. Legacy markers without owner identity cannot be
recovered by supplying an arbitrary owner.

For an already accounted marker, poison preserves the physical settled state
so it cannot collide with a newer active request's unique agent/scope slot.
All admission/status readers independently honor the durable conflict field;
the API projects uncertainty. First poison advances the operations cursor in
the same transaction without acquiring task/agent foreign-key locks. The
effective view revokes complete provenance while retaining previously accepted
token/dollar lower bounds. Exact denied retries emit no duplicate invalidation.

All five provider branches emit the optional hook after receiving their parsed
completion, including a late SDK resolution inside the existing promise
deadline. The observer belongs to that invocation; no global mutable callback
can attribute a response to another concurrent call. The hook reports the
requested model; a provider's canonical response model may differ from an alias.
Unknown/partial counters do not become full evidence. Known zero is valid.
Unknown dollar cost stays null. A hook/storage failure cannot authorize a
second inference or return an unaccounted result.

The ChatGPT request-body whitelist explicitly permits the internal hook without
serializing it. That transport emits at parsed `response.completed` inside its
own deadline action. Preserve signal checks/body limits; do not drain a stream
after cancellation to find evidence.

Recording evidence alone does not clear any fence. The next atomic recovery
step compares immutable original receipt and journal under the same marker
lock. An effective usage view overlays validated full evidence only for a
matching ordinary receipt; the original row remains auditable. Every spend,
coverage, operations and usage-status reader must use that view before
clearing the marker. One original request contributes once, at its original
receipt time, including rolling/day/cycle budgets. Native Codex/historical
receipts with no ordinary correlation remain unchanged. Missing or
contradictory evidence remains unknown/fenced. No result/tool/task/approval
state is recovered from a billing record; original timeout/ownership/emergency
errors remain primary.

Recovery must be monotone for original partial evidence: prompt/completion/total
counters cannot shrink, a known original dollar lower bound cannot disappear or
shrink, and a complete known receipt cannot change its token counters. Missing
late dollars preserve known original dollars. Enforce PostgreSQL int32 and
numeric(12,6) bounds after rounding. Explicitly handle original-settlement first,
recovery first, evidence before original receipt and lost acknowledgements.
Unknown late settlement cannot downgrade already recovered accounting;
contradictory settlement durably poisons recovery. Do not clear the marker until
all effective readers can see one matching immutable receipt plus correction.

Operations history must overlay corrected original-time usage even for already
sampled buckets; a future sampler does not repair old stored samples. Preserve
the original health, availability, outages and timestamps. Failed-response
billing evidence cannot increase a provider-success count; qualify or filter
that count by the immutable original outcome. Test an already sampled prior
minute/day/cycle against org, task/family, status and historical operations reads.

## Alternatives considered

- Rewrite the unknown receipt: smaller change, but loses the immutable audit
  trail and makes accidental reset/replay easier. Rejected.
- Append full usage as an ordinary second receipt: double-counts usage and
  leaves coverage unknown. Rejected.
- Immutable evidence plus a consistent effective view: selected. Requires all
  readers and transaction races to be verified together before publication.

## Required proof

- Requested model mismatch: zero transport, zero reservation/receipt/evidence.
- Persist owner UUID; no owner UUID in the existing read-only API response.
- Host timeout then same SDK response resolves: one transport, saved unknown
  original receipt, exact late full evidence, no result/tool/task success.
- Two concurrent unrelated calls: no evidence cross-attribution.
- Duplicate callback/lost commit acknowledgement: exactly one evidence row.
- Wrong owner/provider/model/response ID, malformed or contradictory counters:
  no accepted correction; fence retained.
- Known zero accepted; missing cost remains null; oversized PostgreSQL integer
  or decimal values rejected without invented zero.
- Journal failure and late promise rejection: no unhandled rejection, fallback,
  second transport or permission change.
- Atomic correction vs scheduler/step/claim races on owned PostgreSQL; all
  readers show exactly one effective receipt at the original time.
- Seven-language UI shows recovered accounting honestly while interrupted
  task state remains unchanged; API remains authenticated GET-only.

## Release boundary

The owner/journal/transport foundation is an implementation step, not a
standalone recovery release. Effective readers, atomic correction, all entry
fixtures, complete failure matrix, docs and whole-feature gates remain
mandatory. Current PR41 Windows failure and historical24h/99 qualifications
remain separate gates. No evidence means no recovery; no blanket reset or
browser-submitted token totals are introduced.
