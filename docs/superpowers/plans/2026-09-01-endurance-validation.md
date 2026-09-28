# 24-Hour Endurance and Failure-Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the durable runtime with a deterministic 1,440-minute simulation, multi-process PostgreSQL crash recovery, browser-visible failure evidence, and an opt-in real 24-hour soak report.

**Architecture:** A synthetic model/tool adapter produces deterministic work without provider cost or external side effects. A shared scenario engine drives virtual-minute CI simulations and wall-clock soak runs from the same seeded fault schedule. The orchestrator runs API and two worker child processes against PostgreSQL, injects failures through explicit process and adapter controls, observes public health/operations endpoints plus durable database invariants, and writes an append-only JSONL evidence journal followed by a machine-readable summary report with run metadata and assertion evidence.

**Tech Stack:** Node.js 24, TypeScript, PostgreSQL 17, Docker Compose, native child processes, Node test runner, Playwright, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-01-24-hour-agent-operations-design.md`

## Global Constraints

- Implement after durable runtime, observability, and Operations Room plans.
- Default and CI runs use synthetic adapters only; no paid provider is required.
- Synthetic tools are memory/database fixtures and cannot publish, spend, contact external parties, sign, authenticate, or mutate the host outside a run-specific temporary directory.
- Every scenario uses a seed, explicit run ID, bounded deadline, and cleanup in `finally`/signal handlers.
- Test failure preserves reports/logs but always terminates child processes and removes only resources labeled with that exact run ID.
- Never report “24h verified” from an accelerated run. Only a completed wall-clock soak can set `wallClockHours >= 24` and `verified24h: true`.
- A real 24-hour soak is manual or scheduled, not a pull-request blocking job.

---

### Task 1: Define report schema, scenario clock, and invariant evaluator

**Files:**

- Create: `scripts/src/endurance/report-schema.ts`
- Create: `scripts/src/endurance/scenario-clock.ts`
- Create: `scripts/src/endurance/invariants.ts`
- Create: `scripts/src/endurance/invariants.test.ts`
- Modify: `scripts/tsconfig.json`

**Interfaces:**

- Produces: `EnduranceReport`, `EnduranceJournalEvent`, `ScenarioClock`, `evaluateEnduranceInvariants`, JSONL journal serialization, and final JSON serialization.
- Consumes: seeded scenario metadata, persisted attempt/receipt/sample snapshots, incident observations, and monotonic timestamps.

- [ ] **Step 1: Write failing invariant tests for every acceptance criterion.**

```ts
const result = evaluateEnduranceInvariants({
  expectedResponsibilities: 14_400,
  completedResponsibilities: 14_400,
  duplicateIrreversibleReceiptKeys: [],
  staleOwnerCommits: 0,
  recoveryDurationsMs: [42_000, 93_000],
  missingIncidentIds: [],
  healthTruthMismatches: [],
});
assert.equal(result.pass, true);
```

Add negative cases for one lost responsibility, one duplicate irreversible key, a 120,001 ms recovery, a stale-owner commit, a missing incident, false-green health, missing SSE reconnect, and fewer than 1,440 sample buckets.

- [ ] **Step 2: Run the test and verify the modules are missing.**

Run: `node --import tsx --test scripts/src/endurance/invariants.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement versioned schema and pure invariant evaluation.**

```ts
export interface EnduranceReportV1 {
  schemaVersion: 1;
  runId: string;
  mode: "accelerated" | "wall_clock";
  seed: number;
  startedAt: string;
  completedAt: string;
  wallClockHours: number;
  simulatedMinutes: number;
  verified24h: boolean;
  topology: {
    api: number;
    workers: number;
    agents: number;
    database: "postgres";
  };
  injections: FaultObservation[];
  metrics: EnduranceMetrics;
  assertions: EnduranceAssertion[];
  pass: boolean;
}
```

`verified24h` is computed, never accepted as input: `mode === "wall_clock" && wallClockHours >= 24 && pass`.

- [ ] **Step 4: Run tests and scripts typecheck.**

