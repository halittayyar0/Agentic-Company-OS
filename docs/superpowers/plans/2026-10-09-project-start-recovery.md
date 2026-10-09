# Project start recovery implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Native execution follows the user's standing authorization and preference for minimal agent overhead.

**Goal:** Recover a submitted project request without starting a duplicate job after response loss.

**Architecture:** Add an optional request UUID to the existing TaskInput and a narrow durable receipt. Serialize request lookup and project creation under the existing global runtime lock; the browser saves the exact request before dispatch and uses token-free receipt reads after uncertainty.

**Tech Stack:** Existing Node24, Express, Drizzle, PostgreSQL/PGlite, Zod, React and Playwright; no new dependency.

**Spec:** ../specs/2026-10-09-project-start-recovery-design.md

## Global constraints

- Final0.4.0 PR42/head8aca remains frozen and must finish release first; work only in the separate existing `simple-task-results` worktree.
- Keep legacy identity-less callers working; reliable recovery requires the new UUID.
- Global control lock precedes receipts/agents; project and receipt commit atomically. Known rejection is terminal; storage failure rolls back both.
- Receipts retain identity after project removal, store no raw input and grant no permissions or execution/completion claims.
- Session storage round-trip before POST, no automatic POST retries, unchanged nonce/input on explicit retry, seven authored languages and Arabic RTL at 200%.
- No paid inference, user sign-in or extra runtime agent.

## Review focus

- A lost first response plus overlapping same-ID retry must not create two jobs.
- A current emergency stop or inactive owner must not prevent token-free recovery of an already accepted job.
- Project removal or later task state changes must not recycle an old identity or substitute an old completion claim.
- A delayed response must not erase a newly edited draft or an unrelated pending request.
- GET404 from an in-flight transaction must only enable same-ID retry, never a new identity.

## Task1: durable creation contract

**Files:** modify lib/api-spec/openapi.yaml and regenerated clients/Zod; create lib/db/src/schema/task-creation-requests.ts, migration0044 and schema export; create artifacts/api-server/src/lib/task-creation-requests.ts and tests; integrate artifacts/api-server/src/routes/tasks.ts plus route tests.

**Interfaces:** `createProjectRequest(input: ProjectCreationInput, requestId: string): Promise<{state:'created',task:TaskRow,replayed:boolean}|{state:'rejected',failureCode:string,replayed:boolean}>`; `readProjectCreationRequest(requestId:string): Promise<{requestId,state,taskId,failureCode,createdAt}|undefined>`. Receipt GET follows the spec. Shared input normalization uses the existing TaskInput validation; UUID validation is independent before transport/storage.

- [ ] Write a real HTTP test sending the same UUID twice; assert both responses identify the same project and one persisted project/activity. Run against current code and save expected duplicate-ID assertion failure.
- [ ] Add generated requestId/receipt schemas, append-only receipt migration and transactional service; integrate existing POST with201/200 replay and standalone GET. Do not change ordinary task execution or create-project admission.
- [ ] Add real behavioral tests for concurrent replay, altered brief/owner/cadence, semantic defaults, mixed-case UUID, invalid IDs/queries, replay under stop, durable rejection, removed task, and rollback. Run targeted source tests with Node24 until green.
- [ ] Run the same concurrency cases against disposable owned PostgreSQL, with cleanup restricted to that owned fixture; preserve actual logs.
- [ ] Run codegen/typecheck/format and commit only this complete server contract after its gates; keep publication separate from current PR42.

## Task2: recoverable project composer

**Files:** new project-start request state/API modules and their tests under artifacts/agentic-company-os/src/lib; new hook under src/hooks; modify pages/tasks/new.tsx; extend new-project-copy.ts and its seven authored packs; add browser cases under tests/ui.

**Interfaces:** persist validated frozen request before dispatch; load the exact unresolved request on reload; check GET without model calls; retry POST only on explicit same-ID action. Consume the TaskCreationReceipt shape from Task1; an acknowledged created receipt permits Open project, not a work-completion assertion.

- [ ] Write failing state tests proving denied storage prevents dispatch, changed drafts do not change frozen requests, delayed outcomes cannot clear another request/draft, and malformed receipts cannot navigate.
- [ ] Implement persistence, explicit read/retry/open/rejected recovery and focus behavior with existing composer draft helpers. Add all seven authored copy packs and render a compact panel beside Start.
- [ ] Add controlled browser response-loss/reload tests; prove exact identity/input and one job on delayed first response + retry. Include failed reads, 404, terminal rejection, server corruption and failed clearing.
- [ ] Run seven language cases at390px, dark/light, keyboard, Arabic RTL200%; assert draft retention, no overflow and no automatic creation/inference.
- [ ] Run API codegen, typecheck, source suite, build and relevant browser tests; preserve every failing result and fix the actual cause before publication.

## Task3: integration, docs and publication

**Files:** docs/efficient-work.md, CHANGELOG.md, current release proof/checkpoint and GitHub PR notes.

- [ ] Document identity-less compatibility, storage requirements, uncertain reads, explicit same-request retry and scope of a created receipt; refresh the dated roadmap with verified facts.
- [ ] Self-review real code and final whole-branch review, then fix actual important defects with RED/GREEN behavior tests.
- [ ] Confirm final0.4.0 release was verified first. Rebase/cherry-pick complete candidate onto verified actualmain, preserving synthetic-test tree identity where applicable.
- [ ] Audit licenses/dependencies and full candidate history, run all mandatory whole source/UI/platform/current-head gates, publish a new focused PR and attach it. Merge only verified exact head/base after all required checks.
- [ ] Verify actualmain and distribution/release results, update scoped evidence and continue the broader successful-brief reuse cycle. Do not mark Goal7 complete from this dependency alone.
