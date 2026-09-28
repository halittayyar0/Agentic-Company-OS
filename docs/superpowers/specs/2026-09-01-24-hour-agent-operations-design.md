# 24-Hour Agent Operations Design

**Status:** Approved for implementation on 1 September 2026  
**Scope:** Durable multi-agent execution, project-scoped live operations, telemetry, and endurance validation  
**Product:** Agentic Company OS

## 1. Outcome

Agentic Company OS will run project responsibilities continuously for at least
24 hours without losing work when an API process, worker process, model route,
or short database connection fails. “Continuous” means event- and
cadence-driven work that can sleep safely between cycles, not an LLM request
held open for 24 hours.

The operator will follow the team from a project-scoped Operations Room. Every
visible state must come from durable runtime evidence. A disabled scheduler,
stale worker, disconnected stream, or unavailable provider must never be
presented as live or healthy.

## 2. Reliability Contract

The production profile must satisfy all of the following:

1. A persisted responsibility survives API and worker restarts.
2. A worker crash cannot leave a task permanently owned by the dead process.
3. A lost lease prevents the stale worker from committing a later tool result
   or task transition.
4. Model calls may be repeated after a crash, but externally visible side
   effects may not be replayed blindly.
5. Existing exact, expiring, single-use approval behavior remains at-most-once.
6. Provider timeouts and rate limits use bounded retry, compatible fallback,
   and capped backoff while keeping continuous work recoverable.
7. PostgreSQL is required for the verified 24-hour production profile. PGlite
   remains an explicitly labelled, process-lifetime development profile.
8. A worker or scheduler interruption becomes visible to the operator within
   15 seconds.
9. Recoverable work is reclaimed within 120 seconds of a dead worker's last
   heartbeat.
10. The system exposes evidence for queue age, active attempts, heartbeats,
    recoveries, provider failures, tool outcomes, token use, and reported cost.

The product does not claim exactly-once arbitrary external effects, guaranteed
provider availability, or uninterrupted service during total PostgreSQL loss.
It guarantees durable responsibility, bounded recovery, explicit uncertainty,
and no unsafe automatic replay in implemented paths.

## 3. Architecture Decision

Use an OS-native durable worker architecture behind a narrow runtime boundary.
Do not rewrite the product around Temporal or LangGraph in this release.

The existing PostgreSQL task and agent leases, approval gates, provider router,
tool policies, and activity ledger already encode product-specific safety
semantics. Replacing them wholesale would enlarge the migration and regression
surface. The new boundary will allow a Temporal adapter later without coupling
the UI or domain routes to the scheduler implementation.

### 3.1 Runtime roles

- **API role:** HTTP routes, authentication, SSE delivery, browser/operator
  control, and read models. The production API does not run the scheduler.
- **Worker role:** provider initialization, durable scheduling, task stepping,
  lease heartbeats, stale-work recovery, health sampling, and graceful drain.
- **Combined local role:** current local convenience mode. It may run API and
  scheduler together but is visibly marked unverified for 24-hour operation.
- **PostgreSQL:** system of record for tasks, attempts, runtime instances,
  operation receipts, health samples, usage, and audit events.

The Compose production profile runs one API container and at least two worker
containers. `restart: unless-stopped` remains a host-level recovery aid; the
database protocols, not Docker restarts, establish correctness.

### 3.2 Runtime interface

Scheduler consumers depend on a focused interface:

```ts
export interface DurableRuntime {
  start(): Promise<void>;
  drain(reason: string): Promise<void>;
  snapshot(): Promise<RuntimeSnapshot>;
}
```

The initial implementation is `PostgresDurableRuntime`. API and UI code consume
persisted snapshots and events, never scheduler-process memory.

## 4. Durable Data Model

### 4.1 `runtime_instances`

One row per API or worker process:

- stable UUID instance ID;
- role (`api`, `worker`, `combined`);
- lifecycle (`starting`, `healthy`, `draining`, `stale`, `stopped`);
- hostname, process ID, build version, and capabilities;
- startup, last-heartbeat, drain, and stop timestamps;
- scheduler-enabled flag and last scheduler tick timestamp.

The row is updated in place every five seconds. Historical availability comes
from health samples, not an unbounded heartbeat row stream.

### 4.2 `task_attempts`

One immutable-identity row per claimed scheduler step:

- UUID attempt ID, task ID, agent ID, and worker instance ID;
- a logical execution ID that is stable across `retrying`/`lost` recovery
  attempts and new for the next successfully completed scheduler cycle;
