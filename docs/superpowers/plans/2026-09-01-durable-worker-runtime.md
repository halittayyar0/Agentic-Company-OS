# Durable Worker Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split production scheduling from the API and make every task attempt, lease heartbeat, recovery, and side-effect receipt durable and stale-owner fenced.

**Architecture:** PostgreSQL remains the source of truth. API, worker, and combined-local processes register durable runtime identities; workers create one attempt per claimed step and renew short task/agent leases independently of model latency. Tool execution is guarded by deterministic operation receipts so retries are read-only, idempotent, or explicit at-most-once.

**Tech Stack:** Node.js 24, TypeScript 5.9, Express 5, Drizzle ORM, PostgreSQL 17/PGlite, Node test runner, pnpm 10

**Spec:** `docs/superpowers/specs/2026-09-01-24-hour-agent-operations-design.md`

## Global Constraints

- Production uses PostgreSQL; PGlite remains process-lifetime local development only.
- Runtime interruption must be visible within 15 seconds and recoverable work must be reclaimed within 120 seconds.
- Task leases default to 90,000 ms and renew every 15,000 ms; the lease must exceed four heartbeat periods.
- Existing approval, emergency-stop, browser ownership, redaction, and agent-permission invariants may not be weakened.
- A stale lease owner cannot commit a task transition, tool result, or operation receipt.
- Existing API fields remain backward compatible.

---

### Task 1: Durable runtime schema and migration

**Files:**

- Create: `lib/db/src/schema/runtime-operations.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/src/migration-0015.test.ts`
- Generate: `lib/db/src/generated-sql/0015_*.sql`
- Generate: `lib/db/src/generated-sql/meta/0015_snapshot.json`
- Modify: `lib/db/src/generated-sql/meta/_journal.json`

**Interfaces:**

- Produces: `runtimeInstancesTable`, `taskAttemptsTable`, `operationReceiptsTable`, `runtimeHealthSamplesTable` and their inferred row/insert types.
- Consumes: existing `tasksTable` and `agentsTable` foreign keys.

- [ ] **Step 1: Write a migration regression that starts from migration 0014 and asserts all four new tables, unique operation keys, task-attempt foreign keys, and runtime-state checks exist.**