Run: `node --import tsx --test scripts/src/endurance/invariants.test.ts`  
Run: `pnpm --filter @workspace/scripts run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add scripts/src/endurance scripts/tsconfig.json
git commit -m "test(soak): define endurance evidence schema"
```

---

### Task 2: Synthetic model and idempotent tool adapters

**Files:**

- Create: `artifacts/api-server/src/lib/testing/synthetic-completion.ts`
- Create: `artifacts/api-server/src/lib/testing/synthetic-tool.ts`
- Create: `artifacts/api-server/src/lib/testing/synthetic-fault-plan.ts`
- Create: `artifacts/api-server/src/lib/testing/synthetic-adapters.test.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/step-task.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/execute-tool.ts`
- Modify: `artifacts/api-server/src/lib/runtime-security.ts`

**Interfaces:**

- Produces: deterministic `typeof createChatCompletion`, receipt-aware tool executor, and seeded faults `timeout`, `rate_limit`, `malformed`, `unknown_outcome`, `success`.
- Consumes: `SYNTHETIC_RUNTIME_ENABLED`, `SYNTHETIC_RUNTIME_SEED`, run-scoped fault plan, and operation keys.

- [ ] **Step 1: Write failing tests for deterministic completions and safe tool semantics.**

Prove identical `(seed, taskId, attemptNumber, step)` yields identical content/usage; timeout honors abort; 429 is classified retryable; malformed output follows existing validation; an idempotent key reuses one success receipt; an unknown external outcome blocks and is never retried.

- [ ] **Step 2: Run focused tests and verify adapters are absent.**

Run: `node --import tsx --test artifacts/api-server/src/lib/testing/synthetic-adapters.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement dependency injection, not a production provider backdoor.**

`stepTask` already accepts `createCompletion`; extend the worker composition root to pass the synthetic runner only when `NODE_ENV !== "production"` or `ENDURANCE_MODE` is explicitly validated. Production startup must fail if synthetic mode is enabled. Tool adapter writes only to its run-scoped PostgreSQL fixture and returns an operation receipt; it must not call VM/browser/network integrations.

- [ ] **Step 4: Add startup-security tests for forbidden production synthetic mode and malformed seeds/plans.**

Run: `node --import tsx --test artifacts/api-server/src/lib/runtime-security.test.ts artifacts/api-server/src/lib/testing/synthetic-adapters.test.ts`  
Expected: PASS.

- [ ] **Step 5: Run existing orchestrator and tool security tests.**

Run: `node --import tsx --test artifacts/api-server/src/lib/orchestrator/step-task-rejected-tools.test.ts artifacts/api-server/src/lib/orchestrator/model-fallback.test.ts artifacts/api-server/src/lib/orchestrator/runtime-emergency-stop.test.ts artifacts/api-server/src/lib/vm/sandbox.test.ts artifacts/api-server/src/lib/vm/browser-control.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add artifacts/api-server/src/lib/testing artifacts/api-server/src/lib/orchestrator/step-task.ts artifacts/api-server/src/lib/orchestrator/execute-tool.ts artifacts/api-server/src/lib/runtime-security.ts artifacts/api-server/src/lib/runtime-security.test.ts
git commit -m "test(runtime): add safe synthetic endurance adapters"
```

---

### Task 3: Accelerated 1,440-minute simulation

**Files:**

- Create: `scripts/src/endurance/accelerated-simulation.ts`
- Create: `scripts/src/endurance/accelerated-simulation.test.ts`
- Create: `scripts/src/run-accelerated-endurance.ts`
- Modify: `scripts/package.json`
- Modify: `package.json`

**Interfaces:**

- Produces: `runAcceleratedEndurance({ seed, minutes })` and `pnpm endurance:accelerated`.
- Consumes: virtual `ScenarioClock`, synthetic adapters, runtime transition functions, and invariant evaluator.

- [ ] **Step 1: Write a failing test for a full 1,440-bucket deterministic scenario.**

The scenario has ten agents, at least ten continuous responsibilities, handoffs, sleeping/wake cycles, six worker-loss equivalents, provider timeout, 429, malformed output, database-unavailable transition, SSE disconnect observation, and emergency stop/resume. Assert 1,440 unique ordered health buckets and a byte-identical normalized report for the same seed.

- [ ] **Step 2: Run the test and verify the simulation is missing.**

Run: `node --import tsx --test scripts/src/endurance/accelerated-simulation.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement virtual time through injected clocks and timers.**

