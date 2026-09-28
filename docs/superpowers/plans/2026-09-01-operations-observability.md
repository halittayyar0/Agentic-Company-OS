# Operations Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose truthful global and project operational state, reconnectable live delivery, minute health samples, and privacy-minimized OpenTelemetry signals.

**Architecture:** Durable PostgreSQL rows are projected into bounded operational snapshots. An authenticated SSE route streams snapshot/event deltas by durable event ID and reconnects with `Last-Event-ID`; UI truth never depends on process-local event memory. Optional OTLP export mirrors allowlisted spans and metrics without becoming a product dependency.

**Tech Stack:** Express 5, Drizzle ORM, OpenAPI 3.1, Orval, Zod, Server-Sent Events, OpenTelemetry JS, Node.js 24

**Spec:** `docs/superpowers/specs/2026-09-01-24-hour-agent-operations-design.md`

## Global Constraints

- Implement after `2026-09-01-durable-worker-runtime.md` so runtime instances, attempts, receipts, and samples exist.
- “Live”, “healthy”, “degraded”, “stale”, and “offline” are derived from current persisted timestamps and configuration.
- SSE is authenticated, bounded to 100 clients per API process by default, resumable, and timer-clean.
- Prompt text, model output, raw command/form input, secrets, and raw tool output never enter operational responses or OTLP attributes.
- The product works fully when OTLP and Langfuse are absent.

---

### Task 1: Pure operational state derivation

**Files:**

- Create: `artifacts/api-server/src/lib/operations/operations-state.ts`
- Create: `artifacts/api-server/src/lib/operations/operations-state.test.ts`

**Interfaces:**

- Produces: `deriveRuntimeTruth`, `deriveAgentPresence`, `deriveProjectHealth`, and their discriminated-union types.
- Consumes: timestamps, runtime configuration, task/attempt states, and provider activity aggregates.

- [ ] **Step 1: Write table-driven failing tests for local-demo, live, degraded, stale, recovering, emergency-stopped, and offline states.**

```ts
assert.deepEqual(
  deriveRuntimeTruth({
    databaseBackend: "pglite",
    schedulerEnabled: false,
    connected: true,
    newestWorkerHeartbeatAt: null,
    now,
    workerStaleAfterMs: 15_000,
  }),
  {
    state: "local_demo",
    label: "Yerel demo · scheduler kapalı",
    live: false,
  },
);
```

- [ ] **Step 2: Run the test and verify missing derivation functions.**

Run: `node --import tsx --test artifacts/api-server/src/lib/operations/operations-state.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement exhaustive switch-based derivation without reading the database.**

```ts
export type RuntimeTruthState =
  | "live"
  | "degraded"
  | "stale"
  | "offline"
  | "emergency_stopped"
  | "local_demo";
```

Agent presence states are `working`, `queued`, `sleeping`, `awaiting_approval`, `recovering`, `blocked`, and `offline`.

- [ ] **Step 4: Run focused tests and typecheck.**

Run: `node --import tsx --test artifacts/api-server/src/lib/operations/operations-state.test.ts`  
Run: `pnpm --filter @workspace/api-server run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/api-server/src/lib/operations/operations-state.ts artifacts/api-server/src/lib/operations/operations-state.test.ts
git commit -m "feat(ops): derive truthful runtime states"
```

### Task 2: Global and project read models

**Files:**

- Create: `artifacts/api-server/src/lib/operations/operations-read-model.ts`
- Create: `artifacts/api-server/src/lib/operations/operations-read-model.test.ts`

**Interfaces:**

- Produces: `getOperationsOverview(input)`, `getProjectOperations(taskId, input)`, `OperationsOverview`, `ProjectOperationsSnapshot`.
- Consumes: runtime instance, task attempt, operation receipt, operation invocation, health sample, task, agent, activity, and usage tables.

- [ ] **Step 1: Write failing fixtures proving snapshots are project-scoped, bounded, ordered, attempt/receipt/invocation-linked, and redact operation details.**

```ts
const snapshot = await getProjectOperations(projectA.id, {
  now,
  windowHours: 24,
});
assert.deepEqual(
  snapshot.agents.map((agent) => agent.agentId),
  [1, 2, 3],
);
assert.equal(
  snapshot.incidents.some((incident) => incident.taskId === projectB.id),
  false,
);
assert.equal(JSON.stringify(snapshot).includes("secret-command"), false);
assert.equal(snapshot.attempts[0].id, snapshot.receipts[0].originAttemptId);
assert.equal(
  snapshot.receipts[0].invocations[0].receiptId,
  snapshot.receipts[0].id,
);
```

- [ ] **Step 2: Run the test and verify missing read models.**

Run: `node --import tsx --test artifacts/api-server/src/lib/operations/operations-read-model.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement bounded queries and stable response types.**

