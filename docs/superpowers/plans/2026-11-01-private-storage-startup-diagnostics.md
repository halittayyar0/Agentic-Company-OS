# Bounded Windows private-storage failure diagnostics

**Goal:** Retain closed child-start and Node event-loop timing facts when Windows private-storage protection fails, without changing its protection, execution or retry rules.

Original PR97 Windows job124767598654/run41277349181/attempt1 failed one handoff case:3112 tests,3077 passed, one failed,34 existing platform skips. The error chain ends in `windows_private_storage_startup_timeout`, before the first protection script reported readiness. Its approval rate-limit case passed. The unchanged handoff test passes locally, and the separate original public diagnostic41283608789 also passes: first child spawn5ms, first script marker2282ms, full child2385ms, maximum observed Node event-loop delay36ms. Neither passing observation establishes the old failure's cause.

## Boundaries

- Keep the SystemRoot-pinned PowerShell executable, encoded protection script,15-second child timeout,16384-byte output limit, ACL postconditions and all filesystem/transactional assertions unchanged. Add no retry, grace, permission repair or accepted transport error.
- Use the existing `execFile` promise's actual child. Do not patch global child-process methods in application code. Observe only spawn/readiness timing and Node event-loop delay; detach listeners and stop monitoring on success, failure or synchronous launch failure.
- Existing public error and immediate cause codes remain unchanged. A nested diagnostic cause contains only fixed field names, booleans and bounded numbers. Never retain target paths, identities, arguments, environment, child output or raw exception messages in those diagnostics.
- A local or separate diagnostic pass cannot qualify failed PR97 head72572d0 or main3496663. Retain those records. New source changes require their own original complete PR and actual-main checks, followed by newly bound package/genuine/distribution qualification.

## Implementation and verification

- [x] Add meaningful RED-to-GREEN tests for fragmented readiness, closed output, lifecycle cleanup, original execution behavior and event-loop distinction. Original implementation/stub:17 cases,10 failures including the existing Windows integration case; implemented tracker:18 relevant cases passed, no skips.
- [x] Add the bounded tracker and integrate it with the existing Windows storage error chain; preserve every original permission and timing rule.
- [x] Run the tracker, real private-storage, transactional and protected file-handoff cases:19 passed, no skips. Library/API types, backend build, formatting and staged/history secret scans pass. Independent byte comparisons retain the protection script, actual child arguments/environment/limits and every filesystem/Unix guard.
- [x] Update the unchanged source-test census only for the actually added nine tests (3121 total on each source platform). Retain all platform skip lists and UI requirements.
- [x] Wait for all six old original PR97 workflows to finish before advancing its head; retain five successes and the Windows source failure. Prepare the final description around connection-limit coverage and safe private-storage diagnostics, without claiming the intermittent cause is fixed. The new head's full PR/main/release acceptance remains pending.

No UI, agent behavior, provider, network capability, model call or user-facing permission changes belong to this diagnostic work. The original intermittent Windows startup failure remains unresolved until reproduced and explained.
