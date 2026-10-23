# Guided Local Model Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user authorized inline autonomous execution; use one final fresh review, not a reviewer per task.

**Goal:** Obtain a starter model from the existing private Ollama server through a guided application flow, then return to the user's draft.

**Architecture:** A bounded streaming protocol feeds a durable operator preparation receipt owned by the API runtime. Existing provider configuration and catalog admission remain authoritative. The existing guided connection dialog hosts a lazy seven-language preparation section; no model runtime binaries or OS services are installed by the app.

**Tech Stack:** Node24, TypeScript, PostgreSQL/Drizzle, Express, React Query, existing Radix/shared UI, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-local-model-preparation-design.md`

## Global Constraints

- Node `>=24 <25`; pnpm `>=10.17 <11`; no new package dependencies.
- Recipe `qwen35-2b`, reference `qwen3.5:2b-q4_K_M`, Ollama0.40.3+, estimate1,945,782,446 bytes. No arbitrary URL/model, cloud name, insecure transfer or inference in preparation.
- Preserve existing private-endpoint/cloud-consent/model-readiness rules and original test deadlines/skips.
- Protocol:64KiB/frame,32digests,3GiB observed aggregate; no inferred overall percentage; explicit success plus metadata admission before Ready.
- Request:2h deadline, zero automatic POST retries, global active DB slot,6starts/minute/client/process; lease30s/heartbeat5s.
- en/tr/de/ru/zh-CN/zh-TW/ar; shared UI/locale/scroll/focus owners,44px actions,phone/200%/RTL/reduced motion.
- Existing bundle limits unchanged. Exclusive UI12KiBraw/4KiBgzip; seven new copy packs32KiBraw/16KiBgzip.
- Preserve dirty primary D:/Agentic-Company-OS; reuse this isolated clean worktree and codex/local-model-preparation branch. Baseline is public verified ea9c571/v0.5.7; do not repeat its release.

## Review Focus

1. Lost start acknowledgements/concurrent clicks: Task2 tests one durable ID and one dispatch, including a changed body and different simultaneous IDs.
2. Changed/unsaved connection and old Ready receipts: Task2 rejects changed revisions and rechecks availability; Task3 covers editing/reopening/deleted upstream model.
3. Hostile or partial progress: Task1 covers invalid UTF-8, split frames, numeric/size bounds, no success, post-success events and raw-error secrecy.
4. API crash, lease loss and restore: Task2 fences stale epochs and interrupts without replay; Task4 proves graceful stop and startup recovery.
5. Interrupted shared-server download: Task2/3 stop only the owned request, retain honest state, and prove explicit retry/check never deletes a model or silently submits a task.

---

### Task 1: Curated recipe and bounded pull protocol

**Files:**

- Create: `artifacts/api-server/src/lib/ollama-preparation-catalog.ts`
- Create: `artifacts/api-server/src/lib/ollama-preparation-protocol.ts`
- Test: `artifacts/api-server/src/lib/ollama-preparation-protocol.test.ts`

**Interfaces:**

- Produces `starterModelRecipe` with exact spec values and fixed official guide links.
- Produces `readOllamaPullProgress(body: ReadableStream<Uint8Array>): AsyncGenerator<OllamaPullProgress>` and `OllamaPreparationProtocolError` with a fixed `code`.
- `OllamaPullProgress` fields/phase are the spec's exact names; no upstream status/error text leaves the reader.

- [ ] Write a first behavior test: split two-layer progress and final success; assert recipe reference/minimum, observed counters and pullComplete, without a Ready field.
- [ ] Run `node --import tsx --test artifacts/api-server/src/lib/ollama-preparation-protocol.test.ts`. Expected: an assertion that progress support is absent; unexpected loader errors must be fixed.
- [ ] Implement the minimum reader and recipe; run the same test. Expected: first happy path passes.
- [ ] Add the Review Focus3 boundary tests, including cancellation/reader release and a regressed counter represented with progressReset. Run them. Expected: new bounds/error-code assertions fail before the guards exist.
- [ ] Implement bounded framing, validation and fixed errors; run the complete protocol file. Expected: all cases pass, no raw error sentinel leaks.
- [ ] Format the new files, run their test file again, inspect diff and commit `feat: add bounded local model preparation protocol`.

### Task 2: Durable authenticated preparation service

**Files:**

- Create: `lib/db/src/schema/local-model-preparations.ts`
- Modify: `lib/db/src/schema/index.ts`, `lib/db/src/generated-sql/meta/_journal.json`
- Create: `lib/db/src/generated-sql/0046_local_model_preparations.sql`, `lib/db/src/migration-0046.test.ts`
- Create: `artifacts/api-server/src/lib/ollama-preparation-store.ts`, `ollama-model-preparation.ts`, `ollama-preparation-transport.ts` and corresponding `.test.ts` files
- Create: `artifacts/api-server/src/routes/settings-model-preparations.ts` and `.test.ts`
- Modify: `artifacts/api-server/src/app.ts`, `runtime-main.ts`
- Modify: `lib/api-spec/openapi.yaml`; regenerate maintained API Zod/client outputs with the repository's existing generator.

**Interfaces:**

- Consumes Task1 recipe/reader. Reuses `readProviderRuntimeConfigSnapshot` and the current private URL validator/model compatibility and runtime identity owners.
- Produces authenticated GET/POST collection, GET by requestId and idempotent POST stop exactly as spec.
- Service exposes `start({requestId, expectedRevision, modelId})`, `snapshot(requestId?)`, `stop(requestId)`, `close()`; every async method returns its narrow typed receipt/DTO. API lifecycle injects the bound runtime handle.

- [ ] Write schema tests for one active slot, ID/body identity, allowed states/counters, and stale owner fencing. Write HTTP/service tests for anonymous denial, invalid model/URL/revision, simultaneous requests, lost acknowledgements, one dispatch, stop, config change, upstream error/EOF and no inference/task writes.
- [ ] Run the owning files with `node --no-wasm-code-gc --import tsx --test --test-concurrency=1 <the new migration/store/service/transport/route test files>`. Expected: missing service/schema assertions fail, not unrelated baseline failures.
- [ ] Add the migration/schema and durable transition methods. Add the private validated POST transport and one API-owned request manager, with lease/heartbeat/throttled progress persistence and no retry/outbox replay.
- [ ] Wire runtime startup reconciliation and ordered shutdown. Test another live API owner is not fenced merely because a second API starts; a fenced old epoch cannot publish Ready.
- [ ] Add OpenAPI contracts and generate clients; preserve safe error codes and absence of raw private fields. Run focused tests and library/API typecheck. Expected: all focused assertions pass and generated contracts typecheck.
- [ ] Verify real PostgreSQL migration constraints with a new owned DB, preserve the source test limits, inspect/format and commit `feat: prepare local models through durable operator requests`.

### Task 3: Guided local setup and seven-language progress

**Files:**

- Modify: `artifacts/agentic-company-os/src/components/studio/guided-model-connection.tsx`
- Create: `components/studio/local-model-preparation.tsx`, `components/studio/local-model-preparation-slot.tsx`
- Create: `lib/local-model-preparation-api.ts`, `lib/local-model-preparation-copy.ts` and seven `lib/local-model-preparation-copy/<locale>.ts` packs, relative to the frontend source root
- Test: `artifacts/agentic-company-os/tests/local-model-preparation.spec.ts`
- Modify: `UX-CONTRACT.md` and the owning bundle-budget verifier/tests for an exclusive feature measurement.

**Interfaces:**

- Consumes Task2 generated request/DTO types through the current customFetch owner; stable request IDs live in memory and durable server receipts, not credential storage.
- `LocalModelPreparation` consumes confirmed provider revision, current catalog availability and parent refresh callback; emits active-state changes for connection mutation locking. It creates no task and does not replace the draft's existing model pin.

- [ ] Write failing browser cases for seven locales/Arabic RTL/phone width, absent server guide, old runtime, download→checking→available, split progress, lost acknowledgement, duplicate clicks, stop/reopen, connection edit/change, missing model after old Ready, and module/locale load failure. Expected: the new entry/control is absent.
- [ ] Implement the lazy inline section within the existing Dialog, using current primitives, one scroller and 44px actions. Add official server installation handoffs and visible estimated bytes/storage ownership.
- [ ] Implement honest progress/error/stop/explicit retry and latest-catalog precedence. Close/reopen preserves the draft and reattaches to the receipt. No automatic start, inference, cloud consent change or unrelated provider save.
- [ ] Author all seven packs and test keyboard/focus/200%/reduced motion. Run the new UI file with two workers and no retries. Expected: all specified cases pass with no hidden fallback.
- [ ] Measure only exclusive new modules/packs under the spec caps. Run unchanged existing bundle gates and affected connection/start UI tests; format and commit `feat: guide the first local model download in seven languages`.

### Task 4: Real first-result and compatibility verification

**Files:**

- Create: `scripts/src/testing/local-model-preparation-smoke.ts` and `.test.ts`
- Modify: relevant source/native guided smoke harnesses for controlled preparation routes without a paid call
- Modify: `docs/local-models.md`, `docs/self-hosting.md`, English/Turkish/German/Russian/Chinese/Arabic README variants where the first-model instructions live

**Interfaces:**

- Consumes Task2 operator routes and Task3 real UI. Outputs a finite proof identifying exact source/archive/runtime/model digest, transfer scope, completed task, restart/backup and cleanup.

- [ ] Write failing harness assertions for API shutdown/interrupted recovery, model missing after restore, and preservation of first-job draft/locale while preparation runs.
- [ ] Exercise all seven UI locales through the actual API/DB/workers with a controlled private Ollama peer. Expected: no preparation inference, correct single dispatch/receipt and a separate explicit first job succeeds.
- [ ] Separately run the actual Ollama API into a new empty owned model store using the verified official runtime, then complete a real local model task. Do not substitute the v0.5.7 proof or call a cached-only run cold. Preserve receipts and clean up only owned processes.
- [ ] Update factual installation instructions, original peer-vs-real evidence boundaries and stop/retry/storage limits. Run focused smoke/connection/privacy suites, build/types/format/license/audit/budgets. Expected: no new failure/skip or gate relaxation; commit verified fixes/docs.

### Task 5: Reviewed original gates and public release

**Files:** existing release/provenance, native/distribution and public readback owners; no verifier relaxation.

**Interfaces:** consumes completed code and Task4 evidence; produces an exact-main versioned release, public byte readbacks and a concise cycle record. v0.5.7 is immutable.

- [ ] Request one fresh whole-branch review. Resolve material findings with demonstrated red→green regressions and keep the spec/plan ledger consistent.
- [ ] Bump the next release version and send a focused PR. Require original source/UI/security/native/platform checks; inspect failures and preserve evidence. Expected: all required original gates accepted on the final head.
- [ ] Merge ordinarily, requalify actual main with matching attested verifier runtime, qualify native archives and genuine first-work proof, then dispatch/verify distribution once. No paid provider, human login or production data is required for acceptance.
- [ ] Prepare privacy-safe assets, publish once, anonymously re-download every asset/archive, deploy/read back Pages and run a final independent audit. Expected: exact published bytes and source identities accepted; scoped limitations stated.
- [ ] Record benefit, evidence, limits and next discovery. Keep broad Goal7 active; do not equate one release with completion of continuous improvement.
