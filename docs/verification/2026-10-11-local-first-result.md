# A real local first result with less repeated context

## User benefit

An installed app completed its first task using a real CPU model, saved the
calculation evidence, and displayed the delivery at a 390px phone width. The
previous attempt timed out without performing the requested calculation.

This is one bounded result, not certification of every model or autonomous job.

## What changed

- Task instructions and state now arrive in the recent user message, below the
  shared system policy. The brief is not duplicated in the system prefix.
- Managed roles retain their complete authored expertise in all seven languages.
  Their appended common working rules are supplied by shared runtime policy
  instead of being repeated. Visible, editable/exportable templates remain full.
- Custom role instructions retain their existing bounds and exact contents.
- An empty shared room adds no task context. Real shared messages retain the room
  contract, escaping and data trust boundary. Direct chat keeps its room view.
- Owner-selected completion conditions remain exact task data. Approval,
  permissions, ownership, accounting, recurrence and authoritative operation
  reconciliation stay enforced by the existing server controls.

## Real installation and task

The successful experiment used Windows, Node 24.21.0, a fresh owned PostgreSQL
17.10 database, the native installer and workers, Ollama 0.30.0 and
`qwen3.5:0.8b-q8_0` on CPU. The retained binary, model layers and manifest were
checked against the previous native engine digests before execution.

The original task was unchanged:

```text
Use calculate for 17 × 23, report 391, then complete this one task. Do not delegate, create agents, browse or write files.
```

The original 20s daemon readiness, 120s inference and 180s task windows stayed
unchanged. There was no forced tool choice, arithmetic repair, fabricated usage,
synthetic model response, simulated reviewer, or injected completion condition.

Observed results:

- Four actual requests: `load_tools`, `calculate`, `complete_task`, then review.
- One persisted successful `calculate` receipt in the task's current cycle.
- Saved task status `completed`, result 391, no new agent or extra task, no model
  fallback. The actual review returned `warn`; it supplied no reasoning, so the
  existing missing-reason message was retained rather than inventing one.
- The actual result appeared in `project-delivery-summary` at 390px, with no
  horizontal document overflow. The resulting real browser PNG was inspected.
- No owned remote/proxy request. Native installation, daemon and producer
  terminated; cleanup and unchanged-source checks passed.

The run used the exact working source
`ec1cf040a22c6d5e199de97476bf7e76b4575986e475d8ca79b0ebed2eaf80a6`
on base commit `18519615e39a8c1a6a61fa1c189771dcb869405d`. This was the
development tree, not a published release. The later recurring-condition test
update changed a test assertion; runtime code stayed byte-identical.

### Actual token counts

| Request   |      Input |  Output |      Total |
| --------- | ---------: | ------: | ---------: |
| Load      |      3,566 |      53 |      3,619 |
| Calculate |      3,655 |      45 |      3,700 |
| Complete  |      3,790 |      52 |      3,842 |
| Review    |        273 |       7 |        280 |
| **Total** | **11,284** | **157** | **11,441** |

The immediately preceding failed run reported 16,140 tokens across four requests,
including two responses at the 4,096-token context limit. The successful run used
29.1% fewer reported tokens; its first request used 8.1% fewer input tokens
(3,879 → 3,566). These are observations of one failed and one successful run,
not a performance benchmark or a token estimate. The model still redundantly
loaded already offered tools; further efficiency work remains.

An additional readback exposed a display gap: the saved task counter contained
11,161 execution tokens, excluding the 280 review tokens. The 11,441 total above
includes the actual review request. The task counter is not accepted as complete
cost reporting; that discrepancy must be corrected before release acceptance.

## Source and security checks

- Corrected regressions: eight failed against the preceding implementation;
  the same eight passed after the change. Checks cover recent task delivery in
  seven languages and exact authored expertise for all 15 managed roles.
- Five complete relevant modules: 184 passed, no failure/skip/cancellation.
- Broader task/chat/meeting callers: 444 cases, 443 passed and one obsolete
  assertion failed because it searched the system prefix for owner conditions.
  The final three complete modules passed 97 cases after that assertion was
  updated to verify exact owner conditions in the user data and preserve fresh
  recurring evidence. These scopes overlap and must not be summed.
- Whole workspace build and typechecks passed before the final test-only change.
- All-dependency and production audits reported no known vulnerabilities;
  production license policy passed. The exact 2,074-file public source export
  had zero Gitleaks findings. All 339 generated outputs matched the retained
  exact reproduction; generation was not rerun during the freeze.

Earlier failing and diagnostic runs remain retained. The first regression fixture
captured a mutable message array; it was corrected to capture an actual request
snapshot, then rerun against the preceding code. A new shared-message fixture
initially used an invalid source value; the existing database constraint rejected
it. The fixture now uses the real operator source. Neither fix relaxed production
validation, deadlines, or acceptance criteria.

## Remaining scope

Current complete source/browser gates and native platform release acceptance still
need to finish before publication. Old green checks on the base commit do not
qualify these changes. The existing full UI run and scoped seven-language phone
warnings report their own earlier source scope.

This experiment does not establish physical-phone access, other host operating
systems, container inference, seven-language real model quality, 24-hour behavior,
general reviewer quality, or authenticated ChatGPT plan/credit usage. The unexplained
review warning is not accepted as a successful quality review. Private runtime credentials, model
request bodies and database files are not included in the repository.

Next: correct the task usage display from recorded model usage, then complete the
frozen release gates, resolve any remaining failure, derive
release expectations from their actual census, publish the reviewed changes and
verify the required GitHub checks before merging.
