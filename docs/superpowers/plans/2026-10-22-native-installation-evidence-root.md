# Native installation evidence root implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Retain all three Windows native installation restore receipts in the original GitHub artifact without changing installation or release acceptance.
**Architecture:** The shared native installation smoke chooses the GitHub runner temporary root when supplied, otherwise the normal operating system temporary root. Resolve its canonical path before creating an owned proof directory.
**Tech Stack:** Node 24, TypeScript, node:test, GitHub Actions.
**Spec:** The existing three-smoke Windows producer and artifact collector in `.github/workflows/ci.yml`; retained original-main failure `.tmp/v056-r5-retained-installation-evidence-failure/manifest.json`.

## Global Constraints

Preserve the three-receipt release gate, existing named skips, UI counts, source security behavior and the public v0.5.5 upgrade fixture. Do not rerun failed original-main evidence into acceptance. Work only in the existing isolated worktree. Publishing and ordinary merging are already authorized by the user.

## Review Focus

Actual filesystem behavior with differing OS and runner roots, safe owned fixture cleanup, local fallback, and exact source census changes.

### Task 1: Collect native proof directories under the runner artifact root

**Files:** `scripts/src/setup/native-install-smoke.ts`, new `scripts/src/setup/native-install-evidence.test.ts`, `scripts/release-expectations.json`.

**Interfaces:** `runNativeInstallSmoke` owns its directory; the Windows artifact collector consumes runner.temp/acos-native-install-proof-*.

- [ ] Add one unconditional behavioral test invoking the real smoke in isolated child processes with different OS and runner roots, aborting at an absent PostgreSQL executable before a database starts. Cover runner precedence and local fallback.
- [ ] Observe failure because the first real proof directory is outside the collector root.
- [ ] Prefer RUNNER_TEMP when present and retain canonical OS fallback.
- [ ] Run the focused test to green and type checking. Increase only source tests/passed by one on each platform; keep exact skips and UI unchanged.
- [ ] Review the whole branch, commit, and run the full source suite.
- [ ] Open a normal PR and requalify original PR and actual-main workflows, original artifact inventory, all native archives, fresh local model and public predecessor upgrade before publication.

**Expected:** One new passing test on all four source platforms; all three Windows installation evidence files downloadable on the new actual main. No public release until the full existing acceptance contract passes.
