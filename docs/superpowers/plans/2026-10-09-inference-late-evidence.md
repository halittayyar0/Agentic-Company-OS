# Late response evidence implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this
> plan task by task. The full accounting feature remains one release scope.

**Goal:** Account verified late response usage without resending inference or
modifying the original immutable receipt.

**Architecture:** Invocation-owned transport observations enter an immutable,
unique evidence journal. Atomic recovery and one effective usage view let all
readers observe the same validated correction before the accounting fence clears.

**Tech stack:** TypeScript, Drizzle/PostgreSQL/PGlite, existing OpenAI-compatible
and ChatGPT transports, node:test and Playwright; Node24/pnpm10.

**Spec:** `docs/superpowers/specs/2026-10-09-inference-late-evidence-design.md`

## Global constraints

- No paid calls, real credentials, extra authentication, blanket reset or replay.
- Preserve original immutable receipt, original usage time, task/error authority.
- Native Codex and historical receipts remain unchanged.
- All seven locales and existing numeric bundle ceilings remain required.
- Do not publish the owner/journal foundation separately as complete recovery.

## Review focus

- SDK resolves after deadline; callback persists truth but cannot revive output.
- Partial/oversized/conflicting counters cannot silently become reported zero.
- Lost commit acknowledgement cannot create duplicate evidence or inference.
- Corrected usage must not move into a later cycle/day or double-count tokens.
- Missing legacy invocation identity cannot authorize manufactured recovery.

## Task 1: Persist invocation-owned observations

Files: `lib/db/src/schema/inference-attempts.ts`, new
`inference-response-evidence.ts`, schema exports and generated migration;
`lib/ai-server/src/openrouter.ts`, `chatgpt-plan-responses.ts` (request whitelist
and inside-deadline observation) and focused transport tests;
`artifacts/api-server/src/lib/orchestrator/inference-accounting.ts`, new
`inference-response-evidence.ts` and its test.

Interface: optional `UnifiedChatCompletionParams.onResponseUsage(evidence)`;
call-local evidence contains provider, requested model, responseId and raw usage.
`recordInferenceResponseEvidence(attemptId, invocationOwnerId, evidence)` checks
dispatch/owner/route and persists exactly one full usage observation.

- [ ] Write/run RED mismatch, owner/route/dispatch/duplicate/conflict/bounds tests.
- [ ] Add owner metadata and journal schema; generate reviewed migration.
- [ ] Implement exact idempotent evidence writer and wire call-local observer.
- [ ] Commit durable conflict poison before throwing; exact retries/restarts
      cannot erase poison or authorize clearing.
- [ ] Add real loopback SDK deadline/late-response proof without model charges.
- [ ] Run owned PostgreSQL proof, targeted tests, typecheck/format/secret scan.
- [ ] Independent bounded review; retain fence and docs until Task2 is complete.

## Task 2: Atomic correction and effective usage

Files: database effective view schema/migration; settlement writer; usage status;
family/task admission; org usage; operations sampler/read model. Writers remain
on `usage_events`; no raw receipt is edited.

- [ ] Write/run RED late evidence plus original unknown receipt, every reader,
      original-cycle/day timestamps, duplicate/lost-ack/race and numeric-denial cases.
- [ ] Implement original-receipt/evidence comparison and effective view.
- [ ] Pin componentwise non-shrink, known dollars and settlement-first /
      recovery-first / evidence-before-original / lost-ack monotone schedules.
- [ ] Update all usage/coverage/budget readers before clearing the marker.
- [ ] Overlay historical sampled-bucket usage at its original time; preserve
      health/outage facts and do not count failed billing receipts as success.
- [ ] Preserve failed caller/task/tool/approval state and primary errors.
- [ ] Test real PostgreSQL lock ordering and restart/concurrent workers.
- [ ] Independent review of all readers, provenance and atomic clearing.

## Task 3: Complete accepted feature and publication gates

- [ ] Migrate remaining successful synthetic provider fixtures to dispatch hooks.
- [ ] Verify chat/task/judge/company/project entry failures and ownership loss.
- [ ] Update seven-language UI/API/docs for inspected verified correction;
      read-only inspection performs no inference/write/replay.
- [ ] Full monorepo tests/build/format/audits/secrets/browser/bundle gates.
- [ ] Commit/push complete accounting feature; run required remote checks.
- [ ] Independently resolve current Windows gate; merge only all required green.
- [ ] Verify actual main CI/distribution and anonymous artifact behavior.

No checkbox substitutes for executable evidence. Previous bounded proofs and
historical failures remain recorded separately; no whole-feature acceptance yet.