```ts
test("migration 0015 adds durable runtime evidence", async () => {
  const db = await databaseAtMigration(14);
  await applyNextMigration(db);
  assert.deepEqual(
    await tableNames(db, [
      "runtime_instances",
      "task_attempts",
      "operation_receipts",
      "runtime_health_samples",
    ]),
    [
      "operation_receipts",
      "runtime_health_samples",
      "runtime_instances",
      "task_attempts",
    ],
  );
  assert.equal(
    await uniqueIndexExists(db, "operation_receipts_operation_key_unique"),
    true,
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails because migration 0015 does not exist.**

Run: `node --import tsx --test lib/db/src/migration-0015.test.ts`  
Expected: FAIL with a missing migration/table assertion.

- [ ] **Step 3: Define focused schemas with the exact enum values from the spec.**

```ts
export const runtimeInstanceRoles = ["api", "worker", "combined"] as const;
export const runtimeInstanceStates = [
  "starting",
  "healthy",
  "draining",
  "stale",
  "stopped",
] as const;
export const taskAttemptStates = [
  "claimed",
  "running",
  "succeeded",
  "retrying",
  "blocked",
  "lost",
] as const;
export const operationSideEffectClasses = [
  "read_only",
  "idempotent",
  "approval_at_most_once",
] as const;
export const operationReceiptStates = [
  "reserved",
  "running",
  "succeeded",
  "failed",
  "unknown",
] as const;
```

Use UUID text primary keys for runtime instances, attempts, and operation keys; use timestamptz for every lifecycle time; index `lastHeartbeatAt`, `taskId`, `workerInstanceId`, `state`, and health sample bucket.

- [ ] **Step 4: Generate the checked-in Drizzle migration and verify it is additive.**

Run in PowerShell:

```powershell
$env:DATABASE_URL='postgresql://schema:only@127.0.0.1:5432/schema_only'
pnpm --filter @workspace/db exec drizzle-kit generate --config ./drizzle.config.ts
```

Expected: one `0015_*.sql`, one snapshot, and one journal entry; no `DROP TABLE` or destructive column rewrite.

- [ ] **Step 5: Run migration tests and the clean migration command.**

Run: `node --import tsx --test lib/db/src/migration-0015.test.ts lib/db/src/migration-0014.test.ts`  
Run: `pnpm --filter @workspace/db run migrate`  
Expected: PASS.

- [ ] **Step 6: Commit the schema unit.**

```bash
git add lib/db/src/schema/runtime-operations.ts lib/db/src/schema/index.ts lib/db/src/migration-0015.test.ts lib/db/src/generated-sql
git commit -m "feat(runtime): persist worker attempts and receipts"
```

### Task 2: Runtime operations configuration

**Files:**

- Create: `artifacts/api-server/src/lib/runtime-operations-config.ts`
- Create: `artifacts/api-server/src/lib/runtime-operations-config.test.ts`
- Modify: `artifacts/api-server/src/lib/runtime-security.ts`
- Modify: `.env.example`

**Interfaces:**

- Produces: `RuntimeRole`, `RuntimeOperationsConfig`, `readRuntimeOperationsConfig(env?: NodeJS.ProcessEnv)`.
- Consumes: `readIntegerEnvironment` and existing strict startup preflight.

- [ ] **Step 1: Write failing tests for defaults, all three roles, invalid roles, invalid lease/heartbeat ratios, and a recovery target shorter than the lease.**

```ts
test("rejects an unsafe lease ratio", () => {
  assert.throws(
    () =>
      readRuntimeOperationsConfig({
        TASK_LEASE_MS: "60000",
        TASK_HEARTBEAT_MS: "15000",
      }),
    /TASK_LEASE_MS must be greater than four TASK_HEARTBEAT_MS periods/,
  );
});
```

- [ ] **Step 2: Run the test and verify the module is missing.**

Run: `node --import tsx --test artifacts/api-server/src/lib/runtime-operations-config.test.ts`  
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the immutable configuration object.**

```ts
export interface RuntimeOperationsConfig {
  role: "api" | "worker" | "combined";
  schedulerTickMs: number;
  taskLeaseMs: number;
  taskHeartbeatMs: number;
  runtimeHeartbeatMs: number;
  workerStaleAfterMs: number;
  recoveryTargetMs: number;
  opsSampleMs: number;
  opsSampleRetentionDays: number;
  opsSseMaxClients: number;
}
```

Defaults must exactly match section 9 of the spec. `assertRuntimeConfiguration` calls this parser so contradictory values fail before database imports.

- [ ] **Step 4: Run config and runtime-security tests.**

Run: `node --import tsx --test artifacts/api-server/src/lib/runtime-operations-config.test.ts artifacts/api-server/src/lib/runtime-security.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/api-server/src/lib/runtime-operations-config.ts artifacts/api-server/src/lib/runtime-operations-config.test.ts artifacts/api-server/src/lib/runtime-security.ts .env.example
git commit -m "feat(runtime): validate durable worker settings"
```

### Task 3: Runtime instance registry

**Files:**

- Create: `artifacts/api-server/src/lib/orchestrator/runtime-instance-registry.ts`
- Create: `artifacts/api-server/src/lib/orchestrator/runtime-instance-registry.test.ts`

**Interfaces:**

- Produces: `registerRuntimeInstance`, `heartbeatRuntimeInstance`, `markRuntimeDraining`, `markRuntimeStopped`, `markStaleRuntimeInstances`, `RuntimeInstanceHandle`.
- Consumes: `runtimeInstancesTable`, `RuntimeOperationsConfig`, hostname, PID, and build version.

- [ ] **Step 1: Write failing tests proving registration, five-second heartbeat updates, owner-matched drain/stop, and stale marking do not overwrite a newer process row.**

```ts
const handle = await registerRuntimeInstance({
  role: "worker",
  schedulerEnabled: true,
});
await heartbeatRuntimeInstance(handle);
const row = await readInstance(handle.id);
assert.equal(row.state, "healthy");
assert.ok(row.lastHeartbeatAt >= handle.startedAt);
```

- [ ] **Step 2: Run the focused test and verify missing exports.**

Run: `node --import tsx --test artifacts/api-server/src/lib/orchestrator/runtime-instance-registry.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement compare-and-set lifecycle updates and an idempotent unref'd heartbeat timer owned by the returned handle.**

