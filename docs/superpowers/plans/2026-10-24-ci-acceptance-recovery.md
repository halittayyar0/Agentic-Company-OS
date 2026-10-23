# CI Acceptance Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish all existing acceptance checks within their existing limits
and reject incomplete or misplaced native evidence.

**Architecture:** Correct the test-side module loading, then move the
unchanged Linux guide proof to the existing preparation runner. Bind that
producer explicitly in the fail-closed release verifier.

**Tech Stack:** TypeScript, Playwright, Node 24, pnpm 10.17.1, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-24-ci-acceptance-recovery-design.md`

## Global Constraints

- Linux 75 minutes, preparation 25 minutes, Windows runtime 90 minutes;
  existing Mac/native limits unchanged.
- UI 1,465 cases, two workers, zero retries; unchanged source skip sets.
- Original attempt-one producers, exact candidate/tree/checkout binding,
  mandatory security and actual-main/package/public acceptance remain.
- Preserve unrelated checkout changes and all failed evidence. No paid
  services, new credentials, application changes or new dependencies.

## Review Focus

1. A missing or skipped moved guide proof must not produce a green release.
2. A duplicate, different-head/run or restarted producer must be rejected.
3. Model-preparation and guide artifacts must retain separate original data.
4. The four failing browser cases must keep every original assertion.
5. Neither job budget nor UI worker/skip/retry limits may silently increase.

## Task 1: Repair the four existing browser regressions

**Files:** `tests/ui/task-result-review.spec.ts`,
`tests/ui/task-result-format.spec.ts`.

- [x] Retain the original Linux job, annotations, full log and the four
      failing cases as RED evidence. No claim of local Linux reproduction.
- [x] Import `loadDeliveryDownloadCopy` and `loadReusableWorkCopy` statically
      in their respective specs; remove only the matching dynamic imports.
- [x] Run both full focused spec files against the existing production
      build. Expect all 33 cases with their original assertions, no retries or
      skips. A fresh original Linux run still owns platform acceptance.

## Task 2: Preserve native proof while removing serial CI pressure

**Files:** `.github/workflows/ci.yml`,
`scripts/src/release/producers.ts`,
`scripts/src/release/producers.test.ts`,
`scripts/src/release/test-fixtures.ts`,
`scripts/src/release/cli.test.ts`, `scripts/src/release/suites.test.ts`,
`scripts/release-expectations.json`.

- [x] Add an original preparation producer to fixtures and regression tests
      for missing/duplicate/wrong-head/wrong-run/restarted producer, bad checkout,
      and missing/skipped/failed required preparation and guide steps. Run RED.
- [x] Require that nested producer from the same original CI run in PR and
      main verification. Validate both mandatory successful steps and checkout.
- [x] Move the unchanged guide command/env and separate artifact upload into
      the existing preparation job after its original evidence upload. Remove
      only the redundant PostgreSQL install from the source/UI job.
- [x] Run all release-verifier contracts and inspect the workflow diff:
      original commands, artifacts, timeouts, worker count and case sets remain.
- [x] Increase the four source census/pass floors by the exact new case
      count, preserving every previous skip name and all UI expectations.

## Task 3: Freeze and qualify a fresh candidate

- [ ] Record both the four UI failures and the timeout with the original
      log hash in verification docs and the PR description. Do not call the
      1,385 started cases passed tests.
- [ ] Run relevant format/types/security/bundle checks. Review the complete
      recovery diff once, then commit it cleanly and push a new candidate.
- [ ] Run fresh original PR qualification, ordinary merge, actual-main and
      native/package/public verification. Old model proofs retain their original
      identity; no failed producer is rerun or reclassified.

## Execution ledger

- Original Linux log SHA-256:
  `67e325a5688b387ccfceac070e56a34b7eea38636fb02b7140993c08687367d6`.
- API annotation explicitly reports `1h15m0s`; UI step ran
  `21:16:53Z` to `21:54:49Z` on 2026-10-23.
- The complete log contains four `exports is not defined in ES module scope`
  failures in the existing English/Arabic provenance and saved-layout cases.
- No application code has been changed for this recovery.
- RED: the producer suite passed 22/26; the two stronger proof counts,
  missing-producer rejection and workflow placement contract failed as intended.
- GREEN: 26 producer tests, then all 133 release-verifier contracts passed.
  The two existing CLI/suite golden proof counts were also increased to 16.
- All 33 focused browser cases passed on Windows. Linux remains unverified
  until a fresh original candidate run completes.
- Source census 3,082 is derived from the verified original 3,080-case step
  plus two new standalone verifier cases; all top-level parameterized loops,
  source skips and UI expectations are unchanged.
