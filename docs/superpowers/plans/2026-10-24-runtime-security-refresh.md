# Runtime Security Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship patched self-hosted runtimes without breaking upgrades from the published installation.

**Architecture:** Keep reviewed download destinations and integrity locks together; use actual runtime regressions to verify security behavior. Enforce current versions at new build admission while keeping historical manifest readers compatible. Requalify the resulting PR and actual main instead of reusing prior acceptance.

**Tech Stack:** Node.js 24.22.1, PostgreSQL 17.11, TypeScript/node:test, Python, PowerShell, GitHub Actions, Docker OCI metadata.

**Spec:** `docs/superpowers/specs/2026-10-24-runtime-security-refresh.md`

## Global Constraints

- All five native targets remain required; HTTPS, SHA-256 and closed reviewed URLs remain mandatory.
- Previously published v0.5.7 metadata (Node 24.21.0 / PostgreSQL 17.10) must remain readable.
- Existing test deadlines, worker limits, inference budgets and five-platform acceptance remain unchanged.
- No automatic pgcrypto data repair, logical-decoder plugin expansion, personal database access, paid inference, new authentication or secret disclosure.
- Original PR and actual-main acceptance must identify the changed source and binaries before publication.

## Review Focus

1. Old installation metadata must remain inspectable during upgrade and backup.
2. A stale but valid-hash lock must not silently reintroduce an affected runtime into new packages.
3. Changed notices and source checksums must match the exact downloaded release.
4. A test must distinguish rejecting malicious input from simply losing all DNS/database connectivity.
5. An OCI tag or workflow headline must not substitute for exact runtime/platform/artifact identity.

### Task 1: Verify upstream security behavior and refresh build admission

**Files:** `deploy/native-runtimes.json`, `deploy/native-attribution/*`, `scripts/native-runtime-download.mjs`, `scripts/build-native-setup.mjs`, `scripts/build-native-postgres.py`, `scripts/src/setup/native-package-proof.test.ts`; create `scripts/test-runtime-security.mjs`.

**Interfaces:** Existing `nodeArchiveDownloadUrl(target, pin)` remains closed and returns only the reviewed 24.22.1 URL. Runtime probe executes using its calling Node and accepts an optional fresh-cluster psql test only through the existing test harness; no external DNS or user database.

- [ ] Write the safe loopback DNS regression and run against old 24.21.0; expect NUL-name rejection assertion to fail while valid local DNS succeeds. Retain the old psql failed-COPY sentinel control separately.
- [ ] Add package-lock regression assertions for patched new targets, rejecting old pins and altered URLs while existing historical manifest/upgrade tests stay unchanged. Run and observe failure against existing locks.
- [ ] Download and hash-verify upstream Node 24.22.1 archives/checksum index and PostgreSQL 17.11 source/checksum and notices. Update the reviewed locks, new-build admission and current attribution only.
- [ ] Run actual patched Node probe and patched psql sentinel control; expect valid DNS/database operations to succeed, NUL input to be rejected and COPY payload rows to remain zero. Run focused setup/provenance tests and Python download-integrity tests.
- [ ] Commit the verified build/security change with its source evidence document.

### Task 2: Align CI and deployment runtimes

**Files:** `.github/workflows/ci.yml`, `.github/workflows/native-packages.yml`, `Dockerfile`, current setup/security documentation and tests that exercise deployment identity.

**Interfaces:** Task 1 reviewed runtime locks; existing portable PostgreSQL URL/checksum guard and immutable multi-platform OCI digest references.

- [ ] Add failing regression coverage for stale CI Node/Windows PostgreSQL pins and application-container identity; retain the already patched PostgreSQL container digest.
- [ ] Verify official EDB ZIP bytes and official Node OCI index/platform config identities. Update only stale CI/build/container references and run the harmless runtime regression on native build hosts.
- [ ] Document security changes, manual PostgreSQL extension caveats and old-installation compatibility. Run complete source tests, types/build/security checks and relevant installation UI tests with seven languages and phone widths; report each failure or unrun platform explicitly.
- [ ] Commit, obtain one independent whole-branch review, address important findings with failing-then-passing regressions, and push a new PR.

### Task 3: Qualify and deliver the new source and binaries

**Files:** New plan-owned ignored evidence receipts and `docs/verification/2026-10-24-runtime-security-refresh.md`; PR/release documentation.

**Interfaces:** New exact PR head/tree, protected squash main, original first-attempt producers, five exact native archives and actual published v0.5.7 upgrade baseline. No old runtime acceptance booleans carry forward.

- [ ] Observe original required PR checks and actual artifact evidence. Merge only after they pass; qualify original actual-main checks and all five native archives.
- [ ] Verify actual archive installation, agent-authorized useful result, mobile/desktop rendered delivery/export, backup/restart and published-v0.5.7 upgrade using new runtimes. Preserve actual failures and bounded resource controls.
- [ ] Publish only qualified immutable images/packages, verify anonymous byte/hash and live results, and record user benefit, passing evidence, remaining limits and next highest-value work. Continue the goal.