Do not monkey-patch global `Date` or wait wall-clock minutes. Advance due-work scan, lease expiry, heartbeat, recovery, and sample boundaries through explicit clock dependencies. Each virtual minute must exercise the same state-transition functions as the real worker.

- [ ] **Step 4: Write reports to an explicit output path and default to a temp directory.**

CLI arguments: `--seed`, `--minutes` (fixed to at least 1,440 for pass), `--output`. Reject unknown args and existing output unless `--overwrite` is explicitly supplied. Test output is removed in cleanup; repository runs may store under ignored `artifacts/endurance-reports/`.

- [ ] **Step 5: Run simulation twice and compare normalized reports.**

Run: `pnpm endurance:accelerated -- --seed 240901 --output artifacts/endurance-reports/accelerated-a.json`  
Run: `pnpm endurance:accelerated -- --seed 240901 --output artifacts/endurance-reports/accelerated-b.json`  
Run: `node --import tsx scripts/src/endurance/compare-reports.ts artifacts/endurance-reports/accelerated-a.json artifacts/endurance-reports/accelerated-b.json --ignore startedAt,completedAt,runId`  
Expected: PASS, `simulatedMinutes: 1440`, `verified24h: false`.

- [ ] **Step 6: Run focused/full tests and commit.**

Run: `node --import tsx --test scripts/src/endurance/accelerated-simulation.test.ts scripts/src/endurance/invariants.test.ts`  
Run: `pnpm --filter @workspace/scripts run typecheck`  
Expected: PASS.

```bash
git add scripts/src/endurance scripts/src/run-accelerated-endurance.ts scripts/package.json package.json
git commit -m "test(soak): simulate 1440 durable minutes"
```

---

### Task 4: PostgreSQL multi-process topology harness

**Files:**

- Create: `scripts/src/endurance/process-supervisor.ts`
- Create: `scripts/src/endurance/postgres-harness.ts`
- Create: `scripts/src/endurance/runtime-probe.ts`
- Create: `scripts/src/endurance/postgres-harness.test.ts`
- Create: `compose.soak.yaml`
- Modify: `.gitignore`

**Interfaces:**

- Produces: run-scoped PostgreSQL/API/worker topology, child lifecycle controls, readiness probes, SQL evidence snapshots, and deterministic teardown.
- Consumes: built API `api` and `worker` entries, `RUNTIME_ROLE`, one labeled PostgreSQL database, and randomized loopback ports.

- [ ] **Step 1: Write failing harness tests using stub child processes.**

Cover startup deadline, API readiness before workload, exactly two worker IDs, API-only instance never claiming, worker kill by exact PID/container label, log capture, SIGTERM drain, SIGKILL deadline fallback, partial-start cleanup, and idempotent teardown.

- [ ] **Step 2: Run the test and verify supervisor modules are absent.**

