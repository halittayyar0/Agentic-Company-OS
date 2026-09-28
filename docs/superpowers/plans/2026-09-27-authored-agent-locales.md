# Authored agent locales implementation plan

> **For agentic workers:** Use superpowers:executing-plans for integrated work. Independent language-only files use superpowers:dispatching-parallel-agents with isolated context and disjoint ownership. Steps use checkbox syntax.

**Goal:** Complete authored role/workforce instructions in seven languages without changing authority or overwriting custom text.

**Architecture:** Pure selected-locale catalogs preserve canonical template structure; API, creation, workforce, seed/runtime and UI consume the same catalog. Existing custom-prompt provenance controls preservation.

**Tech Stack:** Current TypeScript, Zod/OpenAPI, React, Node tests, Playwright; no new dependency.

**Spec:** [Authored agent instructions](../specs/2026-09-27-authored-agent-locales.md).

## Global constraints

- Preserve the existing checkout and all 638 changed paths on `codex/oss-operator-recovery`; no commit/push/publication or installation.
- All seven locales are required; preserve canonical keys, permissions, hierarchy, template/blueprint versions and human approval/evidence rules.
- Preserve custom text and historical source exactly. No provider call or external translation service.
- Do not regenerate clients during source imports or rebuild the UI while its browser suite is active.
- Existing Goal 7 authorizes this implementation; local spec/plan steps document decisions without adding a new approval flow.

## Review focus

- Switching language while a custom instruction draft is edited must not reset it.
- Explicit custom prompt plus template key must never become a managed prompt on restart.
- Seed-before-first-run language selection must still affect future stock turns without rewriting custom records.
- Permission/approval and evidence obligations must remain equivalent in every translation.
- Missing/stale selected-language catalogs cannot silently submit a different-language/default role.

## Task 1 — pure authored catalogs

**Files:** new `artifacts/api-server/src/lib/agent-template-copy.ts`, `agent-template-locales/{en,de,ru,zh-CN,zh-TW,ar}.ts`, `agent-template-localization.ts`, `agent-template-localization.test.ts`.

**Interfaces:** `AgentTemplateCopy` contains `managerRules`, `specialistRules`, all 15 `templates` (`name`, `defaultRole`, `description`, `body`), and `handoff` wrapper strings. `getLocalizedAgentTemplates(locale: WorkspaceLocale): AgentTemplateDefinition[]`; `getLocalizedAgentTemplate(key: string, locale: WorkspaceLocale): AgentTemplateDefinition | undefined`.

- [x] Reproduce missing catalogs with parity, preservation and invalid-input tests. Expected: missing module/function RED.
- [x] Define the immutable copy contract; translate disjoint language pairs in isolated agents, each preserving full original semantics. Root implements selection/cloning and Turkish parity.
- [x] Review returned translations against canonical source, then run focused tests and API types. Expected: complete catalog coverage and structural invariants pass; no claim of native-speaker acceptance.

## Task 2 — API, creation, seed and runtime

**Files:** `routes/agents.ts`, `routes/workforce-blueprints.ts`, `lib/workforce-blueprints.ts`, `lib/seed.ts`, `lib/orchestrator/system-prompt.ts`, `runtime-main.ts`, `lib/api-spec/openapi.yaml`, generated clients/validators and focused route/runtime tests.

- [x] Reproduce omitted/invalid/explicit locale behavior, explicit custom text with a template, first-run stock versus custom runtime selection, workforce replay and permission invariants.
- [x] Integrate pure catalog functions with validated locale and custom provenance. Pass workspace/turn locale at stock seed/runtime boundaries, preserve saved custom text and immutable installation locale.
- [x] Regenerate clients with no dependent source runner; run route/runtime/seed/workforce tests and types. Expected: locale changes do not alter authority or historical requests.

## Task 3 — UI review and creation

**Files:** New expert/profile components, selected-language copy, template query keys and production UI fixtures.

- [x] Reproduce selected-language preview, late/stale catalog, language changes during edited drafts and missing catalog behavior.
- [x] Bind preview/creation to selected locale; preserve custom source and current drafts. Distinguish managed defaults in profile instructions without silently changing edits.
- [x] Run all seven locale fixtures, narrow Arabic/English theme screenshots and keyboard controls. Expected: exact request locale/custom bytes and recoverable catalog failure.

## Task 4 — integrated review and gates

- [x] One fresh integrated review; re-grade findings by user effect, repair Important/Critical once with observed RED-to-GREEN regressions, record remaining limits.
- [x] Full source/UI, production build/types, format/diff, audit/licenses, bundle, stable API generation and clean migration; record native/device/speaker gaps.
- [x] Update localization/public contracts and broad release audit without shrinking Goal 7.

## Ledger

Pre-flight: Task 1 defines the copy contract consumed by the Task 2 protocol/runtime and Task 3 preview. Freeze this contract before parallel translation. Tasks 2 and 3 must use the same explicit locale and selected-language query key. Source catalog remains the authority for permission fields; translations cannot supply permissions.

Execution ruling: apply the existing goal authorization to reversible local implementation; keep shared production changes in the primary agent. The parallel-agent skill explicitly calls for dispatch by independent domain; the six translation files are divided into three disjoint language pairs and have no mutable shared state. One whole-feature reviewer follows integration; there is no per-language implementation reviewer loop.

Previous goal turn: **progress** — operator recovery repairs passed 885 source tests (six environment skips), 363 Chromium scenarios and all applicable local release gates. No test runner or preview remains live. Those results precede this new feature and will not attest subsequent changes.

