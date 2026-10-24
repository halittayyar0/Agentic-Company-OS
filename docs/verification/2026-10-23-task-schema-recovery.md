# Task tool schema recovery — 23 October 2026

## User benefit

When a model proposes an optional tool before loading its schema, the proposal
still cannot execute. The server now makes that already authorized, original
schema available in the next request. A small model can correct its next call
without spending another round discovering the same tool. Existing selected
schemas remain available, up to the unchanged eight-optional-tool limit.

Unknown tools, exclusive allowlists, permissions, approval rules, leases,
completion evidence, usage accounting and same-response rejection are unchanged.
The rejected-call record explains recovery in all seven execution languages.

## Local evidence

- Tests failed first for missing next-request schemas and recovery audit state.
  The focused task-envelope/catalog suite then passed 77 tests with no skips,
  cancellations or retries. The controlled unadvertised-tool journey needs two
  requests instead of three; it retains every reported token and dispatches no
  action from the original response.
- Permission, exclusive-policy, malformed-input and actual file-recovery coverage
  passed 31 tests, with no skips or cancellations.
- Seven 320px Chromium cases display the full recovered-schema record without
  clipping or horizontal overflow, retain Arabic RTL and create no work. The
  normal initial locale preference write is separately validated. English and
  Arabic screenshots were visually inspected.
- Full build/types passed again for prepared version 0.5.9. Dependency audit,
  production-license policy, formatting and unchanged frontend bundle limits
  passed locally. Original cross-platform qualification remains separate.
- Source expectations increase only for three added catalog tests; Linux UI
  expectations increase only for seven added phone cases. Skip lists, retries,
  workers, deadlines and security gates are preserved.

## Retained diagnostics and remaining work

The initial local runner used an unsupported Node flag before any test ran.
The corrected runner demonstrated the intended failures before implementation.
The first phone run incorrectly counted the initial locale preference write as
task creation. Its logs/screenshots are retained. A failed private patch then
left that test unchanged for one additional run; the actual test correction
validates the exact locale write and still rejects every other mutation.

This is prepared version 0.5.9, not a public release. It does not claim to fix
general model quality or the earlier meeting-note task's scope divergence.
A fresh owned PostgreSQL/API/two-worker test with genuine local Qwen on commit
`1f935f3` observed recovery after the first rejected proposal, followed by a real
file read. All four model responses recorded 11,845 tokens; cleanup passed. The
application marked the task complete after its judge passed the result, but the
independent check rejected it: the requested pipe-separated action rows were
missing. This is failed requested-result acceptance, despite correct extracted
facts. Proof SHA-256: `358fd1c67026b5026094c0d00332902f6b23071bb892ab497ac8aa0f186ebd4c`.

Two direct replays of the captured post-read request, one changing only the
task-mode outcome sentence, both retained the format defect. No speculative
policy edit was made. General result-format and judge reliability remain open;
this schema-discovery change does not resolve them. Full original
cross-platform/security checks, ordinary integration and actual-main package and
public-byte validation also remain required. Physical phones, native-speaker
review, signing/notarization and 24-hour reliability are not certified.
