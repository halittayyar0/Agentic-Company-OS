# Dependency denial-of-service recovery

The original Linux job for PR 81 candidate `4793da3` failed production audit
before source and UI tests. The same candidate previously passed local audit;
the registry now reports two high-severity advisories updated on 23 October:
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) and
[body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828).
The failed producer remains failed. No audit finding is ignored and no original
producer is restarted. Conditional merge waiters are stopped and the PR is draft.

## Intended change

Use Zod 4.6.6 throughout the workspace, body-parser 2.4.0 and its required qs
6.16.1. Keep existing dependency quarantine and audit gates. Move both OpenAI
SDK dependencies to the earliest officially Zod-4-compatible release, 6.0.0;
do not force an unsupported optional peer or retain vulnerable Zod 3.
Keep drizzle-zod 0.8.3 and Orval 8.23.0. Set generation explicitly to Zod 4,
regenerate and review any nullable, default, date, UUID, unknown-key and number
semantics. Preserve operator authorization and finite provider admission,
accounting, cancellation and retry controls. No real OpenAI call or credential
is required to test the SDK transport against controlled loopback peers.

The work is isolated from both the unrelated dirty original checkout and the
frozen `4793da3` empty-store preparation probe. No application data is imported.
Existing development/model proofs retain their original identities. Dependency
changes invalidate the preceding whole-runtime equivalence receipt.

## Work and evidence

- [ ] Add bounded collection regressions through classic and Mini Zod entry
      points. A refinement counter must show oversized input rejected before
      per-element validation; a valid positive control must still validate.
- [ ] Add an isolated real compressed HTTP body regression, with normal JSON
      and post-request liveness controls, that cannot crash the test owner.
- [ ] Observe failures against the old dependencies before installing fixes.
- [ ] Update only the reviewed dependency resolutions and generation mode;
      inspect full lockfile and generated diffs. Resolve actual type and
      semantic compatibility failures without bypasses.
- [ ] Run API/schema/provider boundary tests, generated-code stability, types,
      production build, dependency/license audits, bundle ceilings and the
      complete source/UI checks required by the release verifier.
- [ ] Review and push a clean new candidate, then require fresh original PR,
      ordinary merge, actual-main, archive/model/browser and public acceptance.

The prior original Linux failure log SHA-256 is
`bee75eb148776b2e6392d2506f99fe04971aca8dd40392294abe667ed9386eb0`.
No merge, release, patched-runtime acceptance or physical-device success is
claimed by this plan.

## Execution notes

- Both security regressions failed on the old dependencies and passed on the
  patched versions. Production and complete dependency audits report zero
  vulnerabilities. All four selected package releases exceed the existing
  1,440-minute minimum age; no quarantine exception was needed.
- SDK compatibility requires only precise outgoing function-tool and owned
  synthetic-fixture types. Incoming provider unions and existing refusal
  checks remain intact. The 96-case AI library and 129-case targeted API
  protocol suites passed without skips. Workspace types and production build
  passed after the type adjustments.
- A local 17-file API driver initially used a relative loader, causing a
  worker in an owned temporary directory to fail. Its 84/90 result is retained.
  Using the canonical absolute test-loader URL passed all 90 cases. This was
  local instrumentation recovery, not a restarted original CI producer.
- Patched Zod increases shared browser code enough to exceed the unchanged
  global raw limit by 3,026 bytes. Safe minifier and CSS experiments did not
  provide the needed saving. Browser schemas now share equivalent safe-integer
  and finite-string predicates. Two regression cases compare accepted data
  and rejected inputs, including unsafe integers, coercion attempts and unknown
  strings. These helpers stay with the existing validation runtime in the core
  vendor chunk, preserving reader entry exports and frozen runtime checks.
  Browser forms share the official Standard Schema resolver; their Zod Mini
  schemas, field messages, first-error focus and authorization remain. A
  seven-language regression compares parsed values and visible errors against
  the old resolver. Production types, build and all unchanged bundle ceilings
  passed with this shared adapter. A separate adapter for only one form was
  measured and rejected because it increased transfer size.
- The full source run caught Zod 4's code-point length change at the persisted
  table-heading boundary. The browser now uses the server's exact UTF-16-unit
  predicate; the existing emoji-boundary regression failed before and passed
  after the fix. The earlier full run remains a failed/intermediate result.
- The complete audit later identified four fast-uri advisories in Orval's
  transitive parser. Pin 3.1.9, published on 19 October and older than the
  unchanged quarantine. A regression resolves the parser through the actual
  Orval/Ajv chain and checks encoded schemes, relative reference identity,
  malformed hosts and suffix serialization. Its first run reproduced the
  encoded-scheme defect on 3.1.8; the patched parser passes.
- The previous candidate's CodeQL aggregate also reported two unmodeled
  approval limits and one false password-hash flow from a numeric browser-ref
  fixture. Retain SHA-256 result-integrity checks and actual password-field
  refusal coverage. The fixture now takes an explicit accessibility locator.
  Approval routes also enforce their own socket-keyed 300/minute middleware,
  using the already pinned express-rate-limit dependency promoted to runtime.
  A real HTTP regression observed the missing standalone-router limit, then
  verified shared GET/POST exhaustion, Retry-After, no extra authentication
  calls and refusal of forwarding-header bucket changes. Global API/login
  controls remain. Fresh original CodeQL acceptance is still required.
