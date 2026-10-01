# Budget resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated operator safely resume eligible budget-paused family work after its allowance becomes available.

**Architecture:** Read spend using the same transaction client as queue transitions. Reserve an immutable, scope-bound UUID receipt under the runtime control lock, then lock agents, approvals and tasks in canonical order. A lazy seven-language panel saves intent before sending and inspects receipts after uncertain responses.

**Tech Stack:** TypeScript, Drizzle, PostgreSQL/PGlite, Express, OpenAPI/Orval, React Query, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-budget-resume-design.md`

## Global Constraints

- Checking must not spend model tokens, change an allowance or reset usage.
- Only authenticated operator intent can request the transition.
- Cannot reopen completed/cancelled work, other block reasons, inactive owners, leased tasks or uncertain physical operations.
- Existing emergency-stop checks stay authoritative.
- Identical accepted replay returns the original result and never queues another model turn.
- No automatic POST retry; preserve identity through navigation/reload.
- Phone widths, RTL, light/dark and seven selected-language packs must remain usable.
- Existing source/build/security/native/container/publication gates remain required.

## Review Focus

- Deleted or reparented source: reject scope changes and retain immutable receipts.
- Huge or corrupt family: fail closed with a bounded result instead of silently processing a subset.
- Approved operation still executing: preserve its reconciliation boundary.
- Missing acknowledgement followed by reload: inspect the saved request before another send.
- Rejected request after allowance renewal: offer a fresh explicit check without reinterpreting the old receipt.

### Task 1: Transaction-compatible spend readers

**Files:** Modify `artifacts/api-server/src/lib/orchestrator/task-spend-admission.ts` and `family-spend-admission.ts`; test `family-spend-admission.test.ts`.

**Interfaces:** Export `SpendReaderClient = Pick<typeof db, "select" | "execute">`; add optional final `client: SpendReaderClient = db` to both readers. `readTaskSpendBlockReason` forwards it.

- [ ] Add a reader-injection test proving individual selects and recursive family execution use the supplied client.
- [ ] Run the focused Node test with an absolute tsx loader; confirm the injected-client assertion fails.
- [ ] Implement the optional client without changing defaults or spending policy.
- [ ] Run focused spend/routing tests and API typecheck; record the evidence.
- [ ] Commit reader changes and plan.

### Task 2: Durable budget resume API

**Files:** Create `lib/db/src/schema/task-budget-resume-requests.ts`, `lib/db/src/generated-sql/0030_task_budget_resume_requests.sql`, `artifacts/api-server/src/routes/task-budget-resume.ts` and `.test.ts`. Modify schema index, migration journal, `routes/tasks.ts` and `lib/api-spec/openapi.yaml`; regenerate api-zod/api-client-react.

**Interfaces:** POST `/tasks/{taskId}/budget-resume` consumes `{requestId: UUID, rootTaskId: positive integer}`. GET `/tasks/{taskId}/budget-resume/{requestId}` returns the same immutable receipt. Receipt contains request/task/root IDs, accepted/rejected outcome, nullable enum reason, queuedTaskIds (max 1000), queuedCount, stillPausedCount and recordedAt. Reasons: `emergency_stop`, `task_changed`, `family_invalid`, `family_too_large`, `allowance_exhausted`, `nothing_eligible`.

- [ ] Write route tests for retained usage, exhausted allowance, eligible descendants, unrelated tasks, duplicate/concurrent replay, cross-scope UUID conflicts, inactive/leased/nonbudget tasks and emergency stop.
- [ ] Run to confirm the absent route fails, then implement independent receipt storage and checked-in migration.
- [ ] Under the control lock resolve exactly one root with cycle-safe recursive SQL; reject scope changes or more than 1000 family members before any transition.
- [ ] Lock agents -> approvals -> tasks sorted by ID. Check active owners, leases, pending/executing/unknown approvals and unfinished/unknown runtime operations before queueing each budget-only candidate with the transaction spend reader.
- [ ] Persist receipt and activity metadata atomically; no briefs, raw errors, usage edits or allowance edits.
- [ ] Generate clients/validators, validate stored receipt reads, run focused route tests and native PostgreSQL concurrent replay/rollback tests.
- [ ] Commit complete backend/API boundary.

### Task 3: Recoverable seven-language budget panel

**Files:** Create `src/components/tasks/budget-task-resume.tsx` and `src/lib/budget-resume-recovery.ts` under `artifacts/agentic-company-os`; modify `pages/tasks/detail.tsx`, `lib/project-studio-copy.ts` and its seven `studio-{locale}.ts` packs; extend `tests/ui/task-resume.spec.ts`.

**Interfaces:** Lazy `BudgetTaskResume({taskId, rootTaskId, reason, onAccepted})`; task-scoped sessionStorage identity validated before network calls; use generated API operations from Task 2.

- [ ] Write failing browser cases for successful/denied check, receipt inspection after lost reply/reload, explicit same-ID retry after missing receipt and zero sends when storage fails.
- [ ] Implement the compact panel below the brief, retaining the recorded reason; explain that checks cost no model tokens and do not reset usage.
- [ ] Include accessible focus/status/error recovery, selected-language seven-pack copy, Arabic 320px light and other 390px dark tests, keyboard and 200% text.
- [ ] Measure lazy transfer and bundle budget; preserve existing ceilings or document a specific feature allocation.
- [ ] Run UI, recovery unit, type/build checks and commit.

### Task 4: Integration, review and publication

**Files:** Update README, `docs/efficient-work.md`, `docs/self-hosting.md`, verification checkpoint, CHANGELOG and candidate package version.

- [ ] Synchronize only after PR #35's two macOS checks pass and its checked source is merged; preserve this branch's work.
- [ ] Review full diff against the spec, including malformed receipts, corrupt/cyclic graphs, cancellation races and hidden unfinished operations. Add failing regression cases for concrete defects.
- [ ] Run code generation, format, audit/licenses, source, build/type, full UI and bundle gates. Publish a PR and attach it to this chat.
- [ ] Wait for all required Linux/Windows/macOS/container/security checks on exact head; merge only passing source and compare source trees.
- [ ] Build immutable distribution, prove published-image install/resume/restore, package, and anonymously verify tag/ZIP/checksum/AMD64+ARM64 image.
- [ ] Record benefit, passed evidence, remaining real-phone/native-speaker/24h limits and next valuable cycle; keep Goal 7 active.