Run: `node --import tsx --test scripts/src/endurance/postgres-harness.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement run-scoped resource ownership.**

Every spawned process/container receives `ENDURANCE_RUN_ID`; Compose resources use project name `agentic-os-soak-<runId>` and labels. Cleanup first verifies the exact run ID, then removes only that project’s containers/network/volume. Never enumerate resources in one shell and delete them in another.

- [ ] **Step 4: Add a topology overlay.**

`compose.soak.yaml` defines `db`, one `api` with `RUNTIME_ROLE=api`, and `worker-a`/`worker-b` with `RUNTIME_ROLE=worker`, scheduler/runtime intervals from the production defaults, synthetic mode, loopback-only API port, read-only app filesystem, dropped capabilities, health checks, and run-specific ephemeral volumes. No provider key is required.

- [ ] **Step 5: Run the PostgreSQL integration test when Docker is available; skip with an explicit reason only when the daemon is unavailable.**

Run: `node --import tsx --test scripts/src/endurance/postgres-harness.test.ts`  
Run: `docker compose -f compose.yaml -f compose.soak.yaml config`  
Expected: PASS; config contains one API and two worker roles.

- [ ] **Step 6: Commit.**

```bash
git add scripts/src/endurance compose.soak.yaml .gitignore
git commit -m "test(soak): orchestrate postgres multi-process runtime"
```

---

### Task 5: Fault injection and durable recovery assertions

**Files:**

- Create: `scripts/src/endurance/fault-injector.ts`
- Create: `scripts/src/endurance/fault-injector.test.ts`
- Create: `scripts/src/endurance/soak-observer.ts`
- Create: `scripts/src/endurance/run-wall-clock-soak.ts`
- Create: `scripts/src/run-wall-clock-soak.ts`
- Modify: `scripts/package.json`
- Modify: `package.json`

**Interfaces:**

- Produces: scheduled worker termination, provider faults, database pause, SSE disconnect, emergency stop/resume, durable observation, and `pnpm endurance:soak`.
- Consumes: process harness, synthetic fault plan, authorized local API, operations snapshots/SSE, and report schema.

- [ ] **Step 1: Write failing unit tests for the seeded fault schedule and abort-safe cleanup.**

Six worker deaths must be distributed across the run and target only an active worker. Provider timeout/429/malformed faults target known attempt steps. Database pause is bounded below the recovery window and resumes in `finally`. SSE loss closes only the observer connection. Emergency stop uses the existing authenticated API and must be explicitly resumed.

- [ ] **Step 2: Run the test and verify injector/observer are missing.**

Run: `node --import tsx --test scripts/src/endurance/fault-injector.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement observer evidence independently from injected intent.**

An injection counts as visible only after the public operations API/SSE exposes the matching persisted incident. Recovery duration is measured from persisted detection/recovery timestamps, not from the injector’s call duration. Readiness is probed throughout and false-green intervals are recorded as assertion failures.

- [ ] **Step 4: Implement bounded CLI modes.**

Arguments: `--duration-hours` (default `24`, minimum `24` for verification), `--seed`, `--output`, `--keep-on-failure`. SIGINT/SIGTERM finalizes a failed partial report, then tears down. `--keep-on-failure` may retain logs/report/PostgreSQL volume only after printing the exact run ID and recovery command; processes still stop.

- [ ] **Step 5: Add a five-minute non-verifying smoke mode for local validation.**

Run: `pnpm endurance:soak -- --duration-hours 0.0834 --seed 240901 --output artifacts/endurance-reports/soak-smoke.json`  
Expected: exits cleanly, injects at least one worker death/provider fault/SSE reconnect, and records `verified24h: false`. This smoke never substitutes for the 24-hour gate.

- [ ] **Step 6: Run focused tests and commit.**

Run: `node --import tsx --test scripts/src/endurance/fault-injector.test.ts scripts/src/endurance/postgres-harness.test.ts scripts/src/endurance/invariants.test.ts`  
Run: `pnpm --filter @workspace/scripts run typecheck`  
Expected: PASS.

```bash
git add scripts/src/endurance scripts/src/run-wall-clock-soak.ts scripts/package.json package.json
git commit -m "test(soak): inject failures and measure recovery"
```

---

### Task 6: Browser monitor and Operations Room evidence

**Files:**