```ts
export async function getProjectOperations(
  taskId: number,
  input: { now?: Date; windowHours?: number },
): Promise<ProjectOperationsSnapshot>;
```

Return at most 200 attempts, their bounded/redacted receipt and invocation projections, 100 incidents, 100 milestones, 1,440 minute samples, and all project members. Include explicit window start/end, timezone, per-collection limit, truncation/next-cursor metadata, and reconciliation eligibility without leaking command text or raw results. Calculate oldest due age, next wake-up, recovery duration, usage totals, and worker truth server-side.

- [ ] **Step 4: Run project-members, pagination, audit-redaction, and read-model tests.**

Run: `node --import tsx --test artifacts/api-server/src/lib/operations/operations-read-model.test.ts artifacts/api-server/src/routes/tasks.project-members.test.ts artifacts/api-server/src/routes/pagination.test.ts artifacts/api-server/src/lib/audit-redaction.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/api-server/src/lib/operations/operations-read-model.ts artifacts/api-server/src/lib/operations/operations-read-model.test.ts
git commit -m "feat(ops): build project and fleet read models"
```

### Task 3: Minute health sampler

**Files:**

- Create: `artifacts/api-server/src/lib/operations/operations-sampler.ts`
- Create: `artifacts/api-server/src/lib/operations/operations-sampler.test.ts`
- Modify: `artifacts/api-server/src/worker-main.ts`

**Interfaces:**

- Produces: `sampleOperationsHealth`, `startOperationsSampler`, `stopOperationsSampler`.
- Consumes: operational read queries, `OPS_SAMPLE_MS`, retention days, and worker lifecycle.

- [ ] **Step 1: Write failing tests for minute bucket upsert, two-worker contention, retention deletion, and idempotent stop.**

```ts
await Promise.all([
  sampleOperationsHealth({ now }),
  sampleOperationsHealth({ now }),
]);
assert.equal((await samplesForBucket(floorMinute(now))).length, 1);
```

- [ ] **Step 2: Run and verify the sampler is missing.**

Run: `node --import tsx --test artifacts/api-server/src/lib/operations/operations-sampler.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement aggregate-upsert sampling with one row per UTC minute and bounded retention cleanup.**

The timer is unref'd, serialized against overlapping samples, starts only in worker/combined roles, and completes or times out during drain.

- [ ] **Step 4: Run sampler and worker lifecycle tests.**

Run: `node --import tsx --test artifacts/api-server/src/lib/operations/operations-sampler.test.ts artifacts/api-server/src/worker-main.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/api-server/src/lib/operations/operations-sampler.ts artifacts/api-server/src/lib/operations/operations-sampler.test.ts artifacts/api-server/src/worker-main.ts
git commit -m "feat(ops): persist minute health samples"
```

### Task 4: OpenAPI contracts and snapshot routes

**Files:**

- Modify: `lib/api-spec/openapi.yaml`
- Create: `artifacts/api-server/src/routes/operations.ts`
- Create: `artifacts/api-server/src/routes/operations.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Generate: `lib/api-client-react/src/generated/*`
- Generate: `lib/api-zod/src/generated/*`
- Modify: `lib/api-zod/src/index.ts`

**Interfaces:**

- Produces: `GET /api/ops/overview`, `GET /api/ops/instances`, `GET /api/tasks/{taskId}/operations` and generated React/Zod contracts while preserving the existing receipt-reconciliation contract.
- Consumes: operations read model, generated reconciliation types, and standard numeric path/UUID receipt validation.

- [ ] **Step 1: Write failing route tests for success, missing project 404, invalid ID 400, authentication/authorization, bounded query parameters, exact attempt receipt projections, and reconciliation contract preservation.**

