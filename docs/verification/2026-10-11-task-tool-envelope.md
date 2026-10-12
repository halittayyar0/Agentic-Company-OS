# Bind task tools to the actual model request

## User outcome

A task response can execute only a tool whose schema was supplied in that
inference request. Optional tools selected with `load_tools` become available
in the next request. Selecting and calling a previously absent tool in the
same response does not execute it. Unknown tool names receive the same bounded
recovery, without effects.

The runtime records a warning in the task history and supplies an authored
recovery message in the captured execution language: Turkish, English, German,
Russian, Simplified Chinese, Traditional Chinese or Arabic. This uses the
existing activity interface and export. Permission, task lease, exclusive scope,
approval, effect receipt and cost admission checks remain authoritative.

The per-request name set is captured inside each routed inference attempt.
Later catalog changes cannot expand it. Rejected tool responses retain their
reported usage. Existing correction and fallback limits apply; the guard itself
does not create agents, add an inference request or choose another provider.

## Investigation and current evidence

The preserved actual Qwen application probe returned `computer_observe` when
only `calculate`, `complete_task` and `load_tools` were offered. The old runtime
executed the absent tool. That is a protocol defect independently of the model's
failure to perform the required calculation.

Fourteen controlled regressions first failed because absent tools executed.
They passed after the guard. These cases cover all seven execution languages,
both a missing loader and a loader in the same response, later valid execution,
durable task lifecycle and exact reported token accounting. A further case
covers unknown names, zero dispatch and bounded durable retry.

The first broad affected run was deliberately stopped after obsolete controlled
responses were rejected and some scenarios waited for an effect that could no
longer occur. Its failing log is retained. Fixtures now produce a real loader
response before their scenario; it is consumed and accounted by the outer task
step. One malformed-call fixture has a fifth configured round for this extra
preparation response while preserving its original four malformed calls and
fallback assertions. The production round defaults and real-probe deadlines
are unchanged.

Nine complete affected modules then passed 301 tests with no skips, failures or
cancellations, and the backend typecheck passed. That source receipt precedes
the final compact warning copy and phone test additions. The broader 15-module
run subsequently passed all 364 tests without skips or cancellations. The final
warning, catalog and ordinary inference accounting modules then passed 63 tests
against the final code and copy. These overlapping scopes are reported separately.

The lost-acknowledgement accounting fixture now performs one accounted tool-load
request before its original fault scenario. That preparation has its own settled
receipt and reported two-token usage; the original scenario still makes one
request, retains its five-token receipt, publishes only after durable settlement
and never replays inference. Failure injection applies to the original scenario,
not to preparation.

The complete activity browser module passed 32 cases with no failure, retry,
flake or skip. Seven new cases verify the authored warning at 320 × 844 and 200%
text size, its full visible bounds and its unchanged export. Early failures
measured a 104-pixel text column caused by scaling nested padding with the text.
Compact phone padding now leaves room for the enlarged text. Fixtures await
their existing network and font loading before viewport measurement; assertions
and timeouts were preserved. English and Arabic screenshots were also inspected.

The full workspace typecheck and production build passed. The complete bundle
checker passed with the original ceilings; a prior 25-byte gzip overrun was
resolved by simplifying layout utilities. All-dependency and production audits
reported no known vulnerabilities, production licenses passed, and Gitleaks
reported zero findings in an exact export of the 2,074 publishable source files.
The 339 generated API files still match the retained exact reproduction.

## Limits and next work

These regression responses are controlled fixtures; they are not real model
reasoning or a live ChatGPT account test. The original useful-task probe still
failed its required calculation evidence. The new guard alone does not prove
that small local models now satisfy every task requirement, or that the complete
candidate is ready to publish or merge. The completed broad source scope
precedes the last Russian wording and layout refinement; the final scoped
source/browser proofs and unchanged production guard must not be represented as
a new canonical full-source/full-browser run. Preserve the original task body,
20/120/180-second windows, actual judge and actual usage in a later real-model
probe. Fresh full source/build/browser, platform, security and protected GitHub
acceptance remain required for the final candidate.