```ts
export interface RuntimeInstanceHandle {
  id: string;
  startedAt: Date;
  stopHeartbeat(): Promise<void>;
}
```

Every update matches both `id` and `startedAt`. `stopHeartbeat` waits for an in-flight update and is safe to call twice.

- [ ] **Step 4: Run focused tests plus shutdown tests.**

Run: `node --import tsx --test artifacts/api-server/src/lib/orchestrator/runtime-instance-registry.test.ts artifacts/api-server/src/routes/health.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/api-server/src/lib/orchestrator/runtime-instance-registry.ts artifacts/api-server/src/lib/orchestrator/runtime-instance-registry.test.ts
git commit -m "feat(runtime): register and heartbeat worker instances"
```

### Task 4: Attempt ownership and independent lease heartbeat

**Files:**

- Create: `artifacts/api-server/src/lib/orchestrator/task-attempt-store.ts`
- Create: `artifacts/api-server/src/lib/orchestrator/task-lease-heartbeat.ts`
- Create: `artifacts/api-server/src/lib/orchestrator/task-lease-heartbeat.test.ts`
- Modify: `artifacts/api-server/src/runtime-main.ts`
- Modify: `artifacts/api-server/src/routes/approvals.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/scheduler.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/step-task.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/execute-tool.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/task-autonomy.test.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/lease-boundaries.test.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/delegation-dialogue.test.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/scheduler-accounting.test.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/step-task-rejected-tools.test.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/runtime-emergency-stop.test.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/approved-action.test.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/orchestrator-safety.test.ts`

**Interfaces:**

- Produces: `ClaimedTask`, `createTaskAttempt`, `transitionTaskAttempt`, `startTaskLeaseHeartbeat`.
- Consumes: exact task/agent lease owner and registered worker instance ID.

- [ ] **Step 1: Add tests with a delayed provider completion proving both leases and the attempt heartbeat renew while the request is still pending.**

```ts
const heartbeat = startTaskLeaseHeartbeat({
  taskId,
  agentId,
  attemptId,
  leaseOwner,
  leaseMs: 90_000,
  intervalMs: 15_000,
});
await clock.advanceByAsync(30_000);
assert.ok((await readTask(taskId)).leaseExpiresAt.getTime() > clock.now());
await heartbeat.stop();
```

- [ ] **Step 2: Add a race test proving a revoked owner cannot mark the attempt succeeded or persist a later task transition.**

Run: `node --import tsx --test artifacts/api-server/src/lib/orchestrator/task-lease-heartbeat.test.ts artifacts/api-server/src/lib/orchestrator/lease-boundaries.test.ts`  
Expected: FAIL because attempts and independent heartbeats do not exist.

- [ ] **Step 3: Make scheduler timing configuration-driven and create an attempt in the same claim transaction.**

```ts
export type ClaimedTask = Omit<Task, "leaseOwner"> & {
  leaseOwner: string;
  runtimeAttemptId: string;
  runtimeInstanceId: string;
};
```

`claimDueTasks` returns only after task, agent, and attempt rows share the same lease owner. A claim conflict rolls back all three.
The scheduler receives the registered runtime handle and validated configuration explicitly; the current combined bootstrap registers that handle before scheduler startup. Task 6 later splits the same composition contract into API and worker entry points.
Approved-action execution receives the same validated `taskLeaseMs`; its at-most-once capability lease may not use the legacy five-minute constant because unknown outcomes must enter recovery/operator reconciliation within the 120-second bound.

- [ ] **Step 4: Wrap `stepTask` in a heartbeat lifecycle and fence every success/failure cleanup with the exact lease owner and attempt ID.**

The heartbeat reports ownership loss through `assertOwned()`. Call it immediately after every provider completion, before each tool, before each activity/lifecycle write, and before each terminal transition. Provider results received after loss may be usage-accounted but cannot advance the task. The Task 3 registry remains the single five-second worker-heartbeat owner; this task's 15-second heartbeat renews task, agent, and attempt leases without creating a duplicate worker timer.

