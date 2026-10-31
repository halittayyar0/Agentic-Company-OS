# Real local first-task implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Preserve the
> frozen release worktree and the user's unrelated local changes.

**Goal:** Make genuine cold local-model first-task evidence reproducible on a
standard public Windows runner instead of depending on a maintainer's free RAM.

**Architecture:** A pure proof validator checks exact arithmetic and settled
usage. An opt-in native driver owns the real installer, local-only model home,
bounded transparent relay and synthetic browser journey. A small pinned-input
provisioner and workflow run it and retain only safe public evidence.

**Tech stack:** Node 24.22.1, pnpm 10.17.1, TypeScript, Playwright, PowerShell,
Ollama 0.40.3, PostgreSQL 17.11, standard GitHub Windows runner.

**Spec:** `docs/superpowers/specs/2026-10-31-real-local-first-task-design.md`.

## Constraints and review focus

- Keep the exact model, brief, 12 calls and original deadlines.
- No task retry, inference replay, paid provider, account profile or cloud fallback.
- No private fixture bytes or exception text in uploaded output.
- Spoofed calculator text, mismatched tool IDs and missing usage must fail.
- HTTP success, tool calls or a completed status alone do not prove completion.
- Registry identity, source stability and process cleanup are separate gates.
- New first-task proof cannot substitute for old missing-source release evidence.

## Task 1: Proof boundary

- [x] Add four failing tests for exact request binding, exact calculator output,
      complete genuine acceptance, and rejection of partial/unknown-usage evidence.
- [x] Implement the typed proof validator with no provider calls or file writes.
- [x] Run focused tests RED then GREEN; update all source census totals by four
      and the existing release-expectation assertion without changing skips.
- [x] Add one real-browser regression for the visible delivery result. Observe
      failure against the old broad body assertion and success with explicit
      delivery scrolling. Increase source totals by one more; preserve skips.

## Task 2: Genuine native driver and repeatable workflow

- [x] Add the opt-in real native driver, pinned archive provisioner and workflow.
- [x] Keep owned private raw captures separate from explicit public artifacts.
- [x] Verify full archive hashes before extraction or execution; verify registry
      manifest and every newly downloaded model blob after execution.
- [ ] Capture actual completed-task widths and always prove process cleanup.
      The first backend case passed, but its desktop image missed the delivery;
      receipt schema 2 requires the actual result fully in the captured viewport.
- [x] Run focused tests, types, production build, format and security checks.
- [ ] Review the complete change, commit as Halit Tayyar without coauthor
      trailers, push and open a PR with the exact validation and limitations.
- [ ] Observe original CI and the real first-task job; preserve failures and fix
      established causes instead of replaying failed model work.
- [ ] Merge only after required checks pass, then qualify actual-main outputs.

## Task 3: Evidence and release continuation

- [ ] Document the exact original job, actual source, call/usage/result and limits.
- [ ] Rebuild missing release prerequisites on the new exact source; old receipts
      remain historical. Recheck all platform, language, narrow-screen and security
      gates before release, then verify anonymous downloads and the live start page.
