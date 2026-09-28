# Product roadmap

Last reviewed: 27 September 2026

Agentic Company OS is an early, local-first alpha. The roadmap is ordered by risk reduction and operator value rather than artificial hour estimates. Completed work is recorded here so public documentation never presents shipped capabilities as missing.

## Shipped in the current alpha

- Live command center with organization graph, bounded operational metrics, activity stream, health state, command palette, responsive layouts, reduced-motion support, and light/dark modes with an optional system preference.
- Editable agent identities and default role prompts; direct chat with every agent; hierarchical task delegation and lease-controlled autonomous scheduling.
- Versioned Workforce Studio blueprints with explicit AI/next/review handoffs, parent-bounded permissions, atomic hierarchy installation, and optional finite or continuous root outcomes.
- A six-stage Run Inspector reconstructed from persisted evidence, with routing/tool/judge/model recovery visibility and a sanitized trace export.
- Per-agent computer workspace combining files, terminal, browser, screenshots, action trace, ownership state, and human handoff.
- Complete live OpenRouter text-model catalog plus direct OpenAI and private-endpoint Ollama adapters, namespaced model IDs, fail-closed tool capability discovery, provider-aware routing, request-ID observability, and usage telemetry.
- Exact, expiring, single-use approvals; live permission rechecks; a canonical-root-CEO host-shell gate; persisted emergency stop; bounded loops, quotas, retries, and model deadlines.
- Single-operator authentication, versioned PostgreSQL/PGlite migrations, production probes, static UI serving, Docker/Compose packaging, Linux and Windows CI regressions, dependency/license policy, and bundle budgets.
- Seven-language setup and route controls, including both Chinese scripts and Arabic RTL. Source playbooks, some server messages and native-speaker acceptance remain incomplete; see [localization coverage](./localization.md).
- Browser regression suites for operator journeys, keyboard/focus, responsive layouts, stale data and uncertain writes. Local passing checks are recorded in [release readiness](./verification/2026-09-27-release-readiness.md); native PostgreSQL, container and physical-phone acceptance remain unverified in the current environment.
- Split API/worker control with runtime-bound browser ownership, leased scheduler work and durable operation receipts. Process isolation and universally safe external delivery are not implied by these protocols.

## Current release preparation

- Finish durable recovery across navigation/reload for Operations reconciliation and the other documented operator flows, plus the meeting model-turn recovery inbox.
- Complete remaining source-language, visual/accessibility, pagination and retention review.
- Verify the exact clean candidate, full-history secret scan, native PostgreSQL/container topology and real private-HTTPS phone access. Keep public release claims within the resulting evidence.

## Beta gate: stronger isolation and identity

- Move browser, interpreter, package-manager, and host-process work into disposable container/VM workers with cgroup or Job Object process ownership and explicit egress policy.
- Replace the shared operator secret with users, roles, scoped sessions, revocation, MFA/passkeys, and object-level authorization.
- Retain exact runtime/session/epoch routing while strengthening the existing worker control plane's process isolation and operational acceptance.
- Add distributed request/capacity limits and externally enforced provider budgets.
- Make the audit ledger append-only and tamper-evident with retention/export controls.

## Beta gate: reliability and evaluation

- Extend the existing browser suites with complete visual-diff and accessibility acceptance, including native devices and assistive technology.
- Add failure-injection drills for database loss, provider timeout, API replica death, emergency-stop propagation, stuck child processes, and migration rollback/restore.
- Build prompt and tool-policy eval sets for task drift, prompt injection, deceptive completion claims, approval laundering, and unsafe delegation.
- Add versioned release gates that run those evals before a prompt, blueprint, or tool-policy revision becomes active.
- Introduce idempotency keys and reconciliation workflows for every external side effect that can be retried.
- Add backup/restore verification, SLO dashboards, tracing, and operator-facing incident runbooks.

## Product expansion after the beta gate

- Optional first-run setup and deployment diagnostics without weakening secure defaults.
- Pluggable worker backends and third-party provider plugins with versioned capability contracts.
- A persisted visual workflow builder with arbitrary trigger/tool/condition nodes, draft/published versions, reusable policy packs, import/export, and rollback.
- Connector-backed schedules and webhooks, event replay, deployment environments, and OpenTelemetry export.
- Multi-organization tenancy only after identity, isolation, audit, and quota boundaries are independently reviewed.

## Non-goals for the current alpha

- Claiming that prompts alone contain an agent.
- Treating application-level folders, allowlists, or a browser proxy as a hardened sandbox.
- Advertising exactly-once external side effects or guaranteed provider-side spend cancellation.
- Enabling powerful host capabilities by default for the sake of a demo.

See [security-model.md](./security-model.md) for exact current boundaries and [self-hosting.md](./self-hosting.md) for the supported deployment baseline.