- [ ] **Step 5: Update stale recovery to mark the old attempt `lost`, release only its owner-matched agent lease, link the next attempt with `recoveryOfAttemptId`, and preserve committed continuous cadence.**

Recovery uses the durable attempt state plus a future `nextAttemptAt` as the committed continuous-cycle signal; a background heartbeat after completion must not cause a completed cadence to be mistaken for interrupted work.

- [ ] **Step 6: Run scheduler, autonomy, lease, retry, emergency-stop, and rejected-tool tests.**

Run: `node --import tsx --test artifacts/api-server/src/lib/orchestrator/task-lease-heartbeat.test.ts artifacts/api-server/src/lib/orchestrator/lease-boundaries.test.ts artifacts/api-server/src/lib/orchestrator/task-autonomy.test.ts artifacts/api-server/src/lib/orchestrator/scheduler-accounting.test.ts artifacts/api-server/src/lib/orchestrator/delegation-dialogue.test.ts artifacts/api-server/src/lib/orchestrator/runtime-emergency-stop.test.ts artifacts/api-server/src/lib/orchestrator/step-task-rejected-tools.test.ts artifacts/api-server/src/lib/orchestrator/task-retry-policy.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add artifacts/api-server/src/runtime-main.ts artifacts/api-server/src/routes/approvals.ts artifacts/api-server/src/lib/orchestrator/task-attempt-store.ts artifacts/api-server/src/lib/orchestrator/task-lease-heartbeat.ts artifacts/api-server/src/lib/orchestrator/task-lease-heartbeat.test.ts artifacts/api-server/src/lib/orchestrator/scheduler.ts artifacts/api-server/src/lib/orchestrator/step-task.ts artifacts/api-server/src/lib/orchestrator/execute-tool.ts artifacts/api-server/src/lib/orchestrator/task-autonomy.test.ts artifacts/api-server/src/lib/orchestrator/lease-boundaries.test.ts artifacts/api-server/src/lib/orchestrator/delegation-dialogue.test.ts artifacts/api-server/src/lib/orchestrator/scheduler-accounting.test.ts artifacts/api-server/src/lib/orchestrator/step-task-rejected-tools.test.ts artifacts/api-server/src/lib/orchestrator/runtime-emergency-stop.test.ts artifacts/api-server/src/lib/orchestrator/approved-action.test.ts artifacts/api-server/src/lib/orchestrator/orchestrator-safety.test.ts
git commit -m "feat(runtime): heartbeat and fence durable task attempts"
```

### Task 5: Operation receipts and replay policy

**Files:**

