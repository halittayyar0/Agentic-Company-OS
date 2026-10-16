# Task continuation under routine activity

## User outcome

An accepted answer or useful tool note stays in the next task context when
ordinary lifecycle notifications are frequent. The existing eight-event bound
is applied after selecting relevant task activity. Timestamp/ID ordering makes
the newest entries deterministic when timestamps tie.

Only a conservative subset of minimal informational lifecycle envelopes is
omitted: known kind/state pairs, schema version 1, recognized keys and optional
bounded ASCII identifiers. Malformed or unfamiliar metadata remains eligible.
Sampling, warnings, uncertain effects, retry release, recovery, reconciliation
and control changes remain eligible too. The original operator ledger is never
deleted or rewritten by this selection.

## Focused evidence before final release qualification

- The original source failed all ten new continuation cases: recorded answers
  and tool notes were displaced in seven languages, useful operational evidence
  was displaced, tied timestamps selected older rows and a routine-only context
  used all eight entries.
- Four complete affected modules then passed **23 tests**, with no failures or
  skips. They include the real HTTP answer transaction, duplicate-request
  recovery and seven-language next-step prompts, injection escaping, exact task
  isolation, stable bounds and original ledger preservation.
- A broad initial kind/state classification failed a further regression: six
  unfamiliar or safe-retry transitions were hidden. Explicit producer pairs fix
  that case. Independent review also reproduced malformed values under known
  keys being hidden; conservative identifier validation and retention of extra
  control/sampling metadata fix it. The reviewer found no remaining actionable
  issue in this scope.
- The same **12 context regressions passed on an owned native PostgreSQL 17.10**
  cluster on Windows, without skips. A separate dataset retained one recorded
  answer beneath 100,000 routine notifications. All 100,001 rows remained stored;
  total task-prompt construction took approximately **1.75 seconds** on this
  host. These probes made no model calls. Owned database cleanup was verified.
- The API typecheck, full workspace production build and repository formatting
  check passed. A dedicated native PostgreSQL context step is part of CI
  alongside the complete source suites.
- The complete existing task-resume browser module passed **30 tests**, without
  retries. It includes seven-language question forms at phone widths and Arabic
  controls at 200% text on a 320px viewport. These UI cases use controlled API
  peers; the actual HTTP answer transaction is covered separately above.

The matching release's `VERIFICATION.json` records final source, platform,
browser, model and distribution acceptance separately. These focused working-tree
checks do not substitute for those gates. Historical failed observations remain
separate from accepted runs.

## Boundaries

This remains a bounded view of up to eight relevant summaries. Older useful
entries can fall outside it. It does not restore arbitrary past tool outputs,
provide complete conversation memory or independently prove a summary's claims.
The observed long-history duration is one local dataset, not a latency SLO.

No policy, approval, ownership, usage-accounting or completion requirement is
relaxed. Core policy retains its trusted position and task/evidence text remains
escaped untrusted data. UI history and source text retain their existing locale;
the change introduces no new user-facing strings or model request.

Full model/provider quality, physical-phone behavior, native-speaker acceptance
and 24-hour unattended operation require separate evidence.
