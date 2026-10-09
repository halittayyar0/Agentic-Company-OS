# Runtime Safety Invariants

This checklist describes server-enforced properties. Prompts and UI labels are
never treated as enforcement. Changes to the scheduler, chat loop, tools,
approvals, VM/browser runtime, or operator routes must preserve these
invariants and add a regression test when behavior changes.

| Threat / invariant        | Server enforcement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Regression evidence                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Global emergency stop     | The singleton `runtime_controls` row is locked before a scheduler/chat/approved-action claim. Enabling the stop persists first and revokes leases transactionally. Every replica observes the persisted version through its scheduler-independent emergency monitor; operator retries and local observers close that process's browser sessions and signal tracked agent children, retrying partial cleanup.                                                                                                                                                                                                       | `runtime-emergency-stop.test.ts`                                                 |
| Prompt and task drift     | Core system policy is separate from escaped, bounded role/task/activity data. Tool results enter model context in a JSON envelope explicitly labelled `untrusted_data`.                                                                                                                                                                                                                                                                                                                                                                                                                                            | `untrusted-tool-output.test.ts`; system-prompt tests/typecheck                   |
| Live authority            | Every tool re-reads the active agent and current permissions. Task tools require the exact active task lease. Spend, delete, publish, and external-contact approval categories require their matching live permission.                                                                                                                                                                                                                                                                                                                                                                                             | `approved-action.test.ts`; `orchestrator-safety.test.ts`; `app.security.test.ts` |
| Sudo authority            | Only the singular server-marked root CEO can see or execute the tool. The runtime gate, live permission, exact command digest, five-minute expiry, typed digest confirmation, single consumption, and process/host/workspace affinity must all match.                                                                                                                                                                                                                                                                                                                                                              | `approved-action.test.ts`; `app.security.test.ts`                                |
| Human approval scope      | Protected browser/VM actions bind task, agent, tool, exact canonical arguments, target context, expiry, and one consumption. Approval is at-most-once; a crash may safely drop an effect but must not replay it.                                                                                                                                                                                                                                                                                                                                                                                                   | `approved-action.test.ts`; browser session/control tests                         |
| Loop and spend capacity   | Tool rounds are adaptive but clamped to 4–16; a single model response is rejected before execution if its tool-call array exceeds the 1–32 bounded batch limit. Rejected or malformed tool calls cannot count as successful progress and move through bounded correction, compatible fallback, and backoff. Finite-task token/provider-reported-cost/runtime-failure budgets block further claims using every task-attributed usage-ledger row; lifetime counters never stop continuous cadence. The lifetime step cap is explicit opt-in. LLM calls and model route/retry counts have bounded deadlines and caps. | `tool-loop-policy`, `task-budget-policy`, `model-fallback`, and lifecycle tests  |
| Global capacity           | Active agents, outstanding tasks, outstanding approvals, per-agent message history, and Company Room history have configurable hard limits. Creation checks run while holding the shared runtime-control row lock so concurrent replicas cannot overbook a slot.                                                                                                                                                                                                                                                                                                                                                   | `runtime-capacity.test.ts`                                                       |
| Task completion truth     | Completion fails closed if the judge is unavailable/malformed and is rejected while any child task is still active or blocked. Approval actions requested inside an existing task resume it for normal judged completion; server-created single-action approval tasks complete deterministically only after that exact action succeeds.                                                                                                                                                                                                                                                                            | `approved-action.test.ts`; `orchestrator-safety.test.ts`; judge behavior         |
| Task concurrency          | Task and agent leases are claimed transactionally, heartbeated only by the owner, and cleared on stop/cancel/deactivation/failure. Agent, approval, and task rows use one canonical lock order when an operation spans them, so cancellation, deactivation, delegation, resume, and approved-action execution cannot commit contradictory ownership. One agent cannot run scheduler work and direct chat concurrently.                                                                                                                                                                                             | `app.security.test.ts`; autonomy, approval, and scheduler tests                  |
| Browser control ownership | Exactly one owner (`agent` or `operator`) controls a session. Operator takeover uses an exact expiring lease and FIFO input queue; stale leases, restarts, closes, and generations fail closed.                                                                                                                                                                                                                                                                                                                                                                                                                    | browser-control/session tests                                                    |
| Workspace containment     | Agent paths are lexically rooted, pre-existing symlink components are rejected, file/output sizes are bounded, cwd changes are per-agent serialized, and external processes are off by default.                                                                                                                                                                                                                                                                                                                                                                                                                    | `sandbox.test.ts`; browser screenshot tests                                      |
| Network target policy     | Browser requests default to public HTTP(S) only. A loopback resolving proxy validates every DNS answer and dials the selected public IP directly; Chromium QUIC and non-proxied WebRTC are disabled. URL credentials, downloads, service workers, and default WebSockets are rejected.                                                                                                                                                                                                                                                                                                                             | `browser-policy.test.ts`; `browser-egress-proxy.test.ts`                         |
| Audit minimization        | Durable terminal events store command name/hash and outcome, never the raw command. Browser activity strips URL query/fragment and browser typing content is never persisted. Exact-approved CEO Host Shell output is the narrow exception: only a sudo-redacted plus audit-redacted preview is stored, capped at 12 lines and 1,536 stdout/512 stderr UTF-8 bytes. Error serializers allowlist small redacted fields and drop SDK request/config/header objects.                                                                                                                                                  | `approved-action.test.ts`; `audit-redaction.test.ts`; `logger.test.ts`           |
| Failure recovery          | Stale leases and running computer/operator events are reconciled after restart, expired sudo payloads are scrubbed, and failures use capped exponential backoff. Runtime bugs eventually block finite work; exhausted provider/model routes remain durably queued for finite and continuous work. A consumed approval whose atomic outcome transaction is missing is marked outcome-unknown and blocked rather than replayed.                                                                                                                                                                                      | `task-autonomy`, `task-retry-policy`, approved-action, and recovery tests        |