- Modify: `lib/db/src/schema/runtime-operations.ts`
- Modify: `lib/db/src/schema/tasks.ts`
- Modify: `lib/db/src/schema/approval-requests.ts`
- Modify: `lib/db/src/schema/messages.ts`
- Create: `lib/db/src/generated-sql/0016_*.sql`
- Modify: `lib/db/src/generated-sql/meta/_journal.json`
- Create: `lib/db/src/generated-sql/meta/0016_snapshot.json`
- Create: `lib/db/src/migration-0016.test.ts`
- Create: `artifacts/api-server/src/lib/orchestrator/operation-receipts.ts`
- Create: `artifacts/api-server/src/lib/orchestrator/operation-receipts.test.ts`
- Create: `artifacts/api-server/src/lib/orchestrator/operation-receipts-crash.test.ts`
- Create: `artifacts/api-server/src/lib/orchestrator/operation-receipts-postgres.test.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/task-attempt-store.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/task-lease-heartbeat.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/scheduler.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/step-task.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/run-agent-turn.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/execute-tool.ts`
- Modify: `artifacts/api-server/src/lib/vm/browser.ts`
- Modify: `artifacts/api-server/src/lib/operator-auth.ts`
- Modify: `artifacts/api-server/src/lib/operator-auth.test.ts`
- Modify: `artifacts/api-server/src/routes/approvals.ts`
- Create: `artifacts/api-server/src/routes/operations.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/approved-action.test.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/delegation-dialogue.test.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/orchestrator-safety.test.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/runtime-emergency-stop.test.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/step-task-rejected-tools.test.ts`
- Modify: `artifacts/api-server/src/routes/company-chat.test.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Modify: generated OpenAPI/Zod/React client files produced by repository codegen
- Modify: `.env.example`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Produces: `logicalExecutionId`, `canonicalOperationKey`, `canonicalReplayKey`, `reserveOperation`, `claimOperationInvocation`, `heartbeatOperationInvocation`, `runTransactionalOperation`, `markOperationRunning`, `completeOperation`, `markOperationUnknown`, `reconcileOperation`, `invalidateApprovalBinding`, and `classifyToolSideEffect`.
- Consumes: execution kind, stable logical execution ID, physical attempt/worker/model-call evidence when present, a server-owned call slot, normalized server-resolved arguments, approval/source-message identity when applicable, browser-session affinity when applicable, the current authority/lease assertion, and a stable non-secret operator audit ID.

- [ ] **Step 1: Write failing schema/migration tests for stable logical execution identity and all three execution variants.**

Add `task_attempts.logical_execution_id`. A first claim creates it; every
`lost` or `retrying` descendant recursively inherits the recovery-chain root;
the next cycle after a succeeded attempt receives a new UUID. The migration
backfills each connected recovery chain with one root-derived ID and infers
pre-existing retry links only where the evidence is unambiguous. Seed and test
a `lost -> recovered -> recovered` chain rather than assigning each attempt its
own ID.

Refine `operation_receipts` into the logical record and add
`operation_invocations` for physical attempts. Enforce these mutually exclusive
receipt variants with foreign keys and database checks:

- `task_step`: task, agent, and origin attempt are required; approval and source
  message are forbidden;
- `approved_action`: task, agent, and approval are required; source message and
  origin attempt are forbidden;
- `chat_turn`: agent and source message are required; task is optional; approval
  and origin attempt are forbidden.

An invocation for a task step requires attempt, worker instance, and task-lease
evidence. An approved-action invocation requires worker instance and its own
lease but no task attempt. A chat invocation requires agent-lease evidence and
records the runtime instance when one is registered. Read-only receipts require
`replay_key IS NULL`; every effectful receipt requires a replay key. Enforce
state/timestamp/reconciliation consistency, foreign keys, bounded JSON/text,
and at most one active physical invocation per receipt.

Extend approved actions with an immutable browser binding captured at approval
time (`runtimeInstanceId`, browser session ID and epoch, snapshot marker, and a
binding hash) plus separate invalidation time/reason. Preserve the operator's
approved decision when the binding becomes unavailable; backlog eligibility is
`approved AND consumed_at IS NULL AND invalidated_at IS NULL`. Add
`operation_outcome_unknown` to the task blocked-reason contract.

Define the `0015 -> 0016` compatibility policy explicitly. Existing receipts
map to `task_step` and gain a physical invocation without fabricating missing
evidence or replay keys. Preserve terminal evidence. A legacy `running`
`approval_at_most_once` receipt migrates to `unknown` and blocks automatic
continuation. Migration tests cover reserved, running, and succeeded rows and
fail closed if a row cannot be represented truthfully.

Run the migration regression and verify genuine RED before generating `0016`.

- [ ] **Step 2: Write failing unit tests for canonical identity, exhaustive classification, and replay decisions.**

```ts
assert.equal(
  canonicalOperationKey(input),
  canonicalOperationKey({ ...input, args: { b: 2, a: 1 } }),
);
const first = await reserveOperation(input);
const second = await reserveOperation(input);
assert.equal(second.receipt.id, first.receipt.id);
assert.equal(second.execute, false);
```

The operation key identifies one invocation path. A separate replay key omits physical attempt/worker/model-call identity and remains stable across recovered attempts. Read-only operations have no replay key. Unknown tool names fail closed.

Reservation is insert-or-observe, not "insert and hope the unique index wins."
Concurrent requests for the same operation or replay key return the existing
receipt with `execute: false`, then verify all immutable identity fields. A
collision with different immutable fields fails closed as an integrity error;
it never leaks a raw unique-violation response.

Classification occurs only after tool-specific server normalization and live browser/sudo/approval binding:

- `read_only`: computer observe, file list/read, browser snapshot/text/wait;
- `transactional`: internal agent/task/approval/note/company-message mutations;
- `idempotent`: canonical-path file writes and deterministic receipt-key screenshots;
- `at_most_once`: generic commands and non-approval browser navigation/action;
- `approval_at_most_once`: every preapproved action, sudo, typing, approval-bound click, delete, publication, spend, or external contact.

Generic shell commands are not classified from `rm`/`del` alone. Preapproval always upgrades the class to `approval_at_most_once`.

Canonicalization is versioned and tested with a fixed corpus covering object
key order, arrays, finite numbers and negative zero, Unicode normalization,
omitted/undefined values, non-JSON rejection, canonical paths, and documented
case-sensitive versus case-insensitive fields. Tool-specific normalization
precedes hashing.

- [ ] **Step 3: Write and run PostgreSQL race tests, then capture genuine RED.**

Use two independent connections to prove same-key reservation convergence,
single active invocation claim, stale invocation recovery, exact browser-bound
approved-action affinity, and same-versus-opposite reconciliation races. The
canonical lock order is:

`runtime_controls -> runtime_instances -> agents -> approval_requests -> tasks -> task_attempts -> operation_receipts -> operation_invocations`.

Run: `node --import tsx --test lib/db/src/migration-0016.test.ts artifacts/api-server/src/lib/orchestrator/operation-receipts.test.ts artifacts/api-server/src/lib/orchestrator/operation-receipts-crash.test.ts artifacts/api-server/src/lib/orchestrator/operation-receipts-postgres.test.ts artifacts/api-server/src/lib/orchestrator/approved-action.test.ts`

Expected: FAIL. The disposable PostgreSQL suite may print an explicit local
skip only when no PostgreSQL target or container runtime exists; CI provisions
PostgreSQL and treats any skip as failure.

- [ ] **Step 4: Implement logical receipt reservation and physical invocation history.**

Use canonical JSON and a versioned SHA-256 envelope. The logical receipt key must never depend on a physical attempt alone. Persist each physical execution separately with lease owner, worker, model tool-call, heartbeat/effect-start/finish timestamps, and bounded failure metadata. Raw command text, browser input/page text, file content, secrets, prompts, and model output may not enter receipt result data.

Claim and renew invocation ownership with the enclosing task/agent heartbeat.
Recovery may reclaim only a pre-effect invocation whose owner and runtime are
both stale under the canonical locks. A stale `running` idempotent invocation
continues with the same key. A stale at-most-once invocation that crossed the
effect boundary becomes `unknown` instead of being reclaimed.

- [ ] **Step 5: Integrate at the normalized effect boundary, not as a generic outer wrapper.**

The order is: parse JSON; verify emergency/agent/permission/lease; normalize the specific tool and resolve server-owned bindings; validate approval capability; classify; reserve; reassert immediately before effect.

Transactional domain mutation and receipt success commit in the same database transaction. External operations first commit `running + effectStartedAt`, execute once, then finalize with bounded retry. A crash before effect start is reclaimable. A running idempotent operation retries with the same key. A running at-most-once or approval-at-most-once operation becomes `unknown` and blocks automatic replay. A succeeded receipt returns its saved safe envelope without repeating the effect. Read-only tools re-execute and do not persist raw file/page content; saved envelopes are bounded and explicitly allowlisted per tool class.

Thread a deterministic server-owned call slot and model tool-call evidence from `stepTask` and `runAgentTurn`. Taskless chat uses the persisted user message ID as `chat:<messageId>`; document that cross-request exactly-once requires a client turn id and is not claimed by this layer.

If any invocation returns a local or persisted `unknown`, stop the current tool
batch immediately and skip every later provider/tool call. Atomically block the
owning task/attempt where one exists and return the receipt ID. If finalization
cannot reach the database, return a truthful local unknown immediately;
recovery later converts the persisted running invocation to unknown.

- [ ] **Step 6: Make approved actions worker-owned and crash truthful.**

Approval resolution atomically reserves its logical receipt but does not execute the external effect in the HTTP request. The worker backlog may claim only the exact healthy runtime instance whose browser session/epoch/snapshot binding was persisted with the approval. Immediately before the same transaction that marks receipt/invocation running, consumes the approval, and scrubs the sensitive payload, re-read and verify that exact live binding and hash. A missing, changed, draining, or stale binding atomically records `binding_unavailable/reapproval_required`, scrubs the payload, leaves the original approved decision intact but non-consumable, and requires a new approval. It must never auto-create a browser, navigate, rebind, or hand the action to another instance.

Before the effect boundary the action is safely reclaimable by its exact bound
instance; after it, ambiguity is `unknown` and never queued/retried. Remove any
fallback that consumes a general approved row outside this server-held path.
Prove the contract with two runtime instances and a session-epoch change.

- [ ] **Step 7: Block unresolved unknown work before another model call and expose reconciliation.**

Before provider execution, recovery checks the same logical execution for unresolved `unknown`. Scheduled tasks become `blocked/operation_outcome_unknown`; approved actions become `approval_outcome_unknown`. A taskless chat request receives a truthful non-replay response and creates Ops-visible orphan-unknown evidence only when persistence is available; this layer does not promise a post-crash chat reply without a client turn ID and resumable delivery state. Extend `ToolExecutionResult.toolOutcome` with `unknown` and include a receipt ID.

Add authenticated `POST /api/ops/receipts/:receiptId/reconcile` with `confirmed_applied | confirmed_not_applied` and a mandatory bounded audit note. Persist a stable non-secret operator audit ID (configured `OPERATOR_AUDIT_ID`, never a token or cookie value). Reconciliation is allowed only from `unknown`, uses one compare-and-set transaction, and records immutable decision, note, actor, and time together with the activity event and owning task/approval disposition. Repeating the same decision is idempotent; an opposite or concurrent decision returns `409`.

`confirmed_applied` records durable "effect already happened" evidence that is injected into the next owning-task prompt and prevents re-proposal or re-execution. `confirmed_not_applied` closes the old receipt but never reuses it; a later attempt requires a new logical execution and, for approval-bound work, a new approval.

- [ ] **Step 8: Add deterministic crash-window and compatibility coverage.**

Cover reserve-before-effect, transactional rollback, same-key concurrent reservation, idempotent replay, effect-finished-before-finalize, recursive recovery-chain dedupe, invocation heartbeat/reclaim, browser-session affinity loss, approved capability consumption, taskless-chat truthfulness, safe saved-result replay, reconciliation authorization/audit/CAS, continuation evidence, emergency stop, and stale-owner fences. Explicitly prove zero duplicate irreversible effects and zero later tool calls after unknown.

- [ ] **Step 9: Run operation, approval, chat, audit-redaction, emergency-stop, and orchestrator safety tests.**

Run: `node --import tsx --test lib/db/src/migration-0016.test.ts artifacts/api-server/src/lib/orchestrator/operation-receipts.test.ts artifacts/api-server/src/lib/orchestrator/operation-receipts-crash.test.ts artifacts/api-server/src/lib/orchestrator/operation-receipts-postgres.test.ts artifacts/api-server/src/lib/orchestrator/approved-action.test.ts artifacts/api-server/src/lib/orchestrator/delegation-dialogue.test.ts artifacts/api-server/src/lib/orchestrator/orchestrator-safety.test.ts artifacts/api-server/src/lib/orchestrator/runtime-emergency-stop.test.ts artifacts/api-server/src/lib/orchestrator/step-task-rejected-tools.test.ts artifacts/api-server/src/routes/company-chat.test.ts artifacts/api-server/src/lib/operator-auth.test.ts artifacts/api-server/src/lib/audit-redaction.test.ts`

Expected: PASS.

- [ ] **Step 10: Run codegen, typecheck, full suite, build, format, migration, and clean-checkout gates; then commit.**

```bash
git add <only the exact Task 5 schema, migration, runtime, route, generated-contract, and test files actually changed>
git commit -m "feat(runtime): fence tool replay with operation receipts"
```

### Task 6: API/worker process split and production topology

**Files:**

- Create: `artifacts/api-server/src/lib/provider-bootstrap.ts`
- Create: `artifacts/api-server/src/worker-entry.ts`
- Create: `artifacts/api-server/src/worker-main.ts`
- Create: `artifacts/api-server/start-worker.mjs`
- Create: `artifacts/api-server/src/worker-main.test.ts`
- Modify: `artifacts/api-server/src/runtime-main.ts`
- Modify: `artifacts/api-server/src/index.ts`
- Modify: `artifacts/api-server/build.mjs`
- Modify: `artifacts/api-server/package.json`
- Modify: `Dockerfile`
- Modify: `compose.yaml`

**Interfaces:**

- Produces: production `api` and `worker` entry points; shared `initializeProviders()`.
- Consumes: runtime registry, scheduler, emergency-stop monitor, database readiness, and graceful drain.

- [ ] **Step 1: Write failing bootstrap tests proving `api` never claims when role is API, `worker` opens no HTTP listener, and `combined` retains local behavior.**

```ts
assert.deepEqual(await planRuntimeRole("api"), {
  listenHttp: true,
  runScheduler: false,
});
assert.deepEqual(await planRuntimeRole("worker"), {
  listenHttp: false,
  runScheduler: true,
});
```

- [ ] **Step 2: Run the test and verify the worker entry point is absent.**

Run: `node --import tsx --test artifacts/api-server/src/worker-main.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Extract provider initialization and implement worker startup/drain without importing Express.**