- lease owner and attempt/cycle numbers;
- state (`claimed`, `running`, `succeeded`, `retrying`, `blocked`, `lost`);
- start, heartbeat, and finish timestamps;
- model/provider route, failure kind, sanitized error, and recovery parent;
- token and reported-cost totals for the attempt.

The task row remains the current domain state. Attempt rows provide the durable
execution history needed for recovery evidence and the Operations Room.

### 4.3 `operation_receipts` and `operation_invocations`

Receipt identity separates one logical responsibility from the physical worker
attempt that happened to execute it. A task step keeps one logical execution ID
across the complete, recursively followed `retrying`/`lost` recovery chain.
Approved actions use the stable approval ID. Taskless chat turns use the
already-persisted source message ID. Attempt, worker, and model tool-call IDs
are physical invocation evidence and are never the sole replay identity. A new
cycle after a succeeded attempt is a new logical execution.

Each logical receipt stores:

- execution kind (`task_step`, `approved_action`, `chat_turn`) and stable logical
  execution ID;
- a unique operation key and, for effectful tools, a separate unique replay
  key derived from the logical execution, normalized tool name, and canonical
  server-resolved argument hash;
- side-effect class (`read_only`, `transactional`, `idempotent`,
  `at_most_once`, `approval_at_most_once`);
- status (`reserved`, `running`, `succeeded`, `failed`, `unknown`);
- task, agent, approval, source-message, and origin-attempt references governed
  by mutually exclusive execution-kind checks;
- timestamps, reconciliation evidence, an optional external idempotency key,
  and only bounded, tool-specific, redacted result data.

Receipt variants are exact:

- `task_step` requires task, agent, and origin attempt and forbids approval and
  source message;
- `approved_action` requires task, agent, and approval and forbids source
  message and origin attempt;
- `chat_turn` requires agent and source message, permits an optional task, and
  forbids approval and origin attempt.

Read-only receipts have no replay key; every effectful receipt has one. Receipt
state, timestamps, reconciliation fields, foreign keys, and bounded JSON/text
are enforced in the database. Reservation uses an insert-or-observe protocol:
two transactions racing on the same operation/replay key converge on one
receipt and `execute: false`; a mismatch in immutable identity fields fails
closed as corruption instead of exposing a unique-index error.

Physical invocations are separate rows containing receipt, attempt/worker or
agent-lease evidence appropriate to the execution kind, model tool-call,
owner, lease expiry, heartbeat, effect-start, finish, and bounded failure
metadata. A task-step invocation requires attempt, worker, and task-lease
evidence. An approved action requires worker and invocation-lease evidence but
no task attempt. A chat turn requires agent-lease evidence and records the
runtime instance when registered. Only one invocation may be active per
receipt.

Invocation heartbeat runs with the enclosing task/agent heartbeat. Recovery
may reclaim a pre-effect invocation only after both its owner and runtime are
stale while holding locks in this order:

`runtime_controls -> runtime_instances -> agents -> approval_requests -> tasks -> task_attempts -> operation_receipts -> operation_invocations`.

Read-only operations may run again and never save raw file/page content.
Transactional domain mutations commit their receipt in the same database
transaction. Idempotent operations reuse the same external/replay key. Once an
at-most-once operation crosses the effect boundary, a crash without a committed
outcome becomes `unknown`; it is never replayed automatically. An unknown
result stops the current tool batch immediately, skips later provider/tool
calls, blocks the owning task/attempt when present, and exposes the receipt ID.
If persistence is temporarily unavailable, the caller still receives a local
unknown and recovery later classifies the durable running invocation.

Canonical argument hashing is versioned and tool-specific. The test corpus
covers object ordering, arrays, finite numbers and negative zero, Unicode
normalization, omitted/undefined and non-JSON rejection, canonical paths, and
documented case rules. Raw commands, browser input/page text, file contents,
secrets, prompts, and model output never enter receipt results.

Approved browser actions are additionally bound at approval time to the exact
runtime instance, process-local browser session ID and epoch, snapshot marker,
and a server-derived binding hash. Only that healthy instance may claim the
action. The binding is re-read immediately before the same transaction that
marks the receipt/invocation running, consumes the approval, and scrubs the
sensitive payload. A missing or changed binding invalidates the action as
`binding_unavailable/reapproval_required` without rewriting the operator's
approved decision. It must never recreate a browser, navigate, rebind, or move
the action to another instance automatically.

Migration from the legacy receipt schema preserves terminal evidence and maps
representable rows to `task_step` plus one physical invocation. It never
fabricates missing replay evidence. A legacy running approval-at-most-once row
becomes `unknown` and blocks. The migration fails closed for any row that
cannot be represented truthfully.

