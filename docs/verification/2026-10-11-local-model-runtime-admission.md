# Local model runtime admission

## User outcome

Local models that declare a newer Ollama requirement are rejected before
inference. The connection screen and expert model choices explain recovery in
Turkish, English, German, Russian, both Chinese variants and Arabic. Tool
capability remains separate from runtime readiness. Explicit local pins keep
their execution and billing boundary.

Discovery uses the existing version and show requests. No model invocation,
installation, permission change or task creation accompanies a connection check.
Stable versions are compared numerically. Missing or empty requirements follow
the legacy contract; malformed declared requirements remain unverified.

## Evidence collected before full release validation

- The new owned HTTP tests first failed on missing compatibility metadata and
  automatic selection of an incompatible local model, then passed after the fix.
- Ten complete affected source modules passed 82 tests without skips. The
  production build and workspace typechecks passed.
- Two complete affected browser files passed 59 cases with no retry, including
  seven new 320-pixel connection cases with enlarged text and Arabic direction.
  Existing expert-choice cases also cover disabled incompatible and unverified
  models, visible recovery and an enabled compatible local choice.
- Subsequent connection-module deduplication passed the complete bundle checker
  without increasing any numeric ceiling. Model-choice growth is 1,971 raw /
  850 gzip bytes; Settings contributes 507 raw / 181 gzip within that total.
  A final full source/browser run is required for the resulting source revision.

These HTTP and browser cases use owned, controlled peers. They prove admission
and interface behavior, not actual model reasoning or physical-phone execution.

## Separate actual local-model investigation

An owned Windows Ollama 0.18.0 daemon returned HTTP 500 with the public Qwen 3.5
0.8B Q8 model. The original error body was not retained. A subsequent read-only
version/show check established that the model declares `requires: 0.30.0`.
That establishes a version mismatch; it does not reconstruct the missing error.

The complete official 0.30.0 Windows archive was then downloaded and checked
against its release size and SHA-256. A fresh owner-private CPU runtime with the
same verified model blobs returned the bounded READY response with actual usage
counts. Original readiness and inference windows were preserved.

The original installed application task, “Use calculate for 17 × 23, report 391,
then complete this one task,” still **failed** its required calculate-call check.
Four actual model responses were retained; no observed owned remote request
occurred, and cleanup passed. The task and assertions were unchanged. This
experiment exercised the separately frozen `88026d26` candidate and does not
qualify later source revisions, model quality, ChatGPT account quota or a release.

## Original full gates and scoped fixture repair

The frozen full source run finished with 2,492 tests: 2,455 passed, four failed
and 33 skipped. All four failures were in owned native Codex fixtures. The
original failure is retained and does not qualify this candidate for release.
One local Windows symlink skip is an observed EPERM limitation, separate from
the registered hosted Windows skip census.

The full browser run finished with 1,297 passes and no failures, retries, flakes
or skips. Seven additional controlled phone checks scrolled the runtime warning
into a 320 × 844 viewport at 200% text size; they passed separately and are not
added to the canonical browser census. Neither run exercised a physical phone.

Two deterministic regressions then reproduced stale fixture worker approvals
and cold fixture startup consuming the protocol deadline. Owned fixtures now
use the actual runtime registry heartbeat and wait for their existing readiness
handshake before positive protocol cases. The explicit cold-start control still
enforces the original request timeout, and policy revocation still invalidates
live authority. All 77 tests in the complete four affected native fixture modules
passed, and the backend typecheck passed. Production permissions, freshness and
protocol deadlines were unchanged. This repair is scoped evidence, not a new
full source, native model or release acceptance.

## Remaining acceptance

Fresh full source and browser gates, current-revision native installation/platform
proof and protected GitHub acceptance remain necessary. The local-model task
failure requires further work; a connection check or a READY reply is insufficient
evidence of a useful completed task. Real ChatGPT sign-in/quota, a physical phone
and wall-clock endurance remain separately unverified.
