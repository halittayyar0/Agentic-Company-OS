# Wall-clock failure diagnostics implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Retain safe incomplete-cycle state at the actual final evidence boundary.

**Architecture:** The existing coordinator requests optional bounded diagnostics
before provenance only when observed completions are missing. The shared
driver reads operations and affected tasks; a narrow sanitizer freezes metadata
into the existing hashed journal. Native forwards the same abortable contract.

**Tech Stack:** TypeScript, existing Node tests and native PostgreSQL harness.

**Spec:** `docs/superpowers/specs/2026-10-09-wall-clock-failure-diagnostics-design.md`

## Global constraints

Original 100 completions/600-second CI horizon/seven faults, cadence, authority,
cleanup, verifier and first-cycle smoke semantics remain unchanged. Diagnostics
are readonly, limited to ten agents and 10,000 ms, and contain no private text.
Historical CI 99/100 cause remains unconfirmed; local 100/100 is separate evidence.

## Task 1: Complete and review the diagnostic boundary

- [x] Add coordinator RED for missing final cycle, before-provenance frozen
      state, privacy/malformed data, unavailable/aborted diagnostics and no read
      for complete work. Add shared-driver root-cycle 9 and truncation RED, plus
      native abort forwarding RED. Run and inspect intended failures.
- [x] Add `responsibility-diagnostics.ts` for the narrow metadata contract and
      sanitizer. Extend optional driver/coordinator contract, journal safe metadata
      before provenance, and bound/abort reads while preserving original failure.
- [x] Implement shared-driver exact coverage and current missing-task/receipt
      reads, root included; forward native contract. Preserve native smoke method.
- [x] Run GREEN and affected endurance/verifier/native regressions. Document
      report scope and retain actual RED/GREEN evidence. Request fresh readonly
      review and resolve findings without expanding authority or deadlines.
- [ ] Whole tests/types/build/security/bundle/codegen, freeze new source,
      publish PR46 update and require all original exact-head gates. Inspect new
      Windows diagnostics if needed; no blind old-run rerun or stale acceptance.
- [ ] Merge only after required gates; actual-main checks, original distribution
      and anonymous public v0.5 verification remain mandatory before another feature.
