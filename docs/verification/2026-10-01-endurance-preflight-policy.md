# Endurance preflight and selected spend limits

## User value

A self-hosting operator needs repeatable evidence that recurring work survives
worker loss, provider failures, database loss and emergency stop. The documented
one-minute native preflight did not cover that contract: a real run on
`6f56ef7e80be47bdeb031fb7e0fcdf10a10fa4f5` completed its ten responsibilities but
produced no matching durable incident for `provider-timeout-1`. The independent
verifier rejected the report. That failed evidence is retained; no 24-hour
claim was made from it.

The native guide now selects ten real minutes with `compressed-all`, covering
seven fault kinds and 100 scheduled responsibilities. Before both preflight and
24-hour proof, the operator explicitly selects a finite 2,500,000-token daily
family allowance for the deterministic synthetic workload. The ordinary
production default remains 500,000. Neither usage nor admission rules are reset
or bypassed; no paid provider or external action is used.

## Evidence obtained

- Four regression assertions failed before the implementation: missing explicit
  native/Compose defaults, missing numerical report caps and an unnormalized
  native override.
- The focused endurance source suite passed 59/59 with Node 24.19. It covers
  native API/two-worker environment defaults, native-to-shared-driver override
  propagation, Compose pinning, frozen numerical provenance, secret exclusion,
  malformed caps, zero-step semantics and rejection before build/runtime/output
  directory creation, alongside existing driver and CLI integrity checks.
- Independent read-only review found one material startup-bound mismatch. A
  regression failed before the correction; the selector now enforces the same
  `MAX_TASK_STEPS` (0-10,000) and `MAX_TASK_TOKENS` (1,000-100,000,000) ranges as
  runtime startup. Accepted endpoints and rejected values are covered. No other
  actionable review findings were reported.
- Production monorepo typecheck/build passed; the final scripts typecheck and
  changed-file formatting checks passed after the review correction.

## Required before publication

### Journal contract correction

The first real ten-minute native run on `d5c3a1f` completed 100/100 scheduled
responsibilities and all seven faults, but its independent verification failed:
the numerical spend fields were added to report provenance without extending
the verifier's exact journal contract. The exact-head Windows job on `bd7f3c0`
reproduced that rejection. Neither result is accepted runtime evidence.

A new regression reproduced the rejection with a complete evidence fixture.
The coordinator now snapshots the driver's nine selected numerical caps before
startup and places them in the hash-bound `run_started` record. Verification
requires that complete numeric key set, validates production startup ranges,
and matches all caps exactly to report configuration. Missing caps, strings,
unknown fields, invalid limits and detached values are rejected without
reflecting their raw values. A second regression caught a startup cap changing
while the coordinator still reported success; that drift now fails the report
and preserves cleanup.

The final focused verifier, coordinator, native/Compose driver, spend selector
and CLI suites passed 178/178. Scripts typecheck passed. These are synthetic
unit and integration fixtures, including virtual clocks; they do not certify
elapsed runtime. A fresh real preflight on the new frozen source is required.
The failed old evidence is preserved and will not be rewritten or promoted.

- Full source tests, production typecheck/build, formatting, audit and licenses.
- Independent code review; resolve material findings.
- Live ten-minute native preflight and independent verifier on the final clean
  candidate, with the selected recorded allowance and portable PostgreSQL 17.
- Exact-head required GitHub platform, source/UI, installation and security
  checks; merge only after all pass, then distribution and anonymous release
  verification.
- A real 24-hour run from the same frozen source/runtime inputs after the
  preflight verifies. It remains unverified until its terminal evidence passes.

The original dirty workspace and its unrelated work remain preserved. Physical
phones and native-speaker acceptance are separate unverified limits. Test
provenance is an evidence claim within the existing trusted-host model; it is
not a provider wallet limit or a signed attestation against a malicious host.
