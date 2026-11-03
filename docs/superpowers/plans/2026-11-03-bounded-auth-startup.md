# Bounded Auth Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace an indefinitely pending authentication read with existing localized recovery while preserving authoritative access checks and improving safe failure evidence.

**Architecture:** The canonical auth client owns a bounded, cancellable status read. AuthGate owns stable bootstrap polling/retry behavior; the offline smoke records bounded transport lifecycle metadata without changing acceptance. Existing auth UI and copy remain canonical.

**Tech Stack:** Node24.22.1, pnpm10.17.1, TypeScript, React Query, existing React/Radix UI and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-bounded-auth-startup-design.md`

## Global constraints

- Authentication status read deadline15000ms, including body consumption; native page-readiness budget30000ms unchanged.
- Server authorization, login/logout mutation behavior, source skip sets, exact-two endurance health and all existing fault/freshness/recovery deadlines unchanged.
- Seven locales:tr/en/de/ru/zh-CN/zh-TW/ar. Reuse current design tokens, auth states and Button; no visual redesign or new secrets/storage.
- Current467 remains rejected. Original qualification uses a clean source-only copy outside the implementation worktree. Implementation uses the existing isolated dffc worktree, not another worktree.

## Review focus

- HTTP200 with an unfinished body must time out; receiving headers is insufficient.
- Caller cancellation and late status data must never expose protected content.
- Initial auth failure must remain actionable; polling and offline hints must not strand Retry.
- Login/logout writes retain their original uncertainty and dispatch count.
- Failure diagnostics retain no sensitive values and do not delay or turn failed acceptance into a pass.

## Task1: Bounded read and canonical recovery

**Files:** `artifacts/agentic-company-os/src/lib/auth.ts`, new `auth.test.ts`; `src/components/auth/auth-gate.tsx`; `src/components/tasks/operator-result-review.tsx`; `tests/ui/auth-locales.spec.ts`; `DESIGN.md`, `UX-CONTRACT.md`, relevant self-hosting documentation.

**Interfaces:** `getAuthStatus(signal?: AbortSignal): Promise<AuthStatus>` and shared `authStatusQuery` remain the canonical status-read owners; other control-plane fetch and mutation APIs retain their contracts.

- [x] Preserve original Windows failure and record unknown cause; complete an unchanged-source observer-only seven-locale local investigation.
- [x] Reproduce HTTP200/incomplete body with current production UI: no recovery after30000ms (`.tmp/auth-status-body-stall-red.json`); existing auth browser baseline3/3 passes.
- [x] Add permanent failing read-boundary tests, then implement composed15000ms status-only cancellation and reject late data. Cover healthy/invalid/login behavior.
- [x] Add seven-locale stalled bootstrap/retry regressions and observe RED for unstable polling/offline hints; pass caller signal, constrain initial polling and make the status read independent of online hints. Keep existing auth cases green.
- [x] Pass the same controlled body peer GREEN, inspect English/Arabic320px and desktop error/retry states, and update durable behavior/documentation without new visual tokens.

## Task2: Safe native transport evidence and candidate qualification

**Files:** `scripts/src/testing/connection-save-diagnostics.ts`/test; `guided-local-connection-smoke.ts`; release census/producer assertion; dated verification record.

**Interfaces:** Keep existing header observations; add optional, bounded auth lifecycle observations linked by numeric fixture request IDs. Existing consumers without lifecycle events retain their prior snapshot shape.

- [x] Add lifecycle/body-finish, unsafe-input privacy and bounded-window regressions; observe RED before implementation.
- [x] Connect browser request/response/finished/failed events and include safe lifecycle metadata in the existing failure record. Never collect response bodies or change original errors, assertions or deadlines.
- [ ] Run focused source/browser/native checks, whole-workspace types/build/format, generated consistency, audits/licenses/bundle and required static UI audit; retain genuine/device/original-cause limits.
- [ ] Record actual source/UI deltas only, verify old skip sets and other limits identical, and obtain one independent final review; pass staged and commit secret scans.
- [ ] Finish observing and preserving all original467 producers, then commit/push the real repair as Halit/no coauthors and bind fresh original IDs. No reruns or acceptance transfer.
- [ ] After mandatory new original checks, integrate normally once; complete fresh actual-main/native/genuine059-upgrade/distribution/public verification, record user value/evidence/limits/next work and continue the broad goal.

## Implementation findings

Operator result review is the second auth query owner and now uses the same cancellable, offline-hint-independent query options. Desktop verification found that the default Button responsive minimum reduced login/recovery actions to 38px. These actions now use its existing touch size, with no shared token change. Seven-locale phone/desktop recovery plus existing auth cases pass 17/17. Read and diagnostic cases pass 18/18; original failing runs remain preserved.

Final review identified React Query's offline-hint mode changing its reconnect default. Explicit reconnect refresh now preserves the contract; the added browser case failed before the fix. Static inspection found a missing application-validation declaration; the existing English login case failed its noValidate assertion before that declaration was added. The compiled reader helper has one additional exact hash-pinned identifier form, covered alongside the old form by the existing valid/tamper cases; no numeric byte cap is raised. Final checks are pending for these changes. The full official static audit is incomplete because its unchanged parser revisits the same offset in an unchanged sibling test; the isolated cycle proof and narrower unchanged-rule touched-file audit remain separate.

Ruling: allocate only the exact bounded status read and connectivity options to their own 256raw/128gzip cap, compose their reconstruction before Composer, and remove Keeper/resume overlap before one global credit. The older Composer cap measured all later entry growth and therefore misattributed this change. Every old numeric ceiling is retained; body/query shape, ownership, tampering and preceding controls have RED/GREEN tests. The source census adds twelve cases overall, and final hosted source/native qualification remains required. Incorrect attribution would weaken performance accounting; a focused independent review covers the new scope.

Independent budget review found no overlap/ownership/ceiling issue. Its diagnostic-total finding is resolved by including the already-enforced gzip allocation in both failure messages; the user authorized routine fixes, and evidence-backed failure reporting requires those messages to match the predicates. No threshold or behavior changes. Final focused source contracts pass59/59 with no skips.

Local checkpoints: final59/59 focused source,8/8 final-panel browser, preceding32/32 seven-language auth/operator browser, whole types/build, generated API consistency, both audits/licenses/bundle and changed-file static audit pass. Full static audit remains incomplete with a reproduced tool-parser cycle. Existing local seven-language installer proof predates review fixes and is supplemental; final native/source/UI/platform qualification comes from new original hosted producers. Do not transfer rejected467 acceptance.
