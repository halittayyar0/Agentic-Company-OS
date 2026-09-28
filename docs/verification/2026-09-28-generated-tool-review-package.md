# Remaining generated-tool output: integrated review package

## Review target

Workspace: `D:/Agentic-Company-OS`, branch `codex/oss-operator-recovery`.
Base and current HEAD: `81151c63e4bbf35fad39256566b3e362fb3325d0`. The implementation is deliberately uncommitted among substantial existing Goal 7 WIP. A HEAD-to-HEAD diff is empty and is **not** the review target. Review current files, both tracked changes and untracked source; do not stage, commit, reset, clean, create worktrees or modify anything.

The user requires a verified open-source candidate, all seven languages, durable agent/task/tool behavior and private phone access. This particular feature completes the remaining generated-tool output after the separate Terminal checkpoint. Full Goal 7 stays open for bounded history, final route acceptance and external evidence. Review the integrated behavior, not only newly added text or nominal test counts.

## Requirements and rulings

- Spec: `docs/superpowers/specs/2026-09-27-generated-tool-locales.md`.
- Plan and execution ledger: `docs/superpowers/plans/2026-09-27-generated-tool-locales.md`; read every `Ruling:` and the Task 4 checkpoint records.
- Evidence: `docs/verification/2026-09-28-tool-recovery-locales.md`.
- Full release status: `docs/verification/2026-09-27-release-readiness.md`.
- Review protocol: Superpowers 6.4.2, `requesting-code-review/code-reviewer.md`; the applicable review scope and exact checklist are reproduced below.

### Review focus (verbatim from plan)

1. Malformed JSON field types must not coerce into filesystem/browser/team effects; each owning task adds actual executor no-effect cases.
2. Locale changes while queued or after a crash must not change authority or overwrite historical source; Tasks 1 and 4 add captured/recovery cases.
3. A localized denial must not become success through `empty()` prefix inference; each domain verifies explicit outcomes and unchanged state.
4. Nested placeholder text, Unicode and whitespace in paths, page data and operator notes must remain literal; Tasks 1–3 include original source fixtures.
5. Telemetry/finalization failures after an effect must remain uncertain, never invite automatic repetition; Task 4 exercises wrapper and recovery paths.

## Implementation navigation

Server directory: `artifacts/api-server/src/lib/orchestrator/`.

- `tool-copy.ts`, `tool-localization.ts`, `tool-locales/*.ts`: 296 typed messages per language, full key/placeholder parity and one-pass literal substitution.
- `tool-presentation.ts`: bounded seven-value language evidence for 22 explicitly supported production tools, outside authority identities.
- `execute-tool.ts`: remaining 20 direct handlers and two existing Terminal handlers; explicit outcomes, strict JSON types, activity/source bounds, task lifecycle intents, first-language approved actions and outcome-unknown finalization.
- `operation-receipts.ts`: reservation, safe retries, transactional callbacks/finalization, immutable completion, recovery and reconciliation; authority/ownership/atomicity guards retained. Private diagnostics stay outside public projections.
- `step-task.ts`, `run-agent-turn.ts`, `exclusive-turn-policy.ts`, `tool-loop-policy.ts`: captured turn locale, translated new status/failure/retry/continuation/scope output; policy evaluators and durable identity unchanged.
- Related boundaries: `../vm/browser.ts`, `../vm/sandbox.ts`, `computer-session.ts`, `../vm/terminal-localization.ts`, `../audit-redaction.ts`, `../operations/operations-read-model.ts`. Resolve actual nearby filenames when needed; never infer an absent file from this navigation list.
- Tests: the `*-tool-locales.test.ts`, `tool-recovery-locales.test.ts`, `agent-status-locales.test.ts`, `approved-browser-locales.test.ts`, `tool-localization.test.ts`, receipt/crash/approved-action/identity/lifecycle/lease/boundary suites in that directory. Tests use actual local PGlite/filesystem/Chromium; provider responses and specific database failures are controlled fixtures. Native PostgreSQL remains an external gate.

Frontend directory: `artifacts/agentic-company-os/src/`.

- `lib/activity-summary.ts`, `components/activity-summary.tsx`, `lib/i18n.ts`, `lib/shell-copy/*.ts`: twelve known Operations labels via existing lazy shell packs. Only typed schema-version-1 operations events translate; arbitrary/unknown source remains literal.
- Consumers: `components/agent/agent-stats.tsx`, `components/chat/chat-panel.tsx`, `components/computer/computer-workspace.tsx`, `components/studio/project-workbench.tsx`, `components/tasks/run-inspector.tsx`, `components/operations/mission-log.tsx`.
- `lib/run-trace.ts` retains original summary for export and projects a bounded kind separately.
- `components/company/company-comms-dock.tsx` is legacy/unmounted; consistency edit is not route evidence.
- `components/i18n/locale-provider.tsx` has a relative import/React import for real-provider SSR compatibility, without a behavior change.
- Tests: `lib/activity-summary.test.ts`, `lib/run-trace.test.ts`, `components/operations/operations-room-components.test.tsx`, `tests/ui/trace-locales.spec.ts`, `tests/ui/operations-room.spec.ts`.

## Reviewer boundaries

This is the one fresh integrated review required by executing-plans. Do it yourself; do not dispatch another reviewer or subagent. Be read-only. Do not run installers, paid calls, authenticated external effects or mutation tests in this shared checkout. Source inspection and existing test/log evidence are available; any reproduction requiring writes should be proposed to the root agent for the single RED/GREEN repair pass.

Return concrete file:line evidence, severity based on user impact, and a final verdict. List every behavior considered but declined as out of scope, with reasons; silence in the plan does not waive reasonable user expectations. Core internal system prompt language and private technical diagnostics are deliberately excluded from the user-visible translation contract. Bounded history, final route/accessibility acceptance, native environment/real-phone evidence and secret/history scanning remain Goal 7 requirements, not claimed complete by this feature. Do not use those declared pending gates as evidence that the local feature passed.

## Verification before dispatch

The root will append the final focused result once its current runner is terminal. The earlier full Terminal source/Chromium counts predate this feature and must not be treated as current-tree validation. Detailed RED failures and corrected fixtures are in the checkpoint above.

Final pre-review checkpoint: 29-file combined suite **495/495 passed, zero skips, 224.4 seconds**, log `%TEMP%/acos-remaining-tool-feature-focused.log`, session 10089 terminal/collected. Workspace types and full formatting pass; sessions 24976 and 81699 terminal/collected. Task 4 is marked complete in the plan. No product code will change while this review is in flight. Full source and production UI gates follow the single repair pass; none is claimed from these focused counts.
