# Terminal output in the execution language

Status: accepted for reversible implementation under the existing Goal 7. This implements the next identified localization gap; it does not narrow the release objective.

## User outcome

The operator and agents receive newly generated Terminal help, usage, success and failure explanations in the selected workspace language: Turkish, English, German, Russian, Simplified Chinese, Traditional Chinese or Arabic. Commands, paths, file contents, external process output and historical receipts keep their original bytes and existing redaction/truncation rules. A language change does not rerun a command or rewrite its history.

## Contract

- One execution locale is captured before queueing or dispatch. Direct legacy executor calls default to Turkish. The operator sends an explicit reviewed locale; chat, task and approved-action callers pass their outer execution locale.
- A typed pure catalog supplies app-owned text. Shared filesystem exceptions retain their classes, codes and legacy messages for existing callers, with optional message metadata for selected-language presentation at Terminal boundaries. Native process errors remain source text.
- Help describes builtins separately from optional host processes and the real container/VM boundary. An allowlist must not be described as host isolation. Delete commands retain their existing version/approval review restrictions.
- Result status, outcome, note codes, effect hooks, locks, emergency epochs, permission gates, capability hashes and lease consumption are independent of translated text. Every localized early tool failure explicitly returns a rejected outcome.
- New operator requests include locale in their immutable identity only when explicitly supplied. Omitted-locale legacy payloads retain the exact `{command, as}` hash. Invalid locale is rejected before reservation/effects. A changed locale with the same identity conflicts; exact replay preserves the original result.
- Browser intent version 2 includes locale. Version 1 and no-version records keep their prior recovery behavior. Strict parsing, retained raw-record guards and equality include the new field only for the new version. No uncertain record can become an automatic execution.
- Host/sudo explanations are localized without enabling execution or changing exact-command approvals. Verify the founder route's default working directory: the current omitted directory reaches `getSandboxRoot(0)`, which rejects invalid agent identities. Bind route execution to the actual agent directory with the same effect guards if this path is confirmed.

## Acceptance

Actual executor tests cover every language, app-owned output versus exact source data, queued execution, path errors and host/sudo denials. HTTP tests prove explicit locale, legacy identity/replay, invalid input before effect and changed-locale conflict. Browser tests prove selected locale submission, recovery across language changes, legacy records, damaged/stale storage, phone and RTL readability. Run existing filesystem/process/approval gates, one fresh integrated review of the complete feature, and full applicable release gates afterward.

Other tool/activity output, history browsing and final route acceptance remain separate open implementation work. Native speakers, real-phone HTTPS, native PostgreSQL/Docker and real 24-hour evidence remain unverified.
