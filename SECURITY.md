# Security Policy

Agentic Company OS coordinates models, browsers, files, processes, credentials, and business workflows. Treat it as security-sensitive software even when running locally.

## Supported versions

The project is alpha and has no stable release line.

| Version                                        | Security support |
| ---------------------------------------------- | ---------------- |
| Current `main` branch                          | Best effort      |
| Old commits, forks, and unofficial deployments | Not supported    |

Security support during alpha is best-effort and has no response-time SLA.

## Reporting a vulnerability

Do **not** open a public issue containing vulnerability details, proof-of-concept payloads, secrets, or affected deployment information.

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability** to use GitHub private vulnerability reporting.
3. Include the affected commit, impact, prerequisites, reproduction steps, and a minimal proof of concept.
4. Explain whether credentials, filesystem access, browser sessions, host execution, cross-tenant data, or public deployments are involved.

If private vulnerability reporting is unavailable, open a minimal public issue asking the maintainers to establish a private channel. Do not include sensitive details in that issue.

If a real secret was exposed, revoke or rotate it immediately. Removing it from the latest commit does not remove it from Git history.

## High-value security reports

Examples include:

- unauthenticated access that crosses the intended loopback/private-network boundary;
- escaping an agent workspace through path traversal, symlinks, or process execution;
- enabling founder or agent process execution without the explicit environment opt-in;
- sending OpenRouter credentials to an origin other than the pinned provider origin;
- leaking provider keys through API responses, logs, UI state, generated artifacts, or activity records;
- bypassing an implemented authorization or approval enforcement control;
- remote code execution, arbitrary host filesystem access, SSRF with meaningful impact, or stored/reflected XSS;
- cross-agent or cross-operator data disclosure; and
- dependency or CI compromise affecting repository consumers.

## Security-relevant known limitations

These are architectural constraints, not vulnerability claims:

- **Single-operator authentication, not user isolation.** Production/remote startup requires a 32+ character operator token. Protected API routes accept its bearer form or a signed HttpOnly session cookie. Every holder has full operator authority; there are no users, roles, tenants, object-level grants, session revocation lists, MFA, or account recovery.
- **CORS is not authorization.** It only constrains cooperating browsers and does not stop direct HTTP clients or same-origin compromise.
- **Approval enforcement is scoped, not universal.** Exact, expiring, single-use approvals are enforced for CEO host-shell command strings, agent browser typing, unsafe clicks, and destructive built-in VM commands. Other external-action paths are not all intercepted by one policy engine.
- **Judge failure semantics differ by purpose.** A failed or malformed completion review blocks completion. A failed approval review becomes a visible warning, but the independent human approval remains required. The judge still evaluates selected text through a model and is not proof of safety.
- **Agent workspaces are path-rooted directories, not hardened containers or VMs.** Lexical traversal and pre-existing symbolic-link paths are rejected, but built-in file operations remain available when external process spawning is disabled.
- **Browser access is public-web filtered, not fully isolated.** Non-HTTP(S), credential-bearing, local, private, and special-network targets are blocked by default for top-level and subresource requests; WebSockets are disabled by default. Public-web side effects and DNS/network-layer bypass classes still require containment.
- **Browser approval execution is exact-owner and at-most-once.** The approval record and runtime/session/epoch owner are durable, while the Playwright session and snapshot-ref registry remain local to that worker. The API sends commands only through that owner's authenticated, encrypted runtime-control channel. A dead/restarted owner, stale binding, missing acknowledgement, or ambiguous post-dispatch result is not retargeted or automatically replayed; it safe-drops or becomes an explicit `unknown` outcome.
- **Leases and operation receipts are not universal exactly-once delivery.** PostgreSQL task/agent/attempt/invocation leases fence stale owners. Durable receipts atomically cover internal transactional mutations, reuse external idempotency keys where supplied, replay known results, and prevent automatic re-execution of at-most-once or approval-bound effects whose outcome is unknown. They cannot prove the truth of an external system after a crash; an operator must independently verify and reconcile `unknown` outcomes.
- **The synthetic endurance runtime is test-only.** Ordinary production images reject it. The Docker soak profile requires a dedicated root-owned marker and run-scoped control file; the native runner is loopback-only development mode. The marker is a runtime-code deployment guardrail, not cryptographic image attestation—a root-controlled operator can replace code/images/mounts. Enabling or copying these controls into a normal deployment invalidates the production boundary.
- **Usage and cost limits depend on provider telemetry.** Per-completion token fields are recorded without inventing missing usage. Only provider-reported cost is counted, so local task budgets are circuit breakers rather than billing guarantees.
- **Founder shell is full host authority.** When enabled, it uses the platform shell and inherited process environment.
- **CEO sudo is API-account host authority, not privilege elevation.** A server-managed root identity, local-only runtime gate, five-minute exact-command scope, typed digest confirmation, and API-process/host/physical-workspace binding constrain invocation. A restart or replica mismatch safe-drops it. The shell still reaches everything the API OS account can reach; mutable referenced content and background descendants are not contained by approval or timeout.
- **Agent process execution is an allowlist, not a hardened sandbox.** When enabled, allowed interpreters and package tools may execute untrusted code within the OS account's reach.
- **Provider-key storage depends on the runtime role.** Split API/worker roles store an authenticated encrypted provider-config envelope in PostgreSQL using `RUNTIME_CONTROL_KEY`. Combined development retains the gitignored `data/runtime-config.json` compatibility file, which is plaintext on disk even when restrictive mode is supported.
- **Embedded PGlite is process-lifetime development storage.** It is not a durable or isolated production database.
- **Rate limits are per process.** The bounded API/login limiter reduces accidental abuse and single-process brute force; multi-replica deployments still require a distributed edge limiter.
- **Model output is untrusted.** Prompt injection and malicious web content can influence tool requests.

