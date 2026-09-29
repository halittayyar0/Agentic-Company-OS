# Efficient autonomy progress

Working checkout: isolated publication source, branch codex/autonomous-efficient-work.
Baseline: 822e4deb609c6f254c0a1c8f990c67bbc39bacfb.
Implementation commit: 12ddee8; subsequent acceptance fixes are in progress.

- Task 1: economy routing, bounded delegation/hiring and on-demand skills guidance implemented. Targeted integrated execution suite: 71 passed.
- Task 2: current-cycle and rolling-day reported usage admission, within-loop stop, and parent waiting implemented. Targeted tests included above.
- Task 3: portable immutable-image setup, native source choice and seven-language public start page implemented. Installer tests: 8 passed; browser setup: 3 passed; public page locale/mobile matrix passed. Public deployment is pending.
- Task 4: full tests, production container wizard acceptance, actual model acceptance, independent final review and publication remain in progress.

Ruling: Public availability means a public distribution/start site with isolated single-operator installations, not a shared internet-exposed tool execution backend. This preserves existing product architecture and credentials; cost if wrong: a separate multi-tenant design would be required.

## Live acceptance finding

Real Windows installation and resume succeeded with a free-only model selection.
The finite arithmetic task reached 58,181 tokens and did not finish inside 180 seconds.
Retained isolated database activity showed successful tool invocations, an unavailable completion judge and provider rate limits. The fixture cancelled the task and stopped its owned processes/database.
The existing alpha remains public; this candidate is not yet certified or published.

Additional work: replace eager full task tool schemas with an authorized on-demand catalog; stop the current attempt when completion review is unavailable, allowing scheduler backoff instead of same-round report regeneration. Keep fail-closed completion and free-only routing. Repeat live acceptance and preserve failure evidence. These changes do not bypass review or assume unreported cost is zero.

Current full-suite log: OS temp acos-efficient-full-tests.log. No 24-hour certification is claimed.

## Independent final review and fixes

One read-only whole-branch review of 822e4deb..0424209c found three important issues; no declined judgments or deferred minors.

- Review outage classification: preserve ModelRoutesExhaustedError instead of converting a provider failure to a runtime bug. Provider classification test failed before the fix and passed after it.
- Review budget bypass: check durable admission before each execution and review provider attempt. Completion/approval review admission test failed before the fix and passed after it, with zero review requests after exhaustion.
- Unknown cost: keep null costs and explicit no_usage/unknown/partial/complete coverage. Empty/null/mixed tests failed before the fix and passed after it; scheduler audit includes coverage.

Live diagnostic reproduced another cause: the exact judge prompt at 400 output tokens returned finish_reason=length and no content; 1,200 returned valid pass JSON (1,260 total tokens, provider-reported cost zero). Review output allowance is now bounded at 1,200. End-to-end live rerun remains required.

Production container installation and resume passed in the first CI run. The separate ten-agent endurance workload hit the new default four-task family limit; its isolated test configuration now explicitly requests capacity ten. Production defaults remain four. Regression tests passed after adjusting the fallback fixture to explicitly select a premium route and preserving reported-cost decimal formatting. Windows scheduler-test teardown now awaits heartbeat and database shutdown; the prior EBUSY reproduction now passes (8 tests).
