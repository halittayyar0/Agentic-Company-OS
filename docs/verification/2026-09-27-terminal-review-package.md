# Integrated Terminal localization review package

This is the single fresh integrated review for the Terminal output feature (Tasks 1–3), not another review of the earlier authored-role or operator-recovery features. The checkout contains preserved work predating this feature. Review the current files, including untracked files; a commit-only diff does not contain this implementation.

- Repository: `D:\Agentic-Company-OS`
- Branch: `codex/oss-operator-recovery`
- Existing HEAD: `81151c63e4bbf35fad39256566b3e362fb3325d0`
- Spec: `docs/superpowers/specs/2026-09-27-terminal-output-locales.md`
- Plan and ledger: `docs/superpowers/plans/2026-09-27-terminal-output-locales.md`
- Evidence checkpoint: `docs/verification/2026-09-27-terminal-output-locales.md`

## Implementation surface

- `artifacts/api-server/src/lib/vm/terminal-copy.ts`, `terminal-localization.ts`, `terminal-locales/*.ts`: 104 authored messages in seven locales, bounded one-pass placeholder substitution and invalid-locale rejection.
- `artifacts/api-server/src/lib/vm/sandbox.ts`: captured execution locale across the queue, builtin/path/policy/host/sudo messages and typed metadata on existing errors. File content, commands and process output remain source. Delete behavior and real host/container isolation are described truthfully.
- `artifacts/api-server/src/routes/operator-mutations.ts`, `lib/api-spec/openapi.yaml`, generated API/Zod files: optional explicit operator locale, original omitted-field identity, replay/conflict and founder cwd.
- `artifacts/agentic-company-os/src/lib/terminal-session.ts`, `src/components/vm/terminal-panel.tsx`: strict v2 intents with captured locale, original v1/no-version recovery, equality/race guards and readable Arabic/phone output.
- `artifacts/api-server/src/lib/orchestrator/execute-tool.ts`: outer approved capture; shared Terminal denials; explicit outcomes; command/sudo wrappers and activities; durable replay without rewritten evidence; original raw-output whitespace within preview bounds; localized approved heartbeat and finalization/recovery.
- `run-agent-turn.ts`, `step-task.ts`, `system-prompt.ts`, `tool-loop-policy.ts`, `exclusive-turn-policy.ts`, `computer-session.ts`: shared prompt/tool locale and Terminal-specific outer messages. Existing policy recognition/authority remains unchanged; typed denial reason selects copy.
- `operation-receipts.ts`: optional `executionLocale` is allowed only for Terminal result evidence and only for the seven exact enum values. It never enters capability/argument/operation hashes. Legacy saved rows without it keep their existing finalization summary; new rows recover using their saved locale.

## Review focus

Review the full feature, not only recent autonomous changes. Deliberately check legacy compatibility, queue/race behavior, fixed execution locale, status independent of translated prefixes, scope/permission/stop/effect fences, exact approval identity and single-use consumption, unknown outcomes, raw-source/redaction boundaries, recovery without repeat effects, JSON/locale smuggling, malformed saved intent, browser language switching and Arabic/phone readability. Read code and actual tests; catalog key counts alone cannot prove semantic translation or flow completeness.

Check meaningful error paths and callers beyond the happy path, including interactions with older shared functionality. The spec is a vision document: grade real user impact even for triggers it does not enumerate. List any behavior considered but set aside as “Declined to judge”, with a reason. Do not silently excuse feature gaps.

## Evidence and limitations

The checkpoint lists the observed executor/operator/browser RED→GREEN runs. Latest outer-copy RED observed English/German deferred messages still in Turkish and approved heartbeat reverting to Turkish; the repaired 16-test subset passed. Workspace typecheck passed. The corrected 71-test focused run passed 71/71 with zero skips in 58.7 seconds (`acos-terminal-autonomous-complete-focused-2.log`); its exact session 88964 is terminal and collected. The earlier 69/71 run failed only the legacy completion text assertion and an overbroad new event-count assertion, both corrected without changing product rules. The root will run all applicable full gates after review repairs.

Relevant tests: `terminal-output-locales.test.ts`, `terminal-localization.test.ts`, `vm-terminal-locales.test.ts`, `terminal-session.test.ts`, `tests/ui/computer-locales.spec.ts`, `terminal-tool-locales.test.ts`, `terminal-outer-locales.test.ts`, `execute-tool-durable-effect.test.ts`, `approved-action.test.ts`, `approved-action-recovery.test.ts`, `operation-receipts-crash.test.ts`, existing exclusive/tool-loop and filesystem/recovery tests.

No install, paid provider request, credential change, commit, publication or remote mutation is authorized for the review. Read-only inspection; no worktree/index/HEAD edits, no additional agents, no duplicate full runner. If a focused experiment is necessary, coordinate it with the root first. Native PostgreSQL/Docker, real phone HTTPS, Safari/native input, speaker validation, secret-history scan and real 24-hour evidence remain explicit release gaps. Broader non-Terminal generated messages, history browsing and final route acceptance remain Goal 7 work.