The runtime conservatively allows a particular normalized effect only once per
logical execution. A genuinely new repeated effect requires a new logical work
step. This may block an ambiguous duplicate rather than risk replaying it.

### 4.4 `runtime_health_samples`

One aggregated row per minute records:

- healthy/stale worker counts;
- scheduler tick age;
- due queue depth and oldest due age;
- active, sleeping, recovering, blocked, and approval-waiting task counts;
- provider success/error counts and latency percentiles;
- recoveries and lost-lease events;
- task-attributed tokens and provider-reported cost.

Samples are bounded by configurable retention. They power the 24-hour health
ring without exposing prompts, raw commands, browser form content, or chain of
thought.

## 5. Lease and Recovery Protocol

1. A worker transactionally claims the agent and task, then creates a
   `task_attempts` row with the same lease owner.
2. A task-step lease defaults to 90 seconds.
3. An independent heartbeat renews the task, agent, attempt, and worker every
   15 seconds while a model or tool call is in flight.
4. Each transition and each tool execution revalidates the exact lease owner.
5. Three consecutive heartbeat failures stop new tool execution. The current
   provider request may finish, but its result cannot advance the task until
   ownership is revalidated.
6. Recovery marks the dead attempt `lost`, releases matching agent ownership,
   increments task recovery count, and queues a new attempt.
7. A completed continuous cycle retains its future cadence and is not mistaken
   for interrupted work.
8. Graceful drain stops claims, keeps heartbeats alive for in-flight attempts,
   waits to a deadline, and releases only owner-matching leases.

## 6. Observability and Live Delivery

### 6.1 Native operational read model

The API exposes:

- `GET /api/ops/overview` for global runtime truth;
- `GET /api/tasks/:taskId/operations` for project state, agent presence,
  attempts, queue timing, incidents, milestones, and the 24-hour window;
- `GET /api/ops/instances` for worker/API lifecycle;
- `GET /api/ops/stream?taskId=:taskId` as an authenticated SSE stream.
- `POST /api/ops/receipts/:receiptId/reconcile` for an authenticated operator to
  record `confirmed_applied` or `confirmed_not_applied` with an audit note.

Reconciliation accepts only `unknown` receipts and uses one compare-and-set
transaction for immutable decision, bounded note, stable non-secret operator
audit ID, timestamp, owning task/approval disposition, and redacted activity
event. Repeating the same decision is idempotent; an opposite or concurrent
decision returns `409`. A token, bearer value, or session cookie is never stored
as the actor ID. `confirmed_applied` adds durable "effect already happened"
evidence to the next owning-task prompt and prevents re-proposal/re-execution.
`confirmed_not_applied` closes the old receipt, but any future execution is a
new logical responsibility and an approval-bound effect requires a new
approval.

The SSE cursor is the canonical base-10 `activity_events.id` sequence. Every
attempt, incident, receipt, recovery, runtime-control, and reconciliation
transition that changes the operational read model appends a redacted activity
event in the same transaction as its durable state change when that state change
is transactional. The stream uses that event only as an invalidation/evidence
cursor and rebuilds bounded snapshots from source tables; it never treats
process-local memory as truth.

The SSE route queries durable event IDs and snapshots, so reconnecting clients
resume with `Last-Event-ID`. It validates that header as a canonical decimal,
sends a browser-visible `event: heartbeat` frame without an `id`, caps client
count, cleans up timers on disconnect, and
falls back to explicit stale/disconnected UI state. Multi-replica correctness
does not depend on an in-process event bus.

### 6.2 OpenTelemetry

Server-only OpenTelemetry instrumentation emits traces and metrics for:

- scheduler ticks and claim latency;
- task attempts and lease renewal;
- model route attempts, fallback, latency, and usage;
- tool reservation and completion;
- recovery and approval transitions;
- API request/SSE lifecycle.

OTLP export is optional and disabled without a configured endpoint. Langfuse
may receive OTLP traces as an optional self-hosted LLM observability sink; the
product remains fully functional without Langfuse, Grafana, or a collector.
Prompts, model outputs, command text, form content, secrets, and raw tool output
are excluded from exported attributes.

## 7. Project Operations Room

Every project gains an **Operasyon** view. It becomes the default view while a
project is active; completed projects open on Delivery.

### 7.1 Visual language

The experience follows the existing calm Atoms-inspired shell: near-black
surfaces, warm editorial typography, restrained borders, and compact data. The
fun comes from truthful motion and team choreography rather than arcade chrome.

