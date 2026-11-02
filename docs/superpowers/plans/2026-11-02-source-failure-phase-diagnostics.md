# Source Failure Phase Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove verified fixture phase/error masking while preserving original security assertions and recording uncertain original causes.

**Architecture:** Existing native-peer tests observe the actual turn boundary before their existing approval wait. Successful acknowledgement alone is deliberately stalled. Existing screenshot tests stop with bounded publication diagnostics before attempting any legacy reconstruction if the first image is missing.

**Tech Stack:** TypeScript, Node24.22.1, pnpm10.17.1, actual offline native peer, disposable PGlite, existing Chromium fixture.

**Spec:** `docs/superpowers/specs/2026-11-02-source-failure-phase-diagnostics-design.md`

## Global Constraints

- Production code, default deadlines,15s approval observer and40ms checkpoint remain unchanged.
- Preserve original ownership, approval, usage8/receipt1/usage-row1, uncertain session, screenshot pixel/key/single-effect and legacy assertions.
- No workflow rerun, retry/polling, added skip, privilege change or unproven original-cause claim.
- Two additional native regression cases require source census3139 and passed totals+2 on all four source profiles; existing skip arrays and all UI limits remain identical.

## Review Focus

- Preparation failure must reject the readiness race and always clean up the owned child.
- Failed usage outcomes must retain their original error and not wait on the successful-checkpoint gate.
- Delayed acknowledgement must not resurrect an uncertain session or write duplicate usage.
- Missing first image must retain pre-effect versus post-boundary facts without implying publication or retry.
- Diagnostics must be bounded and exclude credentials, raw host paths and fixture URLs.

### Task1: Native usage fixture phase alignment

**Files:** `artifacts/api-server/src/lib/codex-task-service.test.ts`, source census/producer expectation assertion.

- [x] Add actual-native-peer slow-admission and early-ownership-loss regressions; observe RED on the original fixture semantics.
- [x] Align with beforeTurnBoundary; gate only completed usage; wrap all owned work in cleanup; preserve the original assertions and pass all cases.

### Task2: Screenshot first-publication diagnostics

**Files:** `artifacts/api-server/src/lib/orchestrator/screenshot-evidence-recovery.test.ts`.

- [x] Reproduce an injected publication failure with a missing diagnostic marker before the fix.
- [x] Fail the mandatory first read with bounded/redacted result and receipt/invocation facts; prove the marker with the same controlled fault and pass the unchanged eight recovery scenarios.

### Task3: Exact new candidate qualification

- [x] Update four source totals/passed counts by2, preserving byte/value-identical skip sets and all UI limits.
- [x] Run focused tests, types/build/format/audits/license/bundle/staged-secret checks and one final independent review; retain unknown original-cause limits.
- [ ] Commit/push actual changes as Halit without coauthors, preserve rejected originals, bind fresh original IDs, qualify all gates and perform normal protected integration followed by actual-main/release proof.

## Local evidence and remaining limits

- The original macOS Intel source job125510627869 failed two cases. Its initial image was missing before legacy reconstruction. The original receipt/invocation facts were not retained, so that publication failure's exact cause remains unknown. The original run is rejected and has not been rerun.
- Native fixture RED:19 cases,17 passed and both new regressions failed. GREEN:19/19 passed without skips, including the eight original screenshot recovery scenarios. Each harness used and removed its own empty test store.
- Controlled screenshot publication failure: the original fixture stopped at ENOENT without useful phase facts. With diagnostics, the same injected failure still fails the source case, while the negative-test wrapper verifies the bounded marker, unknown outcome and effect boundary. This does not count as a successful ordinary recovery case.
- Release producer contracts26/26 passed. Full types/build, format, both dependency audits, production license policy, existing bundle limits and staged secret scan passed. An independent final review found no P0/P1/P2 findings. The final commit secret scan remains required before push.
- No production behavior or timing limits changed. Windows local checks do not establish macOS, full-candidate, actual-main, physical-phone or 24-hour acceptance. Fresh original CI and later release proofs remain pending.
