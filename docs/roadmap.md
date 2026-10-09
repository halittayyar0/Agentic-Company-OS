# Product roadmap

Last reviewed: 9 October 2026

Agentic Company OS is a pre-1.0, local-first system for one operator. The roadmap prioritizes a useful first result, recovery and inspectable evidence. Version 0.4.0 source is on main; downloadable releases have separate distribution acceptance. Passing controlled tests does not establish every model's output quality or long-term unattended reliability.

## Implemented in 0.4.0

- Live command center with organization graph, bounded operational metrics, activity stream, health state, command palette, responsive layouts, reduced-motion support, and light/dark modes with an optional system preference.
- Editable agent identities and default role prompts; direct chat with every agent; hierarchical task delegation and lease-controlled autonomous scheduling.
- Versioned Workforce Studio blueprints with explicit AI/next/review handoffs, parent-bounded permissions, atomic hierarchy installation, and optional finite or continuous root outcomes.
- A six-stage Run Inspector reconstructed from persisted evidence, with routing/tool/judge/model recovery visibility and a sanitized trace export.
- A shareable, narrow activity-page evidence packet with a local checksum verifier. It excludes free-form text and raw tool data; the checksum does not authenticate the operator or prove work success. See [shareable evidence](./shareable-evidence.md).
- Per-agent computer workspace combining files, terminal, browser, screenshots, action trace, ownership state, and human handoff.
- Complete live OpenRouter text-model catalog plus direct OpenAI and private-endpoint Ollama adapters, namespaced model IDs, fail-closed tool capability discovery, provider-aware routing, request-ID observability, and usage telemetry.
- Exact, expiring, single-use approvals; live permission rechecks; a canonical-root-CEO host-shell gate; persisted emergency stop; bounded loops, quotas, retries, and model deadlines.
- Single-operator authentication, versioned PostgreSQL/PGlite migrations, production probes, static UI serving, Docker/Compose packaging, Linux and Windows CI regressions, dependency/license policy, and bundle budgets.
- Seven-language setup and route controls, including both Chinese scripts and Arabic RTL. Source playbooks, some server messages and native-speaker acceptance remain incomplete; see [localization coverage](./localization.md).
- Browser regression suites for operator journeys, keyboard/focus, responsive layouts, stale data and uncertain writes. Final 0.4.0 PR acceptance includes 1,105 controlled browser cases, native Windows and both Mac architectures, real PostgreSQL installation/backup/fresh restore and seven-language first jobs. Ten-minute native/container fault drills exercise API/two-worker recovery; they do not establish 24-hour endurance, physical-phone acceptance or live account/model quality.
- In-place local-model, ChatGPT and API connections retain the current draft. ChatGPT inference requires a supported authorized plan and a verified usable account; saved identity consent alone cannot enable it. No subscription credit is promised as an API balance.
- Durable inference reservations, usage evidence and explicit recovery make interrupted requests inspectable. Reading saved usage makes no model call; missing provider usage and unknown costs remain visible.
- Split API/worker control with runtime-bound browser ownership, leased scheduler work and durable operation receipts. Process isolation and universally safe external delivery are not implied by these protocols.

## Current release preparation

- Accept the exact main distribution before moving the latest downloadable release. Ordinary immutable images support Linux x64/ARM64; optional coding requires the separate Linux x64 image and enforced AppArmor profile. Native macOS coding remains unsupported.
- Complete real private-HTTPS phone, assistive-technology, native-speaker and long-duration acceptance. Keep these distinct from desktop browser emulation and controlled local inference.

## Next useful outcome cycle — unreleased

- Recover a project creation after response loss without creating another job. The prepared contract and New-project composer use durable request identity, token-free reads and explicit same-request retries; final candidate release gates remain required.
- Reuse successful briefs through the existing personal skill and project-composer flows. Retain evidence, editable inputs and visible cost limits before introducing more complex triggers or a workflow builder.
- Measure adoption by first useful result and successful recovery, with opt-in local metrics. Feature count and additional agents are not success criteria.

## Beta gate: stronger isolation and identity

- Move browser, interpreter, package-manager, and host-process work into disposable container/VM workers with cgroup or Job Object process ownership and explicit egress policy.
- Replace the shared operator secret with users, roles, scoped sessions, revocation, MFA/passkeys, and object-level authorization.
- Retain exact runtime/session/epoch routing while strengthening the existing worker control plane's process isolation and operational acceptance.
- Add distributed request/capacity limits and externally enforced provider budgets.
- Make the audit ledger append-only and tamper-evident with retention/export controls.

## Beta gate: reliability and evaluation

- Extend the existing browser suites with complete visual-diff and accessibility acceptance, including native devices and assistive technology.
- Extend the existing controlled fault drills and backup/fresh-restore checks into multi-day endurance, real provider faults and migration rollback acceptance.
- Build prompt and tool-policy eval sets for task drift, prompt injection, deceptive completion claims, approval laundering, and unsafe delegation.
- Add versioned release gates that run those evals before a prompt, blueprint, or tool-policy revision becomes active.
- Introduce idempotency keys and reconciliation workflows for every external side effect that can be retried.
- Add backup/restore verification, SLO dashboards, tracing, and operator-facing incident runbooks.

## Product expansion after the beta gate

- Extend the existing first-run setup and deployment diagnostics for more managed installation environments while preserving secure defaults.
- Pluggable worker backends and third-party provider plugins with versioned capability contracts.
- A persisted visual workflow builder with arbitrary trigger/tool/condition nodes, draft/published versions, reusable policy packs, import/export, and rollback.
- Connector-backed schedules and webhooks, event replay, deployment environments, and OpenTelemetry export.
- Multi-organization tenancy only after identity, isolation, audit, and quota boundaries are independently reviewed.

## Current non-goals

- Claiming that prompts alone contain an agent.
- Treating application-level folders, allowlists, or a browser proxy as a hardened sandbox.
- Advertising exactly-once external side effects or guaranteed provider-side spend cancellation.
- Enabling powerful host capabilities by default for the sake of a demo.

See [security-model.md](./security-model.md) for exact current boundaries and [self-hosting.md](./self-hosting.md) for the supported deployment baseline.
