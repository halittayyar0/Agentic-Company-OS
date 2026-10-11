# Incomplete responses, explicit retry and bounded transfer

Development verification, 2026-10-11. This record follows the
[usage and task-context record](./2026-10-11-recorded-usage-and-task-context.md).
The changes remain on the development branch; release acceptance is incomplete.

## User benefit

A response ending with the provider's `finish_reason=length` cannot dispatch
tools, even when its partial tool arguments look valid. Reported usage remains
accounted. A truncated completion review cannot certify delivery.

For a local Ollama task, the app can remove model narration from the current
history once, retaining policy, the exact owner task and tool calls/results.
Recovery requires a smaller request and a remaining round in the original limit.
An unchanged request is not retried by this recovery. Further truncation pauses
the task. Cloud truncation pauses directly.

The paused task page offers an explicit retry with an explanation in all seven
languages. Checking state or a saved acceptance receipt performs no inference.
Sending a retry can consume the task's existing allowance. Saved model selections
are retained; automatic routing is checked again. Usage, cycle, cadence,
requirements and budget are not reset.

The server binds acceptance to the exact blocked attempt. Concurrent duplicate
requests produce one acceptance record. A lost acknowledgement can be inspected
after reload; replaying an accepted request returns its historical receipt.
The acknowledged retry retains the original logical execution identity so that
previous effects keep their replay protection. Active leases, unresolved effects,
approvals, cancelled ancestors, inactive owners and exhausted budgets can prevent
resumption.

## Current checks

| Check                                                  | Observed result                               | Scope                                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Workspace formatting, typechecks and production builds | Exit zero                                     | All workspace build commands                                                                                                   |
| Original bundle checker                                | Exit zero                                     | Numeric limits and existing compiled ownership checks unchanged                                                                |
| Nine complete regression modules                       | 396 passed; zero failed, skipped or cancelled | Task ownership, crash recovery, locale status, retry, budgets, review integrity and tool envelopes; controlled model responses |
| Project, task-resume and primary-route browser suites  | 203 passed; zero retries, flakes or skips     | Seven languages, light/dark themes, phone/desktop and large text; controlled API fixtures                                      |
| Real PostgreSQL route suite                            | 17 passed; zero skipped                       | Real transactions, concurrent duplicate retry requests and preserved execution identity; no model inference                    |
| Dependency audits and production license policy        | Passed                                        | Final dependency graph; source scan receipts are retained separately                                                           |

The build, bundle, regression and browser checks share the frozen 2,089-file
working source SHA-256
`0792efed9c523577a7eaa5f40980cfc132ada4876c3353a1809b19ac507fb8d9`.
This record and the two guide updates were added afterward.

The real PostgreSQL and model trials used source
`df1dc6bef5f7b705a9190de1d4b4909f27c70a9f30da565941efe3c19d8b1c1e`.
Independent reconstruction of that fingerprint confirms that subsequent code
changes affected only the frontend package manifest, lockfile, Vite configuration
and Russian studio copy. Backend and API code stayed identical.

## Transfer size

Only the shared core and UI dependency chunks receive a second compression pass.
Application chunks retain their existing compiler and ownership checks. Browser
targets, property names, runtime error handling and numeric budgets stay fixed.
The two actual emitted vendor files save 6,871 raw bytes and 6,265 gzip bytes
against the retained preceding build. Source-map composition is preserved.
Russian recovery guidance was shortened while retaining its usage, permission,
uncertainty and same-request instructions.

## Real small-model trial

The native Windows CPU trial used the same pinned Ollama 0.30.0 runtime and
Qwen3.5 0.8b Q8 weights. It retained the original task and 20/120/180-second
readiness/inference/job windows:

> Use calculate for 17 × 23, report 391, then complete this one task. Do not
> delegate, create agents, browse or write files.

**The trial failed to complete within the job window.** The model first called
an unavailable tool; the guard refused it. A later response ended at 4,096 total
tokens with `finish_reason=length`. History recovery reduced the next forwarded
request by 401 bytes. Actual request readback confirmed identical policy, exact
latest task, previous tool-call arguments/IDs, tool results and tool schemas.
The next response called `calculate` with numeric values `[17, 23]` and the
multiply operation. Its completion report did not deliver the requested result;
the subsequent review contained malformed JSON and was rejected.

The trial ended with exit one, completed process cleanup, frozen source and zero
requests observed at its owned remote/proxy peers. It used no forced tool
selection, injected completion criteria, simulated response, fabricated usage,
paid fallback or human ChatGPT account. Completed delivery and the final token
counter UI were not accepted.

## Remaining work

- Reduce irrelevant context for small local tasks while preserving policy,
  expertise, owner constraints and evidence; repeat the original real first job.
- Add an explicit repair path for corrupt browser retry records. An unresolved
  valid identity must never be silently replaced.
- Complete real human ChatGPT sign-in through a task using account allowance.
- Qualify the complete current source/UI and native/container platform gates,
  physical-phone access and continuous-operation requirements before release.

No commit, push, merge or new public release is established by this record.
