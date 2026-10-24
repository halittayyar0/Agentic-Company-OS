# Dependency security recovery — 24 October 2026

The useful-result work in PR 81 remains unmerged. Its preceding candidate
`4793da3` failed its original production dependency audit. CodeQL's analysis
job completed, but its aggregate also failed with three high-severity alerts.
These original failures are retained; no failed producer is rerun or accepted.

## User benefit

- Patched collection validation rejects oversized arrays before expensive
  element checks. Malformed compressed JSON cannot terminate the API process.
- The code-generation parser preserves relative reference identity and rejects
  encoded-scheme and malformed-host confusion.
- Approval listing, private result review and decisions have an independent
  300/minute socket-address limit, including standalone router mounts. Earlier
  API/login limits and operator credential requirements remain.
- Browser forms share the official Standard Schema adapter over their existing
  Zod Mini schemas. Existing layouts, field messages, first-error focus and
  permissions remain. The persisted table-heading boundary retains the server's
  UTF-16-unit rule despite Zod 4's general code-point string-length semantics.

## Reviewed changes and local evidence

Exact dependencies: Zod 4.6.6, body-parser 2.4.0, qs 6.16.1, fast-uri 3.1.9 and
OpenAI SDK 6.0.0. The SDK update satisfies Zod 4's peer contract; outgoing tool
types and owned synthetic fixtures are precise, while actual provider unions
and refusal checks remain. Orval explicitly generates Zod 4 validators. The
already pinned express-rate-limit 8.7.1 moves from development to runtime use.
No dependency quarantine exception is added.

The collection and compressed-body regressions first reproduced both failures
against the previous dependencies, then passed. The URI regression resolves
the actual Orval → OpenAPI parser → Ajv → fast-uri chain. It reproduced the
encoded-scheme failure on 3.1.8 and passes on 3.1.9, with relative, host, suffix
and normal-URI controls. The standalone approval test first lacked a limit,
then passed shared GET/POST exhaustion, `Retry-After`, forwarding-header refusal
and no additional authentication work after exhaustion.

Both final production and complete dependency audits report zero advisories;
production licenses pass. The 96-case AI library, 129-case protocol selection,
90-case API selection and 133 release-verifier contracts passed within their
reported scopes. The API driver's earlier relative-loader failure remains
retained; the canonical absolute loader passed. Generated source is stable
across regeneration for all 381 source files checked.

Workspace types and production build pass. Browser predicates preserve exact
finite-string acceptance and safe-integer bounds. Seven-language agent-form
regression checks compare parsed values and visible field messages with the
previous adapter. Existing bundle ceilings pass after sharing the adapter and
browser predicates with their existing vendor runtime. No numeric ceiling,
timeout, skip list or accounting exception is increased. The draft-format
budget recognizer now requires the exact UTF-16 predicate and bound variable;
wrong limits, wrong variables and the superseded code-point form are rejected.

The original checksum alert started from a browser test helper returning a
numeric accessibility reference for a password field. Its explicit structured
locator preserves the real password-field rejection test. Production SHA-256
result-integrity checks remain. Fresh CodeQL clearance is still required.

## Acceptance limits and next work

An intermediate full source run caught the emoji-heading mismatch; it is not
passing acceptance. The repaired boundary regression passes. The current
529-case browser selection and final original platform/source/UI/CodeQL gates
are still pending at this checkpoint. The source census adds seven standalone
cases to 3,082, for 3,089; platform skip lists and the 1,465-case original UI
expectation remain unchanged. Targeted passes do not replace these gates.

Older real-model, cold-download and browser proofs retain their original
commit identities. They do not qualify this changed runtime or a main-branch
archive. No merge, v0.5.9 publication, physical-phone certification or 24-hour
reliability is claimed. Next: qualify this exact candidate, then ordinary merge,
actual-main archive/model/browser/upgrade proof and public delivery verification.

Sources: [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[body-parser advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828),
[fast-uri scheme](https://github.com/advisories/GHSA-w74x-v6f9-j3xg),
[relative identity](https://github.com/advisories/GHSA-xhq7-xmqj-769h),
[host confusion](https://github.com/advisories/GHSA-wjr9-j795-jxcr),
[suffix serialization](https://github.com/advisories/GHSA-333x-w4r6-6crp).
