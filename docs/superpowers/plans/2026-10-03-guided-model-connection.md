# Guided model connection implementation plan

> **For agentic workers:** Use superpowers:executing-plans for native execution,
> then one fresh reviewer for the whole branch. Steps use checkbox tracking.

**Goal:** Preserve the first useful job while connecting local models or an
eligible ChatGPT account, and govern optional Codex coding execution.

**Architecture:** Extend existing provider revisions and task ownership. Add
protected registration storage and a separate Responses transport; optional
Codex children retain our runtime's authority.

**Tech stack:** Node 24, TypeScript, Express, PostgreSQL/Drizzle, React, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-guided-model-connection-design.md`

## Global constraints

- Windows/macOS/Linux and combined/split/container installations.
- tr/en/de/ru/zh-CN/zh-TW/ar, Arabic RTL, 320px layout, 44px phone actions.
- No human credentials, paid inference or unsolicited model downloads in tests.
- Selected providers remain authoritative; no silent paid fallback.
- Preserve v0.3.13 proof checkout at fa406f22b5e4c78efcff56aaa31c69bf15dcfd97.
- Do not publish individual incomplete tasks as the full connection feature.

## Review focus

1. Environment-backed connections remain after a null Settings edit (Task 1).
2. Browser and OAuth listener run on different computers (Task 3/5).
3. API and workers refresh a rotating token concurrently (Task 2).
4. Partial output has reported usage but fails before completion (Task 4).
5. Malformed saved draft competes with current editable input (Task 5).

### Task 1: Persistent local-model configuration

**Files:** `artifacts/api-server/src/lib/runtime-config.ts`,
`provider-runtime-config.ts`, `provider-bootstrap.ts`,
`artifacts/api-server/src/routes/settings.ts`, `lib/api-spec/openapi.yaml`,
their existing tests and generated client schemas.

**Interfaces:** RuntimeConfig gains optional `ollamaBaseUrl: string|null`;
the existing revision methods keep their current signatures. Reuse exported
`validateOllamaBaseUrl` and `configureOllama`.

- [ ] Add failing storage/route/bootstrap tests for canonical private address,
      invalid URL rejection before writes, null/environment restore, stale revision,
      and split worker application before any provider request.
- [ ] Run the focused tests and record the missing-field/route failure.
- [ ] Normalize and persist the endpoint, apply it during bootstrap and guarded
      revisions, and extend strict PUT settings plus public status schema.
- [ ] Regenerate API outputs; rerun focused tests and typechecks. Commit.

### Task 2: Protected renewable registration storage

**Create:** `lib/ai-server/src/chatgpt-plan-types.ts`,
`artifacts/api-server/src/lib/chatgpt-registration-store.ts`,
`chatgpt-registration-store.test.ts`, and an owner-private storage helper factored
from `scripts/src/setup/resources.ts`; add registration/lock tables and migrations
under `lib/db` following its current migration conventions.

**Interfaces:** `ChatGPTRegistration` is backend-only hostId/clientId/accountId,
grants, expiry/refresh timing, encrypted access/refresh token and revision.
`readRegistration()`, `replaceRegistration(expectedRevision, registration)` and
`withRegistrationRefreshLock(registrationId, action)` return no browser secrets.

- [ ] RED tests: Windows/Unix protection failure, corrupt ciphertext, replacement
      conflict, two concurrent refresh owners, stale rotation and equal-email accounts.
- [ ] Implement protected atomic storage and durable transactional lock/CAS.
      Preserve valid old credentials on unconfirmed replacement.
- [ ] GREEN tests plus real PostgreSQL concurrent owner verification; commit.

### Task 3: Official sign-in and server handoff

**Create:** backend `chatgpt-sign-in.ts`, `chatgpt-sign-in.test.ts`, route
`chatgpt-connection.ts`, and `scripts/src/connect-chatgpt.ts`; extend API schema.

**Interfaces:** `beginSignIn()` returns attemptId, authorizeUrl and expiry only;
`cancelSignIn(attemptId)`, `readSignInStatus(attemptId)` and
`confirmAccount(attemptId, expectedRevision)` consume validated backend attempts.
CLI secure handoff imports one selected protected registration, no HTTP upload.

- [ ] RED local HTTP fixtures for PKCE/state/nonce, exact callback, issuer/audience/
      signature, replay, cancelled/expired attempt, identity-only grants, wrong client
      ID, denied consent, temporary failure and account-switch preservation.
- [ ] Implement bounded loopback listener, official registration/token validation,
      account confirmation, refresh/revocation distinctions and target-host CLI flow.
- [ ] GREEN offline end-to-end sign-in/refresh fixtures and generated types;
      no real human authentication. Commit.

### Task 4: Responses transport and governed coding child

**Create:** `lib/ai-server/src/chatgpt-plan-responses.ts` and tests;
API runtime `codex-task-adapter.ts` and tests. **Modify:** provider catalog/router,
`orchestrator/run-agent-turn.ts`, usage recording and delivery normalization.

**Interfaces:** Plan completion uses the existing normalized completion contract
with reported failure usage retained separately. `PlanInferenceError` contains
sanitized kind and optional actual usage, never tokens/URLs with secrets.
Codex adapter consumes current attempt/lease, workspace, permissions, signal and
registration revision, and returns a terminal runtime result with proof scope.

- [ ] RED streamed fixtures for function-call IDs/history, unsupported controls,
      terminal completion, partial quota/error, EOF, timeout/cancellation and absent
      usage; assert no paid route called and no failure becomes task success.
- [ ] Implement account model discovery and Responses adapter, usage ledger on
      failed calls, unknown cost and bounded recovery without silent provider change.
- [ ] RED Codex JSON-RPC child fixtures for initialize/thread/turn, approval fence,
      lost lease, wrong account revision, crash and interrupted turn.
- [ ] Implement optional child adapter with isolated auth/config, bounded/redacted
      logs and platform-safe owned process cleanup. Verify tests, types and commit.

### Task 5: Guided connection with draft continuity

**Create:** UI focused connection component and versioned tab draft helper/tests.
**Modify:** Home, New project, Settings, first-run flow and seven lazy copy packs;
add actual rendered tests under `tests/ui` using current fixture conventions.

**Interfaces:** Connection UI consumes public provider/sign-in status only.
Draft contains bounded text/mode/title/priority/type/cadence plus schema version,
never credentials. Composer owns submission; connection callback only refreshes.

- [ ] RED browser tests for navigating/closing/denied consent, malformed draft,
      failed storage, locale change, focus restoration and zero submissions before
      explicit Start. Include server/phone handoff guidance and environment restore.
- [ ] Implement in-place local/ChatGPT/API connection choices, preserve composer
      context and make discovered/connected/tested/limited states understandable.
- [ ] GREEN seven-locale keyboard, 320/390px, desktop and RTL tests; verify reduced
      motion, API contracts and bundle budget. Commit.

### Task 6: Integrated review and release

- [ ] Update English README, authored locale guides, architecture/security and
      changelog with actual support and human/live-call limits.
- [ ] Run existing verify/platform gates and meaningful integrated real-database
      fixture tests. Fix concrete failures; do not repeat optional broad testing.
- [ ] One fresh whole-branch reviewer checks the spec, permissions, credential
      storage, interrupted streams, draft continuity and generated contracts.
- [ ] Push/PR, attach PR, accept required exact-head checks, merge and publish only
      when the whole feature works. Validate public installer/image/source anonymously.
- [ ] Keep 24h native evidence independent and honest; short proof is not 24h.

Self-review: every spec subsystem maps to one task above; every Review focus line
has an explicit acceptance owner. Product code has not been implemented at plan
creation. Standing human instructions select autonomous native implementation.
