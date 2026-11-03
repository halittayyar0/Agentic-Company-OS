# Node 24 maintenance implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use Node 24.22.2 consistently across the supported installation paths while proving operation-local permission context survives parked stream writes.

**Architecture:** Keep the existing runtime downloader, setup checks and per-operation policy scope. Update their active version contracts together; introduce controlled stream regressions without changing policy decisions or effect admission.

**Tech Stack:** Node 24.22.2, pnpm 10.17.1, TypeScript/node:test, PGlite, Docker, existing native packaging and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-node24-maintenance.md`.

## Global constraints

- Baseline: released main `4df02635ba85ac18b0cbf4d2d6bdacafb7f4ba57`; preserve its proof directories and dirty sibling worktrees.
- Node 24.22.2 and newer 24.x only; exact bundled pins for five platforms and all Docker stages.
- Preserve PostgreSQL 17.11, pnpm 10.17.1, Windows helper tuple, model/permission/deadline/replay contracts and historical facts.
- No paid provider, personal authentication, unrelated cleanup, producer retry or protection bypass.

## Review focus

- A reader with an observing scope cannot substitute it for a denied writer; exercise both normal and legacy context implementations.
- A context-free writer cannot acquire a reader scope; record the observed context directly, without relying on a permission decision that permits unscoped internal calls.
- 24.22.1 is refused consistently in prerequisite detection and localized320/1024 UI; future24.x remains accepted.
- One wrong target checksum or inconsistent Docker stage cannot pass the existing strict package contracts.
- Historical 0.5.10 upgrade input and source proofs retain their old versions; only current runtime contracts change.

## Task 1: Reproduce and lock the context boundary

**Files:** create `scripts/src/testing/execution-policy-webstreams.test.ts`; modify `scripts/src/setup/preflight.test.ts` and `scripts/src/setup/page-browser.test.ts` for the new minimum contract. The cross-project runtime probe belongs in the existing integration-test project so the API server's TypeScript root remains unchanged.

**Interfaces:** existing `withToolPolicy(tool, operation)`, `assertToolPolicy()`, `readExecutionPolicy()` and `updateExecutionPolicy()`; no new production API.

- [x] Run focused existing policy/setup tests in a clean disposable test environment on 24.22.1; use the qualified published baseline for the full pre-change suite.
- [x] Add deterministic parked writes with callbacks/flush recorded under the creating writer operation, reader and absent contexts; default and `--no-async-context-frame` modes must be covered.
- [x] Assert callbacks are pending before the reader drains, all values arrive once and callback context belongs to the creating writer operation. Assert a read-only `vm_write_file` writer is denied even when `computer_observe` drains it.
- [x] Add 24.22.1 to rejected prerequisite inputs; retain 24.22.2 and later 24.x acceptance and rejection of malformed/prerelease/other-major versions.
- [x] Run new regressions on 24.22.1 and retain the expected semantic RED output. No real effect, model request or user storage is permitted.

## Task 2: Align the runtime and active contracts

**Files:** `Dockerfile`, `deploy/native-runtimes.json`, `deploy/native-attribution/sources.json`, `deploy/native-attribution/README.md`, `package.json`, `scripts/native-runtime-download.mjs`, `scripts/build-setup.mjs`, `scripts/src/setup/preflight.ts`, `scripts/src/setup/check-report.ts`, `scripts/src/setup/setup-client.js`, active `.github/workflows/*.yml`, `scripts/src/testing/real-local-first-task.ts`, `scripts/src/testing/coding-container-smoke.ts`; corresponding setup/native/compose fixtures.

**Interfaces:** preserve runtime pin shape `{version,url,sha256}`, current setup issue codes, upgrade protocol 1 and current Docker targets.

- [x] Confirm official latest24.x is24.22.2; record five published archive checksums, official license bytes and the official Docker index digest supporting amd64/arm64.
- [x] Stage a separate verified Windows executable; never replace24.22.1 or old caches.
- [x] Update active pins/version floor, root application version 0.5.11, workflow/runtime assertions and affected fixtures together. Preserve intentional historical/baseline version values.
- [x] Run context/setup regressions with 24.22.2; require GREEN in both context modes and current policy tests. Keep policy source unchanged unless a separately reproduced owned defect requires a documented ruling.
- [x] Verify exact Windows helper tuple and all non-Node runtime pins remain unchanged.

## Task 3: Verify the product and finish through protected GitHub flow

**Files:** current `CONTRIBUTING.md`, `SECURITY.md`, `replit.md`, `docs/self-hosting.md`, `docs/efficient-work.md`, both `docs/operator-reference*.md`, `docs/release-checklist.md`, `docs/release-verification.md`; `scripts/release-expectations.json` only after actual test census is known. Add a dated verification record.

- [x] Update current install/developer requirements. Run targeted seven-language320/1024 setup checks, including old-runtime rejection; no visual redesign or new UI flow.
- [x] Run source tests, types/build/format/audit/licenses/bundle checks under24.22.2. Review exact new census and unchanged platform skips before adjusting release expectations; do not lower an acceptance threshold. Local source:3170/3135pass/35skip, with one extra EPERM symlink skip; strict Windows CI still requires3136pass/34skip. Final context/census follow-up29/29 and full UI1517/1517 passed. Additional whole-project static auditor did not pass because of its qualified baseline parser loop.
- [ ] Commit a coherent change as Halit Tayyar with no coauthors. One fresh-context whole-branch review; fix concrete findings and rerun affected checks.
- [ ] Push one reviewed candidate, open/update a concrete PR and inspect original required and relevant optional jobs, including newly triggered genuine-source work. Do not rerun failed records.
- [ ] Merge normally only when required and relevant checks pass; then qualify the exact actual-main revision and native output before a new release cycle. Record verified benefit, evidence, limits and next work; broad goal remains active.
