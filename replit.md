# Agentic Company OS

Contributor and runtime context for the local-first command center that operates a hierarchy of AI agents. The public README, architecture, security model, and OpenAPI specification are authoritative; keep this file aligned with them.

## Run and verify

- `pnpm --filter @workspace/api-server run dev` — build and start the API on loopback port 5000.
- `pnpm --filter @workspace/agentic-company-os run dev` — start the local Vite UI.
- `pnpm run verify` — formatting, audit, license policy, auto-discovered tests, PGlite migration, typecheck, production build, and bundle budget.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate React hooks and Zod validators from OpenAPI.
- `pnpm --filter @workspace/db run migrate` — apply the checked-in migration chain. Use `push` only for disposable schema exploration, never as the release path.

Use Node.js 24 and the exact pnpm version declared in `package.json`. Local development can boot with process-lifetime PGlite; production, remote access, durability, and multiple replicas require PostgreSQL. An LLM provider is optional for boot but required for agent turns.

## Stack and repository map

- React 19, Vite 7, TanStack Query, Tailwind CSS, Radix UI, and Framer Motion.
- Express 5, Zod 3, Drizzle ORM, PostgreSQL/PGlite, Playwright Core, and OpenAI-compatible provider clients.
- `artifacts/agentic-company-os/` — operator UI.
- `artifacts/api-server/` — API, scheduler, orchestration, approvals, browser, and workspace runtime.
- `lib/ai-server/` — Replit/OpenRouter clients, live catalog, and model routing.
- `lib/api-spec/openapi.yaml` — API contract source of truth.
- `lib/api-client-react/` and `lib/api-zod/` — generated client and validation artifacts.
- `lib/db/` — schema, checked-in SQL migrations, and database bootstrap.
- `docs/` — architecture, security boundaries, hosting, and public roadmap.

## Runtime architecture

- Per-message model override wins over an agent's saved manual model, which wins over automatic routing. OpenRouter vendor IDs—including exact suffix variants such as `minimax/minimax-m3:free`—stay intact. Manual agent models must exist in the catalog, have an available provider, and report tool support.
- Production runs one HTTP-only API and separate scheduler-only workers. `combined` remains a single-process development mode; PGlite is development-only. PostgreSQL task, agent, attempt and runtime-instance leases fence stale workers. Browser sessions and element references stay process-local, and the API routes commands through the authenticated encrypted runtime-control channel to the exact recorded owner. Browser-client sticky routing is not the ownership mechanism.
- Every API replica observes the persisted emergency stop independently of the scheduler. It blocks chat, scheduler work, tools, and approved actions and releases active leases.
- Dynamic task, relationship, and tool material is bounded and treated as untrusted data. Model output never creates authority; live permissions and approval scope are rechecked at execution time.
- Usage rows retain provider/model token telemetry and provider-reported OpenRouter cost. Local circuit breakers are not provider billing limits.

## Computer and browser authority

- Per-agent workspace tools resolve paths under `agent-sandboxes/agent-{id}`. Built-in file commands are constrained there; optional external processes require `ALLOW_AGENT_PROCESS_EXEC=true`, an allowlist, bounded output/time, and a reduced environment. This is not a hardened VM boundary.
- Agent browser sessions use the public-only resolving proxy by default. It validates DNS answers and pins a selected public IP; private-network access and WebSockets are explicit dangerous opt-ins. The proxy is defense in depth, not an OS firewall.
- Browser typing, unsafe clicks, destructive workspace commands, and business side effects use exact, expiring, single-use approval scopes. Live spend/delete/publish/external-contact permissions are enforced in addition to human approval.
- CEO host shell and Founder shell are separate gates. CEO host shell requires the singular server-managed root CEO, `canUseSudo`, loopback-only `ALLOW_AGENT_SUDO=true`, exact command/hash confirmation, process/host/workspace affinity, and a five-minute approval. Founder shell requires `ALLOW_FOUNDER_SHELL=true` and gives the operator the API service account's full host authority. Neither is OS privilege elevation or containment.

## Security invariants

- Keep the API loopback-only unless the full remote boundary is configured: production mode, durable PostgreSQL, 32+ character operator token, explicit remote opt-in, exact trusted hosts, exact CORS origins, and TLS/firewall at the edge.
- Provider secrets are never returned to the UI or placed in activity logs. OpenRouter inference is pinned to `https://openrouter.ai/api/v1`; its public model catalog is fetched without an Authorization header.
- Do not weaken path, origin, permission, lease, emergency-stop, approval, quota, or redaction checks to make a test pass. Update focused abuse-case tests with every security-sensitive behavior change.
- Default powerful capabilities remain off in `.env.example`, Docker, and Compose. A developer's gitignored local `.env` is not a release default.

## Codegen and provider gotchas

- OpenAPI supports `integer`; preserve the bounded minimum/maximum definitions used by request pagination and runtime schemas.
- Orval writes only beneath each package's `generated/` tree. Keep `lib/api-zod/src/index.ts` curated so runtime validators and generated DTO names cannot collide.
- `lib/api-spec/orval.config.ts` explicitly selects Zod 3 generation. Retain OpenAPI integer constraints; historical development notes suggesting that integers should become unrestricted numbers are superseded by this configuration and the current API contract.
- `reasoning_effort: "none"` is injected only for Replit fleet chat-completion calls that carry tools. Do not add it to OpenRouter calls.
- Any new model-selection path must preserve exact provider IDs, verify provider availability, and fail closed for agent models without tool support.