- Create: `scripts/src/endurance/browser-monitor.ts`
- Create: `tests/ui/endurance-operations.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `scripts/src/endurance/run-wall-clock-soak.ts`

**Interfaces:**

- Produces: long-lived browser sampling, SSE reconnect checks, screenshot-on-failure, and UI-visible incident correlation.
- Consumes: run-specific project ID, authorized loopback API/UI, Operations Room semantics, and observer event IDs.

- [ ] **Step 1: Add a deterministic Playwright scenario against fixture routes.**

Assert the UI transitions `live -> disconnected/stale -> reconnecting -> live`, an injected worker death appears as an amber incident, the replacement attempt advances before it resolves green, and emergency stop never renders live. Verify the event ID after reconnect exceeds the prior ID.

- [ ] **Step 2: Run the new UI spec and verify any missing behavior.**

Run: `pnpm exec playwright test tests/ui/endurance-operations.spec.ts --config playwright.config.ts`  
Expected: PASS only after Operations Room implementation.

- [ ] **Step 3: Implement the wall-clock browser monitor.**

Open the project Operations Room once, sample semantic labels and browser console/page errors every minute, perform one planned page reload after an SSE disconnect, and save screenshots only on state mismatch plus start/end checkpoints. Store paths and hashes in the report; never embed secrets or raw conversations.

- [ ] **Step 4: Add process-disconnect recovery and resource bounds.**

If Chromium exits, record an incident and restart it at most three times with backoff. Cap retained screenshots at 100 and logs at 100 MiB per process using rotation. A browser-monitor failure fails the endurance report but must not prevent runtime cleanup.

- [ ] **Step 5: Run UI and typecheck gates.**

Run: `pnpm exec playwright test tests/ui/endurance-operations.spec.ts tests/ui/project-studio.spec.ts --config playwright.config.ts`  
Run: `pnpm --filter @workspace/scripts run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add scripts/src/endurance/browser-monitor.ts scripts/src/endurance/run-wall-clock-soak.ts tests/ui/endurance-operations.spec.ts playwright.config.ts
git commit -m "test(soak): monitor operations room during endurance"
```

---

### Task 7: Manual/scheduled 24-hour workflow and report verification

**Files:**

- Create: `.github/workflows/endurance-24h.yml`
- Create: `scripts/src/endurance/verify-report.ts`
- Create: `scripts/src/endurance/verify-report.test.ts`
- Modify: `scripts/package.json`
- Modify: `README.md`
- Modify: `SECURITY.md`

**Interfaces:**

- Produces: `pnpm endurance:verify-report`, a `<report>.sha256` sidecar, manual/scheduled CI run, artifact retention, and truthful operator documentation.
- Consumes: report V1, JSONL evidence journal, expected repository commit SHA, workflow run identity, and all endurance artifacts.

- [ ] **Step 1: Write failing report-verifier tests.**

Reject schema mismatch, accelerated mode labeled verified, duration below 24 hours, wrong commit SHA, missing topology, any failed assertion, duplicate irreversible receipt, stale commit, recovery over target, missing UI evidence, missing end timestamp, truncated/invalid journal sequence, or a summary whose bytes do not match its `.sha256` sidecar. Accept only a wall-clock report satisfying every gate.

- [ ] **Step 2: Run the test and verify verifier is absent.**

Run: `node --import tsx --test scripts/src/endurance/verify-report.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement verification and provenance.**

The runner writes `gitCommit`, runner OS/Node/PostgreSQL/browser versions, workflow run ID when present, normalized configuration, and an automated sign-off record into the summary, then writes the summary SHA-256 to a separate `<report>.sha256` file. `verify-report` recomputes the hash and exits nonzero on any failed gate. This is integrity evidence and a machine-readable automated sign-off, not a cryptographic third-party signature.

- [ ] **Step 4: Add non-PR workflow triggers and fail-safe timeout.**

Workflow triggers: `workflow_dispatch` and a weekly `schedule`; never `pull_request`. Use a 27-hour job timeout, Docker service readiness, Node/pnpm lockfile install, build, migration, `pnpm endurance:soak -- --duration-hours 24`, report verification, and `if: always()` artifact upload with 30-day retention. No provider secret is required.

- [ ] **Step 5: Document exact truth labels and residual boundaries.**

README distinguishes deterministic accelerated evidence, five-minute topology smoke, and completed wall-clock 24-hour verification. SECURITY explains synthetic adapter isolation, no external actions, report contents, safe cleanup, and why PostgreSQL is mandatory. Document that passing one soak is evidence for the tested commit/topology, not a promise of perpetual faultlessness.

- [ ] **Step 6: Run workflow syntax, verifier, accelerated gate, and full repository checks.**