The detailed trust boundaries and mitigations are documented in [docs/security-model.md](./docs/security-model.md).

## Secure operating baseline

- Keep `HOST=127.0.0.1`.
- Keep `ALLOW_REMOTE_ACCESS=false`; production or a non-loopback bind additionally requires built-in operator authentication and PostgreSQL, while non-loopback also requires exact CORS origins and trusted hostnames.
- Leave `ALLOW_AGENT_PROCESS_EXEC`, `ALLOW_AGENT_SUDO`, and `ALLOW_FOUNDER_SHELL` unset or exactly `false` unless each capability is deliberately isolated and reviewed.
- Leave `AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS` unset or exactly `false`.
- Leave `AGENT_BROWSER_ALLOW_WEBSOCKETS` unset or exactly `false`; set conservative browser-session caps and idle expiry.
- Select runtime roles deliberately: `RUNTIME_ROLE=api` forces scheduler admission off, `worker` forces it on, and only `combined` consults `SCHEDULER_ENABLED`. Multiple schedulers must share the same durable PostgreSQL database so leases can coordinate them; PGlite cannot coordinate processes.
- In split mode, give the API and every worker one shared, independently generated `RUNTIME_CONTROL_KEY` that is different from the operator bearer token. Workers make authenticated outbound control polls and do not need the operator token or an inbound HTTP port.
- Keep browser commands on the runtime/session/epoch owner selected by the durable control plane. Do not add retries, alternate-worker fallback, or load-balancer stickiness as a substitute for exact-owner routing; owner loss requires safe-drop/`unknown` handling and, when applicable, a fresh snapshot and approval.
- Set `MAX_TASK_STEPS`, `MAX_TASK_TOKENS`, `MAX_TASK_REPORTED_COST_USD`, and `MAX_CONSECUTIVE_TASK_FAILURES` to deliberate limits, then retain provider-side hard budgets and alerts.
- Do not run the Vite development server as a public service.
- Put TLS, distributed request limits, and network access control in front of **every** UI and `/api` path before any non-local deployment; keep the built-in operator token enabled behind that edge.
- Prevent direct access to the API around the reverse proxy.
- Use a dedicated low-privilege OS account, isolated host/container/VM, and restricted outbound network policy.
- Store provider keys in an environment/secret manager and rotate them regularly.
- Use exact `CORS_ALLOWED_ORIGINS` and `TRUSTED_HOSTS` lists; never treat them or the cross-site mutation guard as substitutes for authentication.
- Review agent prompts and permissions before assigning real-world tasks.
- Keep browser sessions free of privileged logins unless the risk is explicitly accepted.
- Back up and restrict the PostgreSQL database when durable storage is enabled.
- Let startup apply only the checked-in migration journal; validate upgrades on a restored copy and never replace reviewed migrations with `drizzle-kit push` in production.
- Treat [24-hour endurance evidence](./docs/endurance.md) as commit- and topology-specific. A short or accelerated report with `verified24h: false` is never a 24-hour reliability claim.

## Disclosure and remediation

Maintainers will validate reports, coordinate a fix when feasible, and credit reporters who request attribution. Please allow a reasonable remediation window before public disclosure. Do not test against systems or data you do not own or have explicit permission to assess.