## Residual boundaries

- The emergency stop prevents **new autonomous** chat, task, tool, and approved
  action execution. Founder/operator shell and operator VM controls remain
  available as recovery channels. An OS descendant that detached before the
  stop may survive `SIGTERM`; production deployments need container/VM process
  supervision and a host-level kill control.
- Agent workspace rooting and executable allowlists are not OS isolation.
  Enabling Node, Python, package managers, Git, CEO host shell, or founder shell
  grants the API service account's reachable authority.
- The browser resolving proxy removes the normal application DNS-check/DNS-use
  gap, but it is still a process-level control rather than an OS network
  sandbox. Deploy with an egress firewall that also denies private, loopback,
  link-local, metadata, and internal ranges. Treat
  `AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS=true` as a deliberate bypass.
- PostgreSQL coordinates leases and the emergency-stop state across replicas;
  each scheduler-independent emergency monitor applies a new stop version to its process-local
  children/sessions. This is polling, not instantaneous distributed signaling.
  Process-lifetime PGlite does not coordinate replicas. Playwright sessions and
  ref handles remain process-local and need affinity.
- Approval binding is exact for implemented paths, not a universal
  side-effect detector. Plain link navigation, enabled programs, mutable
  scripts/package hooks, and destination-site behavior can still have effects.
- Audit redaction is defense in depth, not a secret store. Do not place secrets
  in prompts, tasks, browser pages, workspaces, or logs; use an external secret
  manager and restricted service identity.
- The activity ledger is mutable database state, not tamper-evident evidence.

## Runtime limits

