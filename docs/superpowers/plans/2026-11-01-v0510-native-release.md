# Saved-delivery Native Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved-delivery discovery available through a correctly versioned 0.5.10 native release.

**Architecture:** Reuse the existing protected source, native-package and portable-distribution pipelines. Bind every release artifact and receipt to the actual qualified version commit; preserve the published 0.5.9 assets. This preparation changes release metadata, not application behavior or permissions.

**Tech Stack:** Node 24.22.1, pnpm 10.17.1, existing GitHub Actions and native/Docker qualification tools.

**Spec:** `docs/release-checklist.md`, `docs/release-verification.md`, `docs/verification/native-upgrade-ui-2026-10-20.md`.

## Global Constraints

- Version: `0.5.10`; no dependency, lockfile, API, schema or test-census changes.
- Commits: Halit Tayyar, with no Replit/AI coauthor trailers.
- Preserve strict protected checks, exact named platform skips and existing bundle limits/digests.
- Do not publish until original PR and actual-main acceptance pass for the version commit.
- Keep paid services, personal credentials and private host/model captures outside this release.
- The separate operator-host model test retains its original 6 GiB free-virtual-memory admission gate.

## Review Focus

- Public version and native manifest must agree with the immutable release tag.
- Published 0.5.9 already contains the opt-in cold proof and development-only minimatch pin; do not advertise those as new 0.5.10 changes.
- An upgrade from the actual latest published 0.5.9 must retain operator identity, data, capabilities and saved results.
- Genuine archived-application evidence must exercise the compiled archive, rather than a source server or controlled model substitute.
- Chromium viewports and short endurance results must retain physical-device, Safari and 24-hour limitations.

### Task 1: Prepare the version and accurate notes

**Files:** `package.json`, `CHANGELOG.md`, this plan.

**Interfaces:** Existing `createNativeRelease` / `validateNativeRelease` metadata and package-version consumers; no interface changes.

- [x] Verify a clean isolated baseline, actual main identity and the exact source tree accepted for PR #94; retain fresh actual-main CI as pending until it passes.
- [x] Set the root version to 0.5.10. Give the saved-result link and compact-screen fix their own version section; move already-shipped proof/security entries under 0.5.9.
- [x] Run existing release/distribution tests, format checks, frontend build and actual bundle check. New tests that only mirror version literals are unnecessary.
- [x] Inspect and commit only the three metadata/plan files. Preserve the existing worktree, ignored evidence and the original candidate branch.

### Task 2: Accept the exact version source

- [ ] Finish original main acceptance of `7b1181e05a56fe8202f75ace24a8da0f132a6efd` using the original PR #94 head/base/tree/tested-merge identities before merging this version branch. Its metadata PR may run independent checks in parallel while main remains unchanged.
- [ ] Push the version branch and open its PR. Require original protected/platform/package checks and full stock PR verification, then ordinary protected squash and fresh actual-main verification.
- [ ] Capture the resulting version PR head, base, tested merge, tree and actual main from GitHub; do not substitute previous-version identities or passing reruns.

### Task 3: Qualify and publish immutable artifacts

- [ ] Use native packages from the qualified version main and dispatch `.github/workflows/distribution.yml` on that exact main. Verify frozen source identities and immutable image digests with the existing checklist.
- [ ] Qualify fresh extracted Windows installation and a genuine task in the actual new archive. Separately upgrade the actual published v0.5.9 archive, preserve its state and saved result, and complete a new genuine task. Keep cold-model and upgrade model-store claims distinct.
- [ ] Assemble the reviewed asset manifest: five native archives, their five provenance files, standalone setup ZIP, version-specific safe evidence JSON and SHA256SUMS.txt. Version and source identities must agree before tag/upload.
- [ ] Publish v0.5.10 and anonymously download every asset; compare actual bytes/hashes and the latest-release links. Leave a concise benefit/proof/limits/next-work record without claiming general model quality, physical phones, Safari or real 24-hour endurance.

## Execution boundary

Version preparation and its independent PR checks may run while the preceding actual-main checks finish. Opening that PR must not move main, replace the original main evidence or relax any gate. Merge it only after both the preceding main and exact version candidate are accepted. Return to the original candidate branch between preparation and submission so the pending operator-host fixture and exact-source verifier remain ready.
