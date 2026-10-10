# Ollama Local Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Implement natively in the current session; one fresh whole-branch review after implementation.

**Goal:** Make local model selection enforce private execution while offering endpoint-bound, explicitly enabled Ollama cloud models.

**Architecture:** Keep saved local IDs local-only and introduce an explicit cloud namespace. Classify discovery, bind cloud consent to a canonical origin through existing revisioned storage, and fence the actual SDK request after durable admission. Extend existing connection/model-selection UI and authored copy.

**Tech Stack:** Node 24, pnpm 10.17.1, TypeScript, OpenAI SDK, Express/Zod, PostgreSQL/PGlite, React, Orval and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-ollama-local-boundary-design.md`

## Global Constraints

- Ollama 0.18.0 is the supported local-selector floor; real pinned released-server verification is required before claiming runtime support.
- Existing `ollama:<upstream>` IDs remain local-only; `ollama-cloud:<upstream>` is explicitly cloud-backed. No task/agent ID migration.
- Missing/unknown locality cannot qualify as local or free. Cloud models never enter automatic local selection/fallback.
- Default cloud consent is off; saved consent names the canonical private origin and never transfers to a different address/environment origin.
- Metadata: 100 models, concurrency four, five-second request deadlines and existing cache/generation fences; no inference on save/discovery.
- Actual transport: exact origin/generation, `redirect: "error"`, host admission callback once, no silent request replay to a different boundary.
- Languages: tr, en, de, ru, zh-CN, zh-TW, ar; Arabic RTL, 44px controls and no overflow at 390px.
- Preserve the dirty primary checkout and PR49 frozen test; use this separate managed worktree. No paid inference, human authentication, secret sharing, test waiver or protection bypass.
- Rebase after accepted PR49 ordinary integration, then run this candidate's complete original release gates and protected publication.

## Review Focus

- A remote alias renamed to a local-looking ID or changed between discovery and dispatch must not leak a local prompt.
- A provider revision changed during `beforeRequest` or an SDK retry must not reuse stale endpoint authority.
- Restoring a runtime address or changing an environment address must not silently retain cloud consent on the new origin.
- Missing/malformed/prerelease version or metadata must give actionable setup state, not local/free eligibility.
- Recurring/resumed work must retain its original local/cloud pin through process restart, catalog refresh and another provider becoming available.

## Task 1: Model classification and enforced SDK transport

**Files:** create `lib/ai-server/src/ollama-model-boundary.ts`, `lib/ai-server/src/ollama-model-boundary.test.ts`, `lib/ai-server/src/ollama-request-boundary.test.ts`; modify `first-party-providers.ts`, `model-router.ts`, `openrouter.ts`, `first-party-providers.test.ts`, `ollama-endpoint-switch.test.ts`, `index.ts` in the same directory.

**Interfaces:** export `OllamaExecutionLocation = "local" | "cloud" | "unknown"`; optional `ModelCatalogEntry.executionLocation`; `OllamaBoundaryError` with static safe code; `OllamaInferenceRequest` containing `origin`, `generation`, `boundary`, `upstreamModel`, `client`; `prepareOllamaInferenceRequest(modelId: string, signal?: AbortSignal): Promise<OllamaInferenceRequest>`; `assertOllamaRequestCurrent(request: OllamaInferenceRequest): void`. Extend `configureOllama` with optional `cloudOrigin: string | null` defaulting to no consent. Export explicit cloud namespace resolver without changing local resolver meaning.

- [ ] Write owned HTTP regression tests reproducing remote alias classification, partial/conflicting metadata, missing/old/prerelease versions, local wire selectors, namespace conflicts, SDK 307 redirects, endpoint changes during admission and retries, and zero completion requests when blocked. Keep a positive local SDK completion fixture.
- [ ] Run `node --import tsx --test lib/ai-server/src/ollama-model-boundary.test.ts lib/ai-server/src/ollama-request-boundary.test.ts`; retain original expected failures before implementation.
- [ ] Implement pure model/version/reference validation and catalog classification. Known cloud rows do not trigger show without matching consent; every Ollama row receives an explicit location and safe display text.
- [ ] Implement snapshot preparation and guarded SDK fetch. Preserve exact admission ordering in `createChatCompletion`; fence configuration after callback and immediately before every fetch, including retries. Reject redirects and keep known local selectors from conflicting with cloud selectors.
- [ ] Update existing owned local fixtures to report the supported version and correct local wire contract. Do not weaken runtime assertions or permit cloud for compatibility.
- [ ] Run the two new suites plus existing first-party and endpoint-switch suites; assert no external destinations, no inference in discovery and owned cleanup. Commit this tested deliverable.

## Task 2: Durable server-bound consent, routing and task outcomes

**Files:** modify `artifacts/api-server/src/lib/{runtime-config,provider-runtime-config,provider-bootstrap}.ts` and their tests; `artifacts/api-server/src/routes/settings.ts` and tests; `artifacts/api-server/src/lib/orchestrator/{model-select,task-retry-policy,step-task,wake-provider-waiting-tasks}.ts` and relevant tests; `lib/api-spec/openapi.yaml` and generated API client/Zod modules.

**Interfaces:** `RuntimeConfig.ollamaCloudOrigin?: string | null`; settings input `ollamaCloudEnabled?: boolean` under existing `expectedRevision`; public Ollama fields `cloudEnabled`, `serverVersion`, `localEnforcementSupported`, `localModelCount`, `cloudModelCount`, `unknownModelCount`; optional public model `executionLocation` enum. Reuse encrypted desired config and acknowledgment; do not add a DB migration.

- [ ] Add failing file/PostgreSQL/revision tests: existing config defaults off; enable binds effective canonical origin; disable clears; changed/restored/environment origin cannot adopt old consent; two writers require exact revision; API and workers apply/acknowledge the same consent; invalid metadata/consent cannot become a confirmed save.
- [ ] Add routing tests: remote/unknown rows never satisfy local auto/free/pinned fallback; a cloud alias ending `:free` is not free; persisted local IDs remain local after alias replacement; manual cloud pins preserve one selected billing boundary; other-provider free pins/task precedence remain intact.
- [ ] Add task tests: boundary/version/consent failures before dispatch invent no usage receipt, produce provider setup state, do not drift to a paid route and keep recurring/resumed IDs intact.
- [ ] Run the targeted tests and retain failure evidence. Implement consent mapping inside the existing serialized revision update, storage validation, bootstrap and split-role application. Carry typed boundary errors into existing task outcome handling.
- [ ] Regenerate with `pnpm --filter @workspace/api-spec codegen`; run `pnpm api:check` if defined (otherwise use the repository's generated-artifact parity command from package scripts), plus targeted runtime/settings/routing/task tests and `pnpm typecheck`. Resolve actual parity failures without editing expected outputs blindly. Commit this tested deliverable.

## Task 3: Honest connection and model choice in seven languages

**Files:** modify `artifacts/agentic-company-os/src/components/studio/guided-model-connection.tsx`, `components/agent/agent-model-picker.tsx`, `components/model-picker.tsx`, applicable provider controls in `pages/settings.tsx`; `lib/connection-copy.ts`, `lib/new-agent-copy.ts`, `lib/settings-copy.ts` and seven authored packs in each directory where the flow needs copy; copy/model search tests; `tests/ui/guided-model-connection.spec.ts` and applicable model-choice UI tests. Confirm actual test filenames before edits.

**Interfaces:** existing settings mutation gains only `ollamaCloudEnabled`; rows consume `executionLocation`. Copy adds equivalent local/cloud/unknown, usage explanation, unsupported version/retry, and endpoint-bound enable/disable labels. Preserve existing unconfirmed-write handling, draft/composer ownership and focus restoration.

- [ ] Add failing seven-locale rendered tests: cloud consent starts off; enabling requires explicit control/save; address edit/restore resets consent; local/cloud/unknown/tool states are separate; cloud aliases are not free; paused/unknown writes cannot authorize another mutation; clear upgrade path; Arabic RTL and 390px no overflow.
- [ ] Use Apple design guidance for clear hierarchy, semantic status, accessible labels and 44px controls. Author translations directly; load one language pack at a time. Preserve existing layout and composer behavior.
- [ ] Run authored-copy checks and targeted seven-locale connection/model-selection tests. Verify keyboard focus and phone-width overflow through real rendered state; no physical-phone claim. Commit this tested deliverable.

## Task 4: Actual released-server privacy proof and full publication

**Files:** create `scripts/src/ollama-local-boundary-smoke.ts` and its relevant safety tests; integrate the bounded owned check into applicable existing native CI gates; add `docs/local-models.md` and README/setup links; update release test counts only from actual complete results.

**Interfaces:** smoke receipt reports exact Ollama version/archive/binary digests, owned model root/alias configuration, local-selector rejection before cloud dispatch, zero inference/cloud requests and actual owned process cleanup. It is distinct from a generated useful outcome, an account test and a 24-hour result.

- [ ] Inventory official pinned 0.18.0 assets and choose a feasible verified runtime on the actual platform. Keep private process home/model directory and loopback listener; do not execute installation scripts or use a person's Ollama identity. Use the complete published archive digest before executing its extracted binary.
- [ ] Write the bounded smoke and verify failure if local enforcement is absent. Run against the actual pinned released server with a synthetic remote alias and no model weights; retain safe receipt and cleanup. Do not claim an unexecuted platform/version case.
- [ ] Document version/update guidance, native/container endpoint choices, explicit server-bound cloud consent, local hardware use and cloud account usage. Link from README; preserve existing open issues and real-account/phone/24h limits.
- [ ] Obtain one fresh whole-branch review per executing-plans; fix findings before publication. No optional implementation agents.
- [ ] Confirm PR49 accepted ordinary main integration, rebase this branch onto its exact main, run applicable complete source/security/typecheck/build/generated/UI/native gates, and publish/attach its own PR.
- [ ] Verify original required candidate contexts/App IDs, actual source/UI/native artifacts and strict candidate admission. Ordinary protected merge, then full original main verification and anonymous exact source readback. Record passed, skipped and unverified scopes and choose the next actual user-value cycle.

## Self-review and execution

All spec sections map to Tasks 1–4. Review Focus cases map to explicit tests in Tasks 1–3. Namespace, consent-origin, snapshot and API field names match across tasks. Current PR49 full-source/CI baselines remain live and must be retained; do not restart them or imply this separate branch has passed its own baseline. Routine choices and native execution use the user's standing authorization; new human authentication, spending or secret sharing remains prohibited.