| Variable                                   |  Default | Meaning                                                                                 |
| ------------------------------------------ | -------: | --------------------------------------------------------------------------------------- |
| `LLM_REQUEST_TIMEOUT_MS`                   | `120000` | Hard deadline per provider completion; clamped to 5 s–10 min.                           |
| `MODEL_FALLBACK_MAX_ROUTES`                |      `3` | Maximum cost-compatible routes per logical step; clamped to 1–4.                        |
| `MODEL_RETRY_ATTEMPTS_PER_ROUTE`           |      `2` | Same-route attempts for transient inference failures; clamped 1–3.                      |
| `MODEL_RETRY_BASE_DELAY_MS`                |    `750` | Exponential retry base; individual delays are capped at 5 seconds.                      |
| `MAX_ACTIVE_AGENTS`                        |     `64` | Maximum active agents.                                                                  |
| `MAX_OUTSTANDING_TASKS`                    |    `500` | Maximum pending/planning/in-progress/awaiting-approval/blocked tasks.                   |
| `MAX_OUTSTANDING_APPROVALS`                |    `200` | Maximum pending plus approved-unconsumed executable approvals.                          |
| `MAX_MESSAGES_PER_AGENT`                   |   `5000` | Maximum durable chat rows per agent; a turn reserves two rows.                          |
| `MAX_COMPANY_MESSAGES`                     |  `50000` | Maximum durable Company Room rows; positive values are capped at 1000000.               |
| `MAX_AGENT_TOOL_CALLS_PER_ROUND`           |      `8` | Maximum calls accepted from one model response; clamped to 1–32.                        |
| `COMPANY_CHAT_MAX_RESPONSE_ATTEMPTS`       |      `6` | Maximum responder gates per post; the roster adds no cap beyond `MAX_ACTIVE_AGENTS`.    |
| `COMPANY_CHAT_RESPONSE_CONCURRENCY`        |      `1` | Bounded responder pool; sequential preserves conversational context.                    |
| `COMPANY_CHAT_RESPONSE_MAX_TOKENS`         |    `400` | Maximum completion tokens reserved for one room response.                               |
| `COMPANY_CHAT_RESPONSE_TOKEN_BUDGET`       |   `2400` | Aggregate completion-token reservation for one room dispatch.                           |
| `PROJECT_MEETING_MAX_RESPONDERS_PER_START` |      `8` | Maximum tool-free turns per start; the roster still obeys global active-agent capacity. |
| `PROJECT_MEETING_MAX_CONCURRENT_STARTS`    |      `2` | Shared-database live meeting reservations; each agent also requires its database lease. |

When a capacity limit is reached, the API/tool fails closed with an explicit
capacity error. Raise a limit only after storage, provider budget, and operator
review capacity have been increased deliberately.

Project meeting execution requires an immutable request UUID. API replicas
sharing the database serialize reservation claims through the runtime-control
row. A live meeting reservation excludes a competing identity; matching
replays only observe the existing outcome. Use identical capacity settings on
all replicas. Open-meeting, request-owner/deadline and agent-lease checks fence
provider admission and transcript writes. Emergency stop invalidates the old
reservation even if the operator later removes the stop. See
[meeting turn recovery](./meeting-turns.md) for retention, restart requirements
and limits of the other meeting mutations. Native PostgreSQL acceptance remains
a separate gate from the PGlite router-instance tests.

## Endurance failure diagnostics

When the original native or container wall-clock test misses expected work,
the coordinator records bounded metadata in its hashed journal before native
provenance and cleanup. Each of at most ten agents contributes its first
missing observed cycle, last available attempt state, task state and effect
states. The root project can itself be a responsibility and is included.

The diagnostic read has a ten-second ceiling and aborts its requests on timeout.
Unavailable diagnostics retain a fixed marker while the original failed result
and cleanup remain. Missing task reads stay unknown; attempt and receipt window
truncation remains explicit. An absent attempt is unknown when the history is
truncated or its task identity is ambiguous. Only complete, unambiguous history
can report an absent attempt as not started. No raw errors, task text, names, credentials,
commands or output are recorded. The existing first-cycle native smoke remains
unchanged.

These are current readonly observations after the accepted work horizon, with
their own sampled timestamp. Reads of operations and tasks are not an atomic
database snapshot. A task may complete after the horizon; that later state
cannot change the recorded completion count or authorize replay of an uncertain
effect. A later passing run does not diagnose an earlier failure. The original
completion, fault, duration, cadence, security and independent verifier gates
remain required.
