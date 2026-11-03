# Required Worker Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Report and display actual loss of required worker capacity while preserving intentional one-worker operation and strict endurance evidence.

**Architecture:** Validated runtime minimum is declared by real topology producers and shared by persisted/live health derivation. Current API carries the minimum; existing localized badge explains a capacity deficit. Task execution, privileges and health evidence acceptance are unchanged.

**Tech Stack:** Node24.22.1, pnpm10.17.1, TypeScript, existing PostgreSQL/PGlite fixture, OpenAPI generator, React and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-required-worker-health-design.md`

## Task1: Production health and topology policy

**Files:** runtime-operations-config.ts/test, operations-state.ts/test, operations-sampler.ts/test, operations-read-model.ts/test; scripts/src/setup/deployment.ts/test; scripts/src/endurance/native-postgres-harness.ts/test and postgres-harness.ts/test; compose.yaml; .env.example.

- [x] Preserve original failure and reproduce through actual native environment/config/production derivation (`.tmp/two-worker-health-capacity-repro-red.log`).
- [x] Add permanent failing tests for min2 with one healthy/one stale, fresh recovery retaining historical rows, min1 intent and invalid configuration. Run RED before production edits.
- [x] Add the bounded policy and shared derivation, then wire every persisted/live reader. Keep offline/emergency/demo/tick/fencing behavior and default1.
- [x] Declare required2 in actual two-worker profiles; reject/override hostile ambient configuration for controlled endurance. Run the unchanged probe GREEN and focused tests.
- [x] Prove sampler/live agreement on a disposable DB and nonmutation of old health samples.

## Task2: Operator-visible capacity

**Files:** lib/api-spec/openapi.yaml and generated clients; operations-view-model.ts/test; operations-copy.ts/test and seven operations-copy locale files; runtime badge/component tests; tests/ui/operations-room.spec.ts; DESIGN.md.

- [x] Add failing read-model/locale tests for a degraded1/2 fleet and retained min1 live/legacy unknown-minimum behavior.
- [x] Expose current policy and regenerate schemas. Wire the existing amber badge to ready/required copy with all seven translations, retaining transport/snapshot priority and layout.
- [x] Verify seven locales, Arabic RTL and320/1024px transitions without changing permissions, provider settings or execution.

## Task3: Documentation and exact candidate qualification

**Files:** docs/self-hosting.md, docs/endurance.md, applicable operator reference/config docs and release-expectations.json/producer census assertion.

- [x] Explain required capacity, explicit one-worker deployments, retained historical evidence and current limits. No health check can create a worker or spend money.
- [x] Update only actual discovered source/UI totals:3155 source cases (+16) and1502 Linux UI cases (+14), keeping original skip sets and acceptance/deadline/worker limits unchanged.
- [x] Preserve the original116-byte bundle failure. Independently cap the exact new locale field and test absent/ambiguous/oversized/unrelated content; retain old numeric ceilings and prevent duplicate usage-reporting credit.
- [x] Run relevant focused tests, types/build, format, generated consistency, both audits, licenses, bundle and staged secret scan; review final change independently. Post-commit secret scan remains required before push.
- [ ] Commit/push as Halit without coauthors and bind fresh head/tree/tested-merge/original attempt1 runs. Keep454d382 rejected and its original failure intact.
- [ ] After all mandatory original checks and exact source/UI/security qualification, integrate normally once. Then complete fresh actual-main/native/genuine059-upgrade/distribution/public readback and leave the dated benefit/evidence/limits/next-work record.
