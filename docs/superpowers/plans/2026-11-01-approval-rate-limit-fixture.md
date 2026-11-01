# Approval rate-limit fixture transport plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the approval rate-limit proof exercise independent TCP connections from the same peer, without pooled-socket failures obscuring its security assertions.

## Original evidence

Protected main `3496663ccb91e8ec1bbae1e79d82239fc740ca36` failed original Intel Mac job `124752646373` in run `41274100937`. Its3112-test source summary is3070 passed, one failed and41 exact platform skips. The approval rate-limit test reports `read ECONNRESET` after7133ms; it does not identify the request index or whether that socket was reused. Keep this failure and the publication block. Earlier PR/main successes cannot replace it.

The unmodified focused test passes locally under pinned Node24.22.1. Two immediate idle-close timing probes did not reproduce a reset. A separate owned probe closes the server's idle connection at the client's reuse boundary: its pooled client gets `ECONNRESET` on request1 with `reusedSocket=true`; a fresh-connection client completes302 responses. This demonstrates the transport vulnerability, not the unrecorded timing of the original Mac failure. Node's [HTTP documentation](https://nodejs.org/docs/latest-v24.x/api/http.html#requestreusedsocket) describes this reuse/idle-close race.

The current test also permits all302 attempts to use one connection, so it cannot distinguish a shared peer-address limit from a connection-local limit. The stronger invariant is useful independently of the reset: rotating forwarding headers and opening new TCP connections must not create new approval buckets.

## Boundaries

- Production middleware stays300 requests per60000ms, keyed by the socket peer address before authentication/database work.
- Preserve all300 alternating400/401 responses, exactly150 authentication calls, both429 rejections and their bounded Retry-After values. Add no retries, skips, longer deadlines, limit changes or accepted transport errors.
- Keep the existing test name/count and platform skip census. No runtime, dependency, UI, language string, API or permission change belongs here.
- Preserve closed attempt/method/reused-socket/error-code facts if transport fails again; never print request headers, bodies or credentials.
- Main3496663 is unqualified after its original source failure. Its running jobs may finish, but their results cannot qualify a later commit. A repair requires its own original PR and actual-main acceptance and newly bound native/distribution/genuine proof before0.5.10 publication.

## Task 1: Strengthen the existing regression

- [x] Count accepted connections in the owned server and require one per attempt, after all existing security assertions. Observe the old pooled fixture fail this new invariant.
- [x] Disable pooling only for this fixture's requests. Keep every request and rejection assertion intact and observe the same focused test pass.
- [x] Add closed transport diagnostics and response-error handling so any future reset identifies the failing boundary without replay.

## Task 2: Verify and submit the repair

- [ ] Run focused approvals coverage, relevant type/format/security checks, inspect the final diff and preserve the red/green evidence. Do not repeat unrelated UI builds for a test-only change; original protected CI remains mandatory.
- [ ] Commit under Halit Tayyar without coauthors, push an ordinary repair PR, capture its exact head/base/tree/tested merge and require its original source/security/platform checks.
- [ ] Merge normally only after acceptance. Bind publication to the resulting actual main and new original native artifacts; retain the failed3496663 records and any completed runtime results at their original scope. Do not rerun or relabel failed source work.

## Remaining uncertainty

The original Mac log cannot establish the exact socket lifecycle or whether a different transport cause occurred. The local controlled race and stronger connection invariant justify fixture isolation; a passing focused Windows test cannot certify Mac or remove this uncertainty. Fresh original platform checks and any remaining failures must be reported explicitly.