```ts
assert.equal(
  (await request(app).get(`/api/tasks/${project.id}/operations`)).status,
  200,
);
assert.equal(
  (await request(app).get("/api/tasks/not-a-number/operations")).status,
  400,
);
assert.equal(
  (await request(app).get("/api/tasks/999999/operations")).status,
  404,
);
```

- [ ] **Step 2: Run routes and verify 404/missing schemas.**

Run: `node --import tsx --test artifacts/api-server/src/routes/operations.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Add explicit OpenAPI schemas using discriminated string enums and ISO timestamps, then implement routes with generated Zod validation.**

- [ ] **Step 4: Generate clients and prove generation is deterministic.**

Run: `pnpm --filter @workspace/api-spec run codegen`  
Run: `git diff --check -- lib/api-client-react/src/generated lib/api-zod/src/generated lib/api-zod/src/index.ts`  
Expected: generated APIs expose `useGetOperationsOverview`, `useGetProjectOperations`, and `useGetOperationsInstances`.

- [ ] **Step 5: Run route tests and API typecheck.**

Run: `node --import tsx --test artifacts/api-server/src/routes/operations.test.ts`  
Run: `pnpm --filter @workspace/api-server run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/api-spec/openapi.yaml artifacts/api-server/src/routes/operations.ts artifacts/api-server/src/routes/operations.test.ts artifacts/api-server/src/routes/index.ts lib/api-client-react/src/generated lib/api-zod/src/generated lib/api-zod/src/index.ts
git commit -m "feat(ops): expose operational snapshots"
```

### Task 5: Reconnectable authenticated SSE

**Files:**

- Create: `artifacts/api-server/src/lib/operations/operations-stream.ts`
- Create: `artifacts/api-server/src/lib/operations/operations-stream.test.ts`
- Modify: `artifacts/api-server/src/routes/operations.ts`
- Modify: `lib/api-spec/openapi.yaml`

**Interfaces:**

- Produces: `createOperationsEventStream`, `GET /api/ops/stream?taskId=`, event types `snapshot`, `activity`, `attempt`, `receipt`, `incident`, `heartbeat`.
- Consumes: canonical decimal `activity_events.id` cursors, project scope, auth middleware, and SSE client capacity. Operational state transitions append their redacted activity invalidation event with the durable mutation.

- [ ] **Step 1: Write failing tests for content type, immediate snapshot, decimal monotonic IDs, invalid/unknown/future `Last-Event-ID`, replay without gaps or cross-project leakage, browser-visible heartbeat without an ID, long-idle connection liveness, project isolation, capacity 503, and timer cleanup after abort.**

```ts
assert.match(response.headers["content-type"], /^text\/event-stream/);
assert.match(firstFrame, /event: snapshot/);
assert.match(firstFrame, /id: \d+/);
```

- [ ] **Step 2: Run the test and verify the stream route is absent.**

Run: `node --import tsx --test artifacts/api-server/src/lib/operations/operations-stream.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement a bounded per-connection durable-event poller.**

Use `activity_events.id` as the one canonical cursor, encode it as base-10 digits, and treat the row as an invalidation/evidence signal before rebuilding the bounded source-table snapshot. Use `retry: 3000`, one-second durable delta checks, and an `AbortSignal` cleanup path. Every 10 seconds emit `event: heartbeat` with bounded JSON time/runtime truth and no `id`; SSE comments may additionally keep intermediaries open but are not client liveness evidence because browser JavaScript cannot observe them. Never hold a transaction open between frames. Reject a new client with 503 and `Retry-After` when the configured per-process limit is reached.

- [ ] **Step 4: Add OpenAPI `text/event-stream` documentation without generating a fake JSON hook for EventSource.**

- [ ] **Step 5: Run stream, auth, rate-limit, and app security tests.**

Run: `node --import tsx --test artifacts/api-server/src/lib/operations/operations-stream.test.ts artifacts/api-server/src/lib/operator-auth.test.ts artifacts/api-server/src/app.security.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add artifacts/api-server/src/lib/operations/operations-stream.ts artifacts/api-server/src/lib/operations/operations-stream.test.ts artifacts/api-server/src/routes/operations.ts lib/api-spec/openapi.yaml
git commit -m "feat(ops): stream durable operational events"
```

