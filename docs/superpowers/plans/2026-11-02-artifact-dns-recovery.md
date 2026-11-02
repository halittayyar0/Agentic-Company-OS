# Artifact DNS Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve original test evidence through brief artifact-service DNS failures without repeating artifact writes or tests.

**Architecture:** A dependency-free lookup wrapper supplies bounded preconnection DNS recovery. A separate preload installs it only in the two macOS artifact upload action processes. Dedicated Node tests exercise the transport separately from the fixed application source census.

**Tech Stack:** Node24 builtin DNS, HTTP, timers, CommonJS/ESM; existing pinned upload-artifact7.0.2; pnpm10.17.1.

**Spec:** `docs/superpowers/specs/2026-11-02-artifact-dns-recovery-design.md`

## Global Constraints

- Maximum two additional DNS lookups per action process;1s/2s delays;75s absolute per-lookup deadline.
- Only the existing HTTPS results-service hostname; only ENOTFOUND/EAI_AGAIN; same OS resolver/options.
- No HTTP retry, endpoint/TLS/credential change, dependency or environment-controlled limit.
- Existing source3137, skip sets, Linux UI1488, macOS UI34, workers/retries and protected check names remain unchanged.
- Preserve failed originals, never rerun them; Halit author/no coauthors; no routine approval question.

## Review Focus

- Concurrent eligible lookups share the two-retry allowance and each delivers one callback.
- A hanging or late lookup must not reset the absolute deadline or send a request afterward.
- IPv6/all-address options and callback shapes must survive the wrapper.
- Unrelated DNS and non-DNS failures must retain their original behavior.
- NODE_OPTIONS quoting and ESM bindings must work when the repository path contains spaces.

### Task1: Recover only preconnection artifact DNS failures

**Files:**

- Create `.github/scripts/artifact-dns-retry.cjs`, `.github/scripts/artifact-dns-preload.cjs`, `.github/scripts/artifact-dns-retry.test.cjs`.
- Modify `package.json`, `.github/workflows/ci.yml`, `.github/workflows/platforms.yml`, `docs/self-hosting.md`.

**Interfaces:** `createArtifactLookup({lookup,hostname,...testDependencies})` returns a Node lookup-compatible callback function with one shared retry allowance. `artifactHostname(value)` validates the existing HTTPS configuration with redacted failures. Preload imports these, replaces dns.lookup and synchronizes builtin ESM exports; production uses fixed defaults.

- [x] Write transport tests, run the real POST recovery case RED before implementation.
- [x] Implement the bounded resolver wrapper and preload; pass the transport/error/privacy/deadline/process-cap/ESM tests.
- [x] Enable the preload only on the two platform artifact steps; add the separate CI test command to Linux verify and macOS runtime jobs and the developer verify command. Document failure/recovery scope.
- [x] Run focused Node tests, format, source/producer contract checks, typecheck, build, dependency/license/secret checks; review the actual diff and original failed log.
- [ ] Commit/push the actual fix, bind new original head/tree/base/merge/workflow IDs, and qualify the complete source/UI/native/security runs before ordinary protected merge. Keep actual-main/release gates separate.

## Execution ledger

- Original macOS Intel job passed34 UI tests and all installation/model-preparation steps; only evidence CreateArtifact failed with ENOTFOUND. Failed original and raw log retained outside the source tree. No rerun or merge attempted.
- The real-loopback recovery test failed with ENOTFOUND before implementation, then the initial10 transport cases passed.
- One independent review found that an overdue retry timer or ready resolver callback could run before the overdue deadline timer. Two event-loop-stall cases reproduced it as missing expected rejection; monotonic checks now reject expiry before each lookup and callback. All12 cases pass without skips. Reviewer confirmed closure with no new actionable finding; actual macOS action integration remains pending.
- Full typecheck/build, format,26 release producer contracts, production/all dependency audits, license and UI bundle policy checks passed locally. The staged secret scan found no leaks. Application source census/skip sets/UI acceptance remain unchanged. New original hosted qualification is still required.
