# Physical invocation ownership checkpoint

## Why this matters

The container preflight for PR #36 recorded a successful receipt whose original
attempt became lost before the effect completed. Its primary evidence omitted
the winning invocation's attempt ID, so the saved bundle cannot distinguish
an invalid late owner from a valid replacement. That failed bundle is retained;
it is not rewritten or accepted by this change.

The production receipt API already exposes each invocation's physical attempt.
The replay reservation deliberately preserves immutable logical receipt fields
while a new attempt can perform a safe pre-effect retry. A new regression first
failed because the verifier counted a valid replacement as a stale commit.

## Correction

The endurance reader now preserves invocation attempt IDs and includes a bounded
winning-attempt snapshot in primary receipt evidence. Its owner must match the
winning invocation and the logical task, agent and cycle. Both origin and
winner must be durably finalized before their joined evidence is frozen.
Missing owners, detached IDs, different tasks/agents/cycles, unfinished owners
and contradictory snapshots of one attempt fail closed.

Stale commits are derived from the actual winning owner: an effect completed
after that owner became lost still fails. Valid recovery from a different lost
logical origin is accepted only with the fresh owner's matching proof. Existing
duplicate-operation and physical-effect boundary checks remain active. No
production executor, permission, recovery or receipt guard is relaxed.

The read model runs parallel database reads after choosing `generatedAt`. A
second regression caught finalized rows newer than that snapshot timestamp.
The reader now defers those joined rows until a later snapshot instead of
freezing future-dated primary evidence. It does not rewrite an observed row.

## Local evidence and limits

- 149/149 final verifier, driver and observer tests passed. New acceptance
  covers replacement ownership and snapshot deferral. Nine hash-rebound
  negative cases cover missing IDs/snapshots, detached IDs, wrong task/agent/
  cycle, unfinished ownership, contradictory snapshots and genuinely late
  physical owners. Earlier stale-owner, duplicate-effect, contiguous-cycle,
  unrelated-receipt, timestamp and hash checks remain exercised.
- Two legacy fixtures were completed with physical owner metadata so their
  original contiguous-cycle and unrelated-receipt assertions still reach
  the intended guard. Their rejection patterns were not broadened.
- Independent review reproduced three evidence defects: an unfinished logical
  origin was accepted, one physical ID could claim different task/agent
  identities across receipts, and a future receipt could fail the owner join
  before deferral. All three failed new tests before correction. Both owners
  now require final state, a bundle-wide map checks one consistent snapshot
  per attempt ID, and future receipt rows defer before joining the owner.
  Historical missing owners still fail. Re-review found no remaining
  actionable issue.
- Final scripts typecheck passed. This source evidence uses deterministic
  fixtures and virtual clocks; it is not real native/container acceptance.
- The change adds only explicit IDs, states and timestamps to an existing
  synthetic proof. It includes no commands, arguments, file contents, model
  text, credentials or new provider call.

Exact-head full CI and a fresh real preflight remain
required before publication. The separate live spend-journal preflight on
`d263270` does not certify this newer source. A real 24-hour soak remains
unverified. Existing runtime issues #29 and #34 remain open.