### Task 6: Privacy-minimized OpenTelemetry

**Files:**

- Create: `artifacts/api-server/src/lib/telemetry/telemetry.ts`
- Create: `artifacts/api-server/src/lib/telemetry/telemetry-policy.ts`
- Create: `artifacts/api-server/src/lib/telemetry/telemetry-policy.test.ts`
- Modify: `artifacts/api-server/src/lib/provider-bootstrap.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/scheduler.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/step-task.ts`
- Modify: `artifacts/api-server/src/lib/orchestrator/operation-receipts.ts`
- Modify: `artifacts/api-server/src/runtime-main.ts`
- Modify: `artifacts/api-server/src/worker-main.ts`
- Modify: `artifacts/api-server/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces: `initializeTelemetry`, `shutdownTelemetry`, `withSpan`, allowlisted `safeTelemetryAttributes`.
- Consumes: optional `OTEL_EXPORTER_OTLP_ENDPOINT` and non-secret runtime IDs/statuses.

- [ ] **Step 1: Write failing policy tests that reject prompt, content, command, arguments, output, headers, API key, URL query, and cookie attributes while allowing IDs, enums, durations, counts, model ID, and provider.**

```ts
assert.deepEqual(
  safeTelemetryAttributes({
    taskId: 1,
    provider: "openrouter",
    prompt: "private",
    command: "secret",
  }),
  { "agentic.task.id": 1, "gen_ai.provider.name": "openrouter" },
);
```

- [ ] **Step 2: Run the policy test and verify missing telemetry.**

Run: `node --import tsx --test artifacts/api-server/src/lib/telemetry/telemetry-policy.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Add pinned OpenTelemetry API/SDK/OTLP HTTP packages and implement no-op-by-default initialization.**

Initialize before provider/database work. Export traces and metrics only when an endpoint is present. Flush with a bounded deadline during API and worker shutdown.

- [ ] **Step 4: Instrument scheduler tick, claim, attempt, provider route, lease heartbeat, tool receipt, recovery, and SSE lifecycle with allowlisted attributes only.**

- [ ] **Step 5: Run telemetry policy, logger, audit, typecheck, build, license, and dependency-audit gates.**

Run: `node --import tsx --test artifacts/api-server/src/lib/telemetry/telemetry-policy.test.ts artifacts/api-server/src/lib/logger.test.ts artifacts/api-server/src/lib/audit-redaction.test.ts`  
Run: `pnpm run typecheck`  
Run: `pnpm run build`  
Run: `pnpm --filter @workspace/scripts run check:licenses`  
Run: `pnpm run security:audit`  
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add artifacts/api-server/src/lib/telemetry artifacts/api-server/src/lib/provider-bootstrap.ts artifacts/api-server/src/lib/orchestrator/scheduler.ts artifacts/api-server/src/lib/orchestrator/step-task.ts artifacts/api-server/src/lib/orchestrator/operation-receipts.ts artifacts/api-server/src/runtime-main.ts artifacts/api-server/src/worker-main.ts artifacts/api-server/package.json pnpm-lock.yaml
git commit -m "feat(ops): export privacy-safe runtime telemetry"
```

### Task 7: Operations documentation

**Files:**

- Modify: `README.md`
- Modify: `README.tr.md`
- Modify: `docs/architecture.md`
- Modify: `docs/security-model.md`
- Modify: `docs/self-hosting.md`
- Modify: `.env.example`

**Interfaces:**

- Produces: deployable OTLP/SSE/read-model guidance and exact residual boundaries.
- Consumes: shipped endpoints, settings, and redaction policy.

- [ ] **Step 1: Document snapshot endpoints, SSE reconnection, health-sample retention, OTLP opt-in, Langfuse as optional sink, and prohibited telemetry fields.**

- [ ] **Step 2: Run full static and generated-artifact gates.**

Run: `pnpm --filter @workspace/api-spec run codegen`  
Run: `pnpm run typecheck`  
Run: `pnpm run build`  
Run: `pnpm run format:check`  
Run: `git diff --check`  
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add README.md README.tr.md docs/architecture.md docs/security-model.md docs/self-hosting.md .env.example
git commit -m "docs: describe operational telemetry"
```