- A 24-hour health ring fills from real minute samples.
- Agent nodes move between `Çalışıyor`, `Sırada`, `Uyuyor`, `Onay bekliyor`,
  `Kurtarılıyor`, `Engelli`, and `Çevrimdışı` lanes.
- A handoff draws one short animated path between the participating agents.
- A recovery produces a visible amber incident card that resolves to green
  only after the new attempt advances.
- Verified milestones such as a clean handoff, six healthy hours, a recovered
  provider outage, and 24-hour completion appear in a restrained mission log.
- Motion respects `prefers-reduced-motion`; no essential meaning depends on
  animation or color.

### 7.2 Information hierarchy

The top strip answers five questions without scrolling:

1. Is the runtime genuinely live?
2. How long has this project remained healthy in the current window?
3. Which agents are working, sleeping, waiting, or recovering?
4. What is the oldest due work and next scheduled wake-up?
5. Has any work been lost, replayed, blocked, or recovered?

Below it:

- **Team constellation:** all project members, current action, heartbeat age,
  active attempt, and next wake-up;
- **Workstream lanes:** durable attempts and handoffs on a shared time axis;
- **Incident and recovery rail:** provider, worker, lease, database, and
  approval incidents with recovery duration;
- **Run Inspector:** the existing six-stage receipt view, now selected from a
  concrete attempt;
- **Usage pulse:** task-attributed tokens, reported cost, tool outcomes, and
  provider route health;
- **Mission log:** only evidence-backed milestones.

The words “live”, “healthy”, and “24h verified” are derived states. For example,
a scheduler-disabled PGlite process must show `Yerel demo · scheduler kapalı`,
not `Canlı iz`.

### 7.3 Global command center

The existing `Çalışmalar` page becomes a cross-project command center with
project health cards, worker fleet status, queue age, incident count, and the
same durable event feed. Project details remain isolated; global summaries link
to the owning project and never merge project meetings or conversations.

## 8. Error Handling

- **Provider unavailable:** retry/fallback/backoff; show degraded provider and
  next attempt time. Continuous tasks stay recoverable.
- **Worker crash:** mark stale from heartbeat age, reclaim after lease expiry,
  create a recovery attempt, and show measured recovery time.
- **Database unavailable:** stop claims and tool execution after heartbeat
  failures; reconnect with jitter. Do not claim healthy while persistence is
  unavailable.
- **SSE disconnect:** show stale age and reconnect with `Last-Event-ID`; never
  freeze a green live indicator.
- **Lease lost:** abort subsequent transitions and tool calls; persist a
  lost-ownership event when connectivity permits.
- **Unknown external outcome:** block and request operator reconciliation; do
  not retry automatically. Stop the current tool batch and skip subsequent
  provider/tool calls. Reconciliation changes the terminal evidence for the old
  receipt; it never replays that receipt. Any later execution is a new logical
  responsibility. Taskless chat returns a truthful live-request warning and
  may expose an Ops-visible orphan unknown, but this layer does not claim a
  post-crash reply without a client turn ID and resumable delivery state.
- **Approved browser binding unavailable:** preserve the original approved
  decision, invalidate and scrub its non-consumed action payload, show
  `reapproval_required`, and require a new approval. Never recreate, navigate,
  or silently bind the action to a different process-local browser session.
- **Emergency stop:** remains higher priority than scheduler recovery and
  extinguishes process-local work as today.

## 9. Configuration

Production defaults:

| Variable                      |            Default | Meaning                          |
| ----------------------------- | -----------------: | -------------------------------- |
| `RUNTIME_ROLE`                | `combined` locally | `api`, `worker`, or `combined`   |
| `SCHEDULER_TICK_MS`           |             `5000` | Due-work scan cadence            |
| `TASK_LEASE_MS`               |            `90000` | Task/agent lease duration        |
| `TASK_HEARTBEAT_MS`           |            `15000` | In-flight renewal cadence        |
| `RUNTIME_HEARTBEAT_MS`        |             `5000` | Instance heartbeat cadence       |
| `WORKER_STALE_AFTER_MS`       |            `15000` | Operator-visible stale threshold |
| `RECOVERY_TARGET_MS`          |           `120000` | Recovery SLO threshold           |
| `OPS_SAMPLE_MS`               |            `60000` | Health sample bucket             |
| `OPS_SAMPLE_RETENTION_DAYS`   |               `30` | Native sample retention          |
| `OPS_SSE_MAX_CLIENTS`         |              `100` | Per-API-process stream cap       |
| `OPERATOR_AUDIT_ID`           |   `local-operator` | Non-secret reconciliation actor  |
| `OTEL_EXPORTER_OTLP_ENDPOINT` |              unset | Optional OTLP destination        |