Run: `node --import tsx --test scripts/src/endurance/verify-report.test.ts scripts/src/endurance/invariants.test.ts`  
Run: `pnpm endurance:accelerated -- --seed 240901 --output artifacts/endurance-reports/final-accelerated.json --overwrite`  
Run: `pnpm endurance:verify-report -- artifacts/endurance-reports/final-accelerated.json --expect-mode accelerated`  
Run: `pnpm run typecheck`  
Run: `pnpm test`  
Run: `pnpm run build`  
Expected: PASS; accelerated verifier confirms evidence while leaving `verified24h: false`.

- [ ] **Step 7: Commit.**

```bash
git add .github/workflows/endurance-24h.yml scripts/src/endurance scripts/package.json README.md SECURITY.md
git commit -m "ci: add opt-in 24-hour endurance proof"
```

---

### Task 8: Current-branch release evidence

**Files:**

- Generate, do not commit by default: `artifacts/endurance-reports/final-accelerated.json`
- Generate, do not commit by default: `artifacts/endurance-reports/soak-smoke.json`
- Modify only if needed: `docs/operations/runbook.md`

**Interfaces:**

- Produces: current-commit validation evidence and a reproducible handoff for the true 24-hour job.
- Consumes: all plans and implementation in this goal.

- [ ] **Step 1: Run the accelerated 1,440-minute gate on the final commit.**

Run: `pnpm endurance:accelerated -- --seed 240901 --output artifacts/endurance-reports/final-accelerated.json --overwrite`  
Run: `pnpm endurance:verify-report -- artifacts/endurance-reports/final-accelerated.json --expect-mode accelerated`  
Expected: PASS, 1,440 samples, all invariants pass, `verified24h: false`.

- [ ] **Step 2: Run the PostgreSQL five-minute topology smoke.**

Run: `pnpm endurance:soak -- --duration-hours 0.0834 --seed 240901 --output artifacts/endurance-reports/soak-smoke.json`  
Run: `pnpm endurance:verify-report -- artifacts/endurance-reports/soak-smoke.json --expect-mode wall_clock --allow-unverified-duration`  
Expected: PASS smoke invariants, `verified24h: false`, clean resource teardown.

- [ ] **Step 3: Run all current-branch quality gates with bundled Node 24.**

Run: `pnpm run format:check`  
Run: `pnpm run security:audit`  
Run: `pnpm --filter @workspace/scripts run check:licenses`  
Run: `pnpm test`  
Run: `pnpm --filter @workspace/db run migrate`  
Run: `pnpm run build`  
Run: `pnpm run test:ui`  
Run: `pnpm --filter @workspace/scripts run check:bundle`  
Expected: PASS. Report any environment-only skipped gate explicitly.

- [ ] **Step 4: Browser-inspect the running project and global command center during a forced recovery.**

Verify runtime truth, 24-hour ring semantics, all ten agent states, queue/next wake, worker loss and measured recovery, SSE reconnect, emergency stop, global project isolation, responsive layout, keyboard navigation, reduced motion, and absence of console errors.

- [ ] **Step 5: Start the real 24-hour job only in a suitable persistent runner.**

Run: `pnpm endurance:soak -- --duration-hours 24 --seed 240901 --output artifacts/endurance-reports/wall-clock-24h.json`  
Run: `pnpm endurance:verify-report -- artifacts/endurance-reports/wall-clock-24h.json --expect-mode wall_clock`  
Expected after at least 24 wall-clock hours: `verified24h: true` only if all acceptance criteria pass. If this interactive session cannot remain alive for 24 hours, use the manual/scheduled workflow and leave the exact command plus current accelerated/smoke evidence; do not mislabel the goal complete before the real report exists.

## Completion Gate

Implementation is ready for endurance only after the deterministic 1,440-minute report, PostgreSQL multi-process smoke, fault/UI evidence, and repository gates pass. The user’s 24-hour objective is fully proven only after a current-commit wall-clock report covers at least 24 hours with zero lost responsibilities, zero duplicate irreversible receipts, zero stale-owner commits, every recoverable worker death reclaimed within 120 seconds, every injection visible in Operations Room, truthful health/SSE state, and `verified24h: true`.