Worker startup order: preflight, providers, DB/migrations, runtime registration, recovery, model catalog, emergency monitor, scheduler, health sampler. Shutdown order: draining state, stop claims, finish/expire in-flight work to deadline, monitor stop, stopped state, database close.

- [ ] **Step 4: Build both `dist/index.mjs` and `dist/worker-entry.mjs`; package `start:worker`.**

- [ ] **Step 5: Update Compose to one `app` with `RUNTIME_ROLE=api` and two workers with `RUNTIME_ROLE=worker`, shared secrets/database/workspaces, `restart: unless-stopped`, and no published worker ports.**

- [ ] **Step 6: Run focused tests, API build, and production topology configuration validation.**

Run: `node --import tsx --test artifacts/api-server/src/worker-main.test.ts artifacts/api-server/src/routes/health.test.ts artifacts/api-server/src/lib/runtime-security.test.ts`  
Run: `pnpm --filter @workspace/api-server run build`  
Run: `docker compose config` when Docker is available; otherwise rely on CI and report the local limitation.  
Expected: PASS and both bundle entry points present.

- [ ] **Step 7: Commit.**

```bash
git add artifacts/api-server/src/lib/provider-bootstrap.ts artifacts/api-server/src/worker-entry.ts artifacts/api-server/src/worker-main.ts artifacts/api-server/start-worker.mjs artifacts/api-server/src/worker-main.test.ts artifacts/api-server/src/runtime-main.ts artifacts/api-server/src/index.ts artifacts/api-server/build.mjs artifacts/api-server/package.json Dockerfile compose.yaml
git commit -m "feat(runtime): split API and durable worker roles"
```

### Task 7: Runtime documentation and regression gate

**Files:**

- Modify: `README.md`
- Modify: `README.tr.md`
- Modify: `docs/architecture.md`
- Modify: `docs/runtime-safety-invariants.md`
- Modify: `docs/self-hosting.md`
- Modify: `docs/roadmap.md`

**Interfaces:**

- Produces: exact operator guidance matching shipped topology and residual limits.
- Consumes: implemented configuration defaults and test commands.

- [ ] **Step 1: Update diagrams, environment tables, startup/shutdown order, PGlite warning, lease protocol, operation receipt semantics, and two-worker Compose instructions.**

- [ ] **Step 2: Run runtime-focused and full static gates.**

Run: `pnpm run typecheck`  
Run: `pnpm run build`  
Run: `pnpm test`  
Run: `pnpm run format:check`  
Run: `git diff --check`  
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add README.md README.tr.md docs/architecture.md docs/runtime-safety-invariants.md docs/self-hosting.md docs/roadmap.md
git commit -m "docs: explain durable worker operations"
```
