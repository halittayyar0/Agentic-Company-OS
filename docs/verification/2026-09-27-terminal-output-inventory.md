# Terminal and tool output localization inventory

Status: historical pre-implementation inventory, captured while authored-instruction release gates ran. Executor and operator-protocol work has since been implemented; see the [current Terminal checkpoint](2026-09-27-terminal-output-locales.md). The producers below describe the original gap. Autonomous propagation, remaining generated output and the full feature review/gates are still open; this is not a localization-completion claim.

## Confirmed reachable producers

- `artifacts/api-server/src/lib/vm/sandbox.ts`: built-in help and usage, empty-directory text, write/delete summaries, command allowlist/process-execution failures, path-policy errors, pending-command cancellation, process timeout/stop notes, and application-authored host/sudo diagnostics. The same executor serves the operator Terminal and autonomous tools.
- `artifacts/api-server/src/routes/operator-mutations.ts`: the authenticated `/agents/:agentId/vm/exec` route validates `ExecVmCommandBody`, reserves a durable operator request using `{ command, as }`, and calls `execInSandbox` or `execFounderShell` with the existing effect guard. Stored results are replayed, not re-executed. The route also authors recorded activity/recovery text in English; frontend recovery codes already have seven-language labels.
- `artifacts/api-server/src/lib/orchestrator/execute-tool.ts`: `vmRunCommand` and approved sudo wrap results with application-authored Turkish permission, approval, dispatch and result text. `ToolRuntimeContext` currently has no language field. Other tool handlers in this file need a later systematic message inventory; translating the Terminal executor alone cannot close every tool-output gap.
- `artifacts/api-server/src/lib/orchestrator/run-agent-turn.ts`: the outer chat turn already has its selected language, but its `runTool` context omits it. Tool activity labels and decision records also contain Turkish. Task and approved-action callers must be traced before changing the shared context contract.
- `artifacts/agentic-company-os/src/lib/terminal-session.ts`: records contain command, mode, request ID, start time and optional `protocolVersion: 1`; exact equality and strict parsing do not include a locale. Existing v1/no-version records must retain their recovery semantics.
- `lib/api-spec/openapi.yaml`: `VmExecInput` has no execution locale. Generated schemas, strict HTTP validation and terminal submission must change together if an optional locale is introduced.

## Design constraints for implementation

1. Localize only application-authored prose. Preserve exact command text, paths, IDs, file contents, external stdout/stderr, recorded receipts and existing redaction behavior. Keep outcome and machine-note codes stable; never infer success from translated text.
2. Resolve one execution language before queueing/dispatch and use it throughout that command. Never reread workspace language partway through asynchronous work. Operator submission should send its reviewed language explicitly; autonomous callers should pass the outer turn/step language.
3. Include an explicitly supplied locale in new durable request identity, but preserve the historical `{ command, as }` hash when locale was omitted. Invalid locale must fail before reservation or effects. Same-ID changed-locale input must conflict; replay returns the original recorded bytes.
4. Version the browser intent format if locale is added. Preserve old records, use their original protocol for lookup, retain exact raw-record comparison before any write, and include locale in new-record equality. Never convert an old uncertain command into a new executable request.
5. Typed copy keys/parameters can separate application-owned error prose from external errors. Preserve existing exception classes, filesystem locks, approval hashes, capability consumption, invocation leases, emergency-stop epochs and effect hooks. Formatting must not introduce a side effect or cross an effect boundary.
6. Host/sudo stdout remains source output. A translated explanation must never weaken the existing explicit opt-in and exact-command approval rules or advertise the builtin command allowlist as host isolation.

## Required evidence

- All seven copies, Chinese script distinction, parameter preservation and unchanged authority/outcome codes.
- Builtin help/usage/success/error output in every locale; exact Unicode/whitespace for echo/file reads and external output; stable language while a queued command waits.
- Actual HTTP durable request acceptance/replay/conflict with explicit locale and legacy omitted-locale compatibility, including lost response and record recovery.
- Browser stored-intent migration/parsing, selected-language dispatch, changing language during an uncertain request, exact retained-record guards, and RTL/phone output readability.
- Existing filesystem/effect/approval/process-stop tests plus one fresh integrated review and full release gates. Native PostgreSQL/host topology and real-device proof remain distinct.

## Still separate Goal 7 work

Other application-authored tool/activity messages, older-history browsing and the final route/accessibility audit remain required. This inventory does not turn those tasks into environment exclusions. Native speakers, real phone HTTPS, native PostgreSQL/Docker, secret/history scanning, a clean candidate and actual 24-hour acceptance retain their existing status in the release audit.