Unsafe or contradictory values fail startup validation. The lease must exceed
four heartbeat periods, and lease duration plus worst-phase scheduler polling
must fit inside the recovery target.

## 10. Validation Strategy

### 10.1 Deterministic tests

- configuration bounds and runtime-role startup;
- task/agent/attempt atomic claim;
- background heartbeat during a provider delay;
- stale owner unable to commit;
- continuous cadence preserved during recovery;
- logical-execution receipt deduplication across recovered attempts, physical
  invocation history/heartbeat/reclaim, transactional receipt/domain
  atomicity, canonicalization corpus, crash-window classification, unknown
  batch termination, and reconciliation continuation evidence;
- exact receipt variants, legacy receipt migration, browser-session approval
  affinity, stable operator audit identity, and taskless-chat truthfulness;
- SSE replay, heartbeat, authorization, capacity, and cleanup;
- derived live/degraded/stale/offline UI states;
- reduced-motion and keyboard-accessible Operations Room.

### 10.2 PostgreSQL multi-process integration

Run two workers against one PostgreSQL database and prove:

- one owner per agent and task;
- kill of the active worker produces one recovery attempt;
- the stale process cannot advance after restart;
- API-only replicas never claim work;
- health samples and operation receipts survive restarts.
- same-key receipt reservations converge without a duplicate effect;
- one active invocation owns a receipt and stale recovery respects lock order;
- exact browser-bound approval cannot execute on a second instance;
- same/opposite reconciliation races are idempotent/`409` respectively.

### 10.3 Failure injection

The harness injects worker termination, provider timeout, 429, malformed model
output, brief database disconnection, SSE client loss, and emergency stop. Each
scenario asserts durable state and UI-visible incident/recovery evidence.

### 10.4 Endurance gates

Two gates are required:

1. **Accelerated 24-hour simulation:** virtual cadence and deterministic fault
   schedule complete during CI while exercising 1,440 minute buckets.
2. **Real 24-hour soak:** PostgreSQL, one API, two workers, ten agents, continuous
   synthetic responsibilities, six forced worker deaths, provider fault
   injection, and browser monitoring.

The real soak passes only with:

- zero lost responsibilities;
- zero duplicate irreversible operation receipts;
- every recoverable worker loss reclaimed within 120 seconds;
- no stale worker commit;
- every injected incident visible in the Operations Room;
- health/readiness and SSE reconnect behavior remaining truthful;
- a machine-readable signed-off report containing timings and failure counts.

Synthetic deterministic model/tool adapters validate runtime durability without
spending provider credits. A separate opt-in provider smoke proves routing but
is not allowed to make representational, financial, publication, or destructive
external actions.

## 11. Delivery Sequence

1. Add runtime configuration, instance/attempt/receipt/sample migrations, and
   focused repository interfaces.
2. Add independent task heartbeats and stale-owner fencing.
3. Split production API and worker roles; update Compose and probes.
4. Add operational read models, SSE, and optional OpenTelemetry export.
5. Build the project Operations Room and global command center.
6. Add deterministic, PostgreSQL multi-process, failure-injection, browser, and
   endurance harnesses.
7. Run all existing release gates, accelerated simulation, then the real
   24-hour soak before claiming the objective complete.

## 12. Compatibility and Migration

- Existing tasks, agents, approvals, activity events, usage rows, project
  members, meetings, and Company Room messages remain authoritative.
- New tables are additive and use the checked-in migration chain.
- Existing receipt rows are backfilled with their prior attempt as the initial
  logical execution identity. Variant constraints allow task, approved-action,
  and taskless-chat receipts without fabricated foreign keys.
- Existing API response fields remain compatible; new operations endpoints are
  generated from OpenAPI.
- Local `pnpm dev` remains usable without Docker or PostgreSQL, but the UI and
  documentation label it unverified for continuous operation.
- Existing security gates, audit redaction, browser ownership, and emergency
  stop invariants may be strengthened but not bypassed.

## 13. Completion Evidence

The feature is not complete when the UI renders or unit tests pass. Completion
requires all of the following current-branch evidence:

- migration and OpenAPI generation are deterministic;
- unit/integration, PostgreSQL multi-process, UI, security, typecheck, build,
  format, license, dependency-audit, and bundle gates pass;
- the production Compose topology reports one API and at least two healthy
  workers using PostgreSQL;
- the accelerated simulation passes;
- the real 24-hour soak report passes every criterion in section 10.4;
- desktop and mobile Chromium show truthful live, stale, degraded, recovery,
  reduced-motion, and stream-reconnect states without console errors or
  horizontal overflow.
