# Local connection readiness — 23 October 2026

## User benefit

The local connection form waits for its lazy preparation screen and initial
transfer discovery before accepting edits. Discovery can no longer disable an
already editable field during address entry. API-key setup remains independent.
The existing interface, languages, download authority and provider revision
checks are preserved; no task or inference starts from this change.

## Evidence

- A controlled delay of the real preparation module reproduced the editable-field
  gap before the fix. Seven new 320px browser cases hold both module and snapshot
  loading, then verify the exact entered address is submitted and its normalized
  readback is displayed without creating work.
- The affected connection/preparation UI passed 57 cases; the existing local/cloud
  privacy UI passed 30. Focused backend, revision and protocol tests passed 44
  cases with no skips or cancellations. Full build/types, formatting, dependency
  audit and production-license policy passed locally.
- An owned Windows PostgreSQL installation, API and two workers completed all
  seven language journeys, nine controlled model transfers, interrupted restart
  recovery and binary database backup/restore. Source remained unchanged during
  that run. Only model HTTP responses were simulated. The final bundle uses the
  equivalent two-choice comparison to remain under the unchanged size ceiling;
  exact-candidate cross-platform acceptance remains required.
- Native acceptance now also asserts the address in the actual save request.
  The Linux UI census increases from 1,418 to 1,425 solely for the seven added
  cases. Source totals, skips, workers, deadlines and security gates are unchanged.

## Retained failures and limits

Original candidate `2dcf668` failed saved-address readback in Linux job
`120312998807` and macOS ARM job `120298935541`. The original cause is unconfirmed;
the separately reproduced readiness gap does not by itself establish that cause.
Neither producer was retried. Original log SHA-256 values are
`0a4dc09f56e34fa2c6be36777cf6856fd79775c2aa685029adbaed1951a4c208`
and `96d7bc7a28737bd45b4d20afb07b05e9883e89648c5b6f0ca4b8e5dfb7d4ccb9`.

An earlier local diagnostic failed with HTTP 500 before its first journey while
the output directory was being rebuilt. It is retained and excluded from
acceptance; it does not establish the cause of the original GitHub failures.

PR #80 still requires fresh original platform/security checks and strict release
verification. No new main merge, public release, physical-phone, native-speaker,
signing or 24-hour reliability acceptance is claimed here. Next: qualify this
candidate and its actual-main packages before extending the first-run journey.