Current continuation: **progress** — all language-only agents completed their files, and primary comparison of full bodies/shared rules/handoff contracts found no missing evidence or approval requirements. Focused backend coverage passed 17 tests, including persisted first-run workspace language after seeding, all locales/workforce members, authority and exact custom-source preservation. The focused UI integration passed 44 scenarios. A later four-capture visual review identified a clipped active phone tab; its stronger viewport assertion failed, then passed after horizontal reveal/resize handling. The latest run passed 27 authored/setup/onboarding checks including all four phone cases; related creation/profile locale checks are recorded separately. Production UI build and workspace types passed. One fresh integrated reviewer and the full release gates remain pending. See the [focused checkpoint](../../verification/2026-09-27-authored-agent-locales.md). Goal 7 remains active.

Ruling: Keep a language selector inside expert creation/profile screens — changing language must not require leaving an edited form — the cost is one additional native control per surface.

Ruling: Preload shell copy before committing the workspace language, retain the active form, and reject cancelled late loads — otherwise the provider's loading branch unmounts drafts — global shell behavior requires the full browser regression gate.

Ruling: Use reload only for an initial missing surface module before a form exists; during editing, allow returning to the previously loaded language — browsers may retain a failed module import — retrying that language can still require a later reload, but drafts stay available.

Ruling: Let a fresh loaded catalog with no chosen role reach normal field validation, while blocking stale/failed catalogs and invalid selected roles — disabling every unselected form hid actionable validation — authority and managed-prompt language remain guarded at submission.

Ruling: Preserve the Turkish phrase about evidence sources as supporting citations close to claims, with a separate recency requirement — its wording is ambiguous but both obligations are retained — native language acceptance remains open.

Latest phone explanation: private HTTPS browser access is documented with Tailscale Serve and a self-managed VPN alternative. The current official Tailscale sources confirm private tailnet scope and that the free Personal plan is non-commercial. Host and phone installation, DNS/TLS and real mobile-data testing remain unperformed; no software was installed and nothing was published.

Current verification addendum: 21 related creation/profile locale scenarios passed on the same updated build, for 48 distinct focused browser passes across the two final runs. Both runners are terminal. Scoped format/diff checks passed. The fresh integrated reviewer and full-tree release gates are the next feature steps; this checkpoint does not complete Goal 7.

Final review: one fresh read-only reviewer on gpt-6-astra inspected the whole integration and reported two Important findings and one Minor finding. No second review will be dispatched. Important profile recovery handlers were reversed: initial failure could not recover, and failure during editing reloaded away the draft. Both regressions failed on the prior production build (`acos-authored-review-red.log`); handlers were corrected. Important preference writes could arrive out of order and leave the server in an older language: a delayed English request overwrote German in the observed browser regression (`acos-authored-sync-red.log`). Preference writes are now serialized across effect cleanup/remount and obsolete queued selections are skipped. Failed old writes release the queue. Green and full gates follow.

Final: Ruling: the reviewer’s Minor Chinese citation-proximity omission is a missing part of the requested authored instruction translation — restore the short proximity clause in both scripts under Goal 7’s complete-translation scope — no permissions or workflow change; native quality still needs speaker acceptance. This is a reversible copy correction, so developer test guidance rules out an implementation-mirroring new test; the existing catalog/workforce invariants and primary text review are the appropriate verification.

Final: Ruling: unrelated portions of the large WIP remain outside this feature review — the reviewer checked the selected integration and its callers — a final whole-product audit is still required before publication.

Final: Ruling: Terminal/tool output, history and broader route acceptance remain open Goal 7 development work — this feature does not satisfy them — missing those flows would block a complete localization/release claim.

Final: Ruling: full gates and public documents are executor work after review — run them on the repaired implementation and update the audit — earlier focused results cannot prove the final candidate.

Final: Ruling: native speakers, physical devices, native PostgreSQL/Docker and actual 24-hour behavior remain unverified — no applicable environment/evidence is available here — preserve these acceptance gaps without inventing success.

Final: Ruling: actual model compliance remains unverified without provider execution — no paid provider call is authorized for this check — translated instructions are verified as inputs, not guaranteed model behavior.

Final repair evidence: both Important regressions passed after their observed failures; the expanded focused browser suite passed 52/52 and focused backend suite 17/17. Both Chinese citation clauses were corrected. Final repaired-source suite passed 895 with six environment skips and no failures (901 total; 685.5 seconds). Current types/build, bundle, API fingerprint stability, clean PGlite migration, production audit and license policy passed. The full browser run reported 382 passes and one missing-catalog-fixture failure in the legacy release-smoke harness. That harness now returns the localized catalog; no production artifact changed. The full rerun passed 383/383 in 13.4 minutes and exited zero. Do not dispatch a second reviewer or rerun backend gates for this fixture-only correction.

Final continuation: exec session **67943** completed and was collected with exit zero: **383 Chromium scenarios passed in 13.4 minutes**, log `%TEMP%/acos-authored-final-full-ui.log`, output `test-results/authored-final-full/`. All earlier test sessions are terminal. The broad audit and source follow-up now record the final figures. Task 4 is locally complete with explicit external acceptance gaps. Next Goal 7 work is the full Terminal output plan, followed by remaining generated output/history and route acceptance. This turn is **progress**; Goal 7 remains active. These gates predate subsequent Terminal implementation.
