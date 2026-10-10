# Windows Fixture Compilation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the Windows lifecycle regression preparation within the already documented compiler allowance and retain safe preparation evidence on failure.

**Architecture:** Share the existing fixed compiler deadline; add phase observations to the existing test receipt and upload that receipt. Runtime behavior and lifecycle assertions remain unchanged.

**Tech Stack:** Node 24, TypeScript, node:test, Windows PowerShell/.NET, GitHub Actions.

**Spec:** [Windows fixture compilation preparation](../specs/2026-10-10-windows-fixture-compilation-design.md).

## Task 1: Align and observe trusted preparation

- [x] Retain the original failed job metadata/log SHA and inspect the complete source summary. Run the unchanged three-case test locally to distinguish a hosted preparation failure from a reproduced lifecycle failure.
- [x] Export the existing 60-second allowance from `windows-owned-job.ts` and use it for the fixture compiler in `windows-owned-job.test.ts`.
- [x] Record safe helper/fixture phase elapsed time and outcome in `fixture-scope.json`; bind the source step's TEMP/TMP to `runner.temp` and add its owned glob to the existing always-run artifact upload in `.github/workflows/ci.yml`.
- [x] Explain this scope in `docs/chatgpt-connection.md`; keep original test names/counts/skips and all runtime deadlines.
- [x] Run the unchanged lifecycle tests on the modified source (three passed, no skips), inspect the new receipt (two completed phases, matching source hashes, all three lifecycle receipts), and pass targeted formatting and whole-workspace typecheck.
- [x] Complete independent branch review; fix the reviewed upload-path mismatch with explicit source-step TEMP/TMP. No unresolved code finding remains.
- [ ] Run whole-repository formatting and the complete source suite at a frozen candidate.
- [ ] Review the diff, commit/push a new branch, open a PR and retain its original required runs. Integrate only after the full required candidate acceptance; inspect the new main runs and public source independently.

## Limits

The original main failure remains a failed acceptance. Its earlier passing PR
and the local focused run do not replace it. Underlying hosted compiler delay,
real account inference, physical phone use and 24-hour reliability remain
unverified.
