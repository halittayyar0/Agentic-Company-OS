# Capture incomplete endurance work before provenance

## Evidence and purpose

PR46's original Windows job failed with 99 of 100 responsibilities; agent 5
cycle 9 was absent, while all seven fault recoveries passed. The historical
cause is unconfirmed. A later unchanged-source local run passed 100/100 and
the original independent verifier, which does not diagnose the CI failure.
Its extra stop-hook snapshot was 124,536 ms late, after PostgreSQL provenance,
and omitted the root task while older attempts had left the 200-row window.

Capture bounded failure metadata immediately after finalizing observed
evidence, before provenance and cleanup. This is investigation, not a runtime
fix or permission to waive a failing completion requirement.

## Contract

- Retain original 100 completions/600-second CI horizon/seven faults, cadence,
  fault offsets, authority, cleanup and verifier requirements.
- Only a shortfall in observed responsibilities requests diagnostics. Record
  them in the existing hashed journal; no separate unbound report or raw log.
- The driver uses exact observed cycle coverage, including the root task.
  Return at most ten agents, with each agent's first missing cycle.
- Include sampled timestamp, expected cycle count, attempt/receipt truncation,
  numeric identities and counts, finite attempt/task/receipt/invocation states,
  optional next wake and typed blocked reason. Never retain messages, names,
  briefs, output, commands, tokens, URLs, private paths or arbitrary IDs.
- Read current operations plus missing tasks only. A truncated window stays
  explicit; cached observed attempts can provide earlier metadata but never
  certify missing rows or late completion as accepted horizon evidence.
- An absent attempt remains unknown if history is truncated or task identity
  is ambiguous. Only complete, unambiguous history can report not started.
- Bound the whole diagnostic read to 10,000 ms, abort its requests on timeout,
  then continue original provenance and cleanup. Failure/unavailable diagnostics
  use a fixed journal marker and never replace the original result.
- A failed task read leaves that task's state unknown; metadata is not evidence
  that an effect was safe to replay. Diagnostics cause no write or recovery.
- The existing first-cycle native smoke diagnostic remains unchanged.

## Verification

Deterministically prove 99/100 remains failed; final metadata is frozen before
provenance changes state; timeout/unavailable/malformed/private metadata does
not leak or prevent cleanup; complete runs add no diagnostic read. Prove the
actual shared driver identifies a root responsibility's missing cycle 9 and
retains truncation, task and uncertain effect states. Native forwarding must
preserve abort authority. Then repeat original whole-source/release gates on
the new frozen source, review, publish updated PR and inspect actual CI data.

No later pass establishes the historical CI cause. Main merge, distribution,
anonymous v0.5 release and the broader Goal 7 remain incomplete.
