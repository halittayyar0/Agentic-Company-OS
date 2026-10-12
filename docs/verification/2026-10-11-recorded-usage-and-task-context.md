# Recorded usage, completion review and recent task context

Development verification, 11 October 2026. The current local first-job candidate
is **not accepted for release**: the latest real model task did not complete.

## What changed for users

- Task responses show recorded lifetime tokens, including completion reviews and
  reported failed calls. List, detail, subtasks, cancellation, autonomy changes
  and creation replay use the same projection. The read adds one grouped ledger
  query for a page and changes no receipt, budget or task ownership. A higher
  historical task counter is retained. Unknown usage and missing prices are not
  invented; the number is not a complete bill.
- The project Evidence view explains that scope in all seven application
  languages. Local models with no reported price still have no invented dollar
  cost.
- Completion reviews require an actual nonempty reason. Invalid JSON, missing,
  blank or nonstring reasons cannot certify completion. An unavailable approval
  review remains a warning before the separate human approval gate. Verified local
  thinking models receive the existing no-thinking control for reviews; other
  provider behavior and the 4,096-token review ceiling remain unchanged.
- After tools and protocol recovery, each task request ends with the entire
  original task message, still fenced as untrusted data. Its single copy moves
  after the history. Policy, custom expertise, exact localized correction
  messages, assistant/tool pairs, receipts and existing limits are retained.
  This prevents later correction messages from displacing the task as the most
  recent user input; it does not increase a model's context capacity.

## Checks and their limits

These are overlapping scopes, not counts to add together. Controlled provider
fixtures prove application behavior; they are not real account or model trials.

| Check                            | Actual result                                                           | Scope                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task usage API reproduction      | 8 cases: 7 failures before implementation; final 8 passed               | Recorded review usage, pagination, subtasks, failed calls, replay, cancellation, historical counters and totals above 32-bit range               |
| Usage and budget modules         | 68 passed                                                               | Eleven complete modules at their captured source; no current full-source claim                                                                   |
| Phone copy                       | Corrected focused 7 passed without retries or skips                     | Seven locales, 320px browser viewport, recorded value, explanatory text and horizontal fit                                                       |
| Earlier complete project UI file | 129 passed, 7 failed                                                    | New checks initially opened Workspace instead of Evidence; failures are retained. Corrected focused 7 do not turn this into a new 136-case pass  |
| Review integrity reproduction    | 10 cases: 8 failures before implementation; 10 passed after             | Actual owned loopback requests, reasoning control, invalid/valid review handling and immutable accounting                                        |
| Earlier caller regression run    | 495 passed                                                              | Thirty-two modules before the recent-context change                                                                                              |
| Recent-context reproduction      | 7 failed before the change                                              | Every language lost the exact task message after a guarded tool rejection                                                                        |
| First recent-context caller run  | 502 cases: 474 passed, 28 failed                                        | Combining correction text with task text broke existing exact localized-message contracts                                                        |
| Corrected affected modules       | 169 passed, zero failures/skips                                         | Both complete task-envelope and agent-status locale modules; all four original recovery-message scenarios retained without weakening their tests |
| Final workspace checks           | Formatting, typechecks, production builds and bundle checks exited zero | Original numeric bundle ceilings retained                                                                                                        |

The corrected context, affected-module and workspace checks share the frozen
2,078-file runtime source SHA-256
`93ce9c54afc0fdf731ef9cbd750af82b79cafbbcb22b065a4ac50c49482f0a7a`.
This record and its documentation link were added afterward. No current whole
source/UI census or platform release acceptance is inferred from scoped checks.
An earlier test-only TypeScript target error and a private probe preparation
syntax failure are retained; neither is a completed model trial.

## Real Windows CPU trial

The last trial used the retained SHA-verified Ollama 0.30.0 binary/runtime and
Qwen3.5 0.8b Q8 weights, the native installer, private PostgreSQL, authenticated
API, two workers and an English 390px browser viewport. Requests and responses
were forwarded unchanged. The original task remained:

> Use calculate for 17 × 23, report 391, then complete this one task. Do not
> delegate, create agents, browse or write files.

The original readiness/inference/task windows remained 20/120/180 seconds. There
was no forced tool selection, injected completion requirement, simulated judge,
fake usage, paid/cloud fallback or human account login.

**Result: failed to complete within the task window.** The model first requested
completion without using calculate. Its review response was malformed JSON;
completion was not certified. A later task response reported 4,090 prompt tokens
and only six output tokens, with `finish_reason=length` and a 4,096-token total.
Another reported 4,052 prompt and 44 output tokens, also ending at that total.
The daemon's retained logs provide context-limit evidence, not proof that every
earlier incorrect action had the same cause. Cleanup passed, the source stayed
frozen and no owned remote request was observed.

Two earlier real trials also failed: the review stalled in one and the task
returned to passive responses in the other. Their raw failures are preserved.
The [earlier first-result record](./2026-10-11-local-first-result.md) remains a
historical completed task with an unexplained WARN review and a token-display
gap; its facts have not been replaced with current acceptance.

The latest trial did not reach completed-delivery or recorded-token UI acceptance.
Actual ChatGPT sign-in through a task consuming account allowance, physical phone
access, other native host platforms, the container path, all-language model
quality, continuous-operation qualification, current complete release gates and
publication remain unverified.

## Next work

Protect response space on constrained local runtimes using the actual configured
context capacity and bounded, evidence-preserving task history. Preserve policy,
owner requirements, current-cycle receipts, original time/tool limits and honest
usage. Then rerun the same real first job before qualifying the full current
source/UI/platform/security census and protected GitHub publication.
