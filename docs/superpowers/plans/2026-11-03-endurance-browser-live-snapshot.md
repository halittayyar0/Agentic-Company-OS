# Browser live-state observation implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, with test-driven-development and verification-before-completion. Do not delegate this small change.

**Goal:** Prevent a reconnecting operations badge from falsely rejecting a truthful endurance run while retaining genuine false-green detection.

**Architecture:** The existing Playwright session reads a single badge snapshot and recognizes the complete existing Turkish live-worker label. The monitor retains bounded diagnostic states. No UI, backend or permission behavior changes.

**Tech Stack:** TypeScript, Node24.22.1, existing Playwright adapter and Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-03-endurance-browser-live-snapshot-design.md`

## Global constraints

Keep 100 responsibilities, seven faults, ten minute buckets, all original deadlines, false-green rejection and `verified24h:false`. Never rerun or relabel the failed actual-main producer. Keep all seven language strings and application permissions unchanged.

## Review focus

Connecting copy containing the word live; coherent attributes during a render transition; real live labels paired with disconnected/connecting transport; missing attributes; bounded diagnostic export and unchanged cleanup/reconnect/error behavior.

## Task

- [x] Extend the existing session sampler regression with the original connecting label and false-green controls; observe the failure before implementation.
- [x] Read badge attributes atomically, classify the complete live label and retain bounded backend/transport evidence, including the persistent browser manifest projection.
- [ ] Run affected monitor/driver/report and component/copy tests, script typecheck, formatting, full build and security checks as appropriate.
- [ ] Review the minimal diff; commit as Halit without coauthors, push and open a normally protected follow-up PR.
- [ ] Qualify fresh original platform/source/UI/security/runtime results, merge normally, then repeat exact actual-main/native/genuine059GUI/distribution/publication qualification. Preserve the rejected main evidence.
