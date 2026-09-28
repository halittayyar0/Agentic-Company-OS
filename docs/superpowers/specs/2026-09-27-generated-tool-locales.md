# Remaining generated tool output: language contract

## Intent and scope

Goal 7 requires complete user flows in `tr`, `en`, `de`, `ru`, `zh-CN`, `zh-TW`, and `ar`. The verified Terminal work is only part of that contract. Complete app-authored output from the remaining 20 handlers in `execute-tool.ts`, their shared wrappers, approved execution, and chat/task finalization. Keep this feature open until all of those paths are integrated and reviewed once.

The remaining handlers are computer observation; file list/read/write; browser open/snapshot/click/type/scroll/extract/wait/screenshot; and create agent/delegate/update progress/complete task/request approval/request input/log note/company message. Server-authored approval previews and new activity/status explanations are included. Runtime log diagnostics that never reach a user are not translated merely because they are strings.

## Presentation versus evidence

- Capture the validated workspace locale once at each outer execution. A direct legacy call with no locale remains Turkish. Invalid runtime locale values fail closed, without effects.
- Translate only app-authored headings, explanations, units, fallback text, and newly authored activity/status summaries. Machine tool IDs, field names, enum values, hashes, receipts, URL/path literals and browser references remain exact.
- File bytes, extracted page text, model/operator notes, explicit custom instructions, approval arguments and existing history remain source material. Formatting must preserve source whitespace within the existing documented output bounds.
- The message renderer substitutes the authored template once. Placeholder-looking text in a filename or user note is never interpreted as another template.
- Use explicit `ToolExecutionResult.toolOutcome` for every changed return. A translated prefix must never decide success, retry, approval or mutation.

## Durable behavior

New execution presentation metadata is a validated seven-value enum, outside operation/capability hashes and outside source arguments. Persist it before a possible effect when crash recovery needs the original language. Safe retries retain that original locale; replay may render a new explanatory wrapper in the current display language but does not rewrite saved evidence or repeat effects. Legacy rows without locale keep their compatible behavior. Unknown outcomes stay unknown and require the existing reconciliation flow.

Do not broaden arbitrary saved-result fields. Any extension of the existing per-tool result envelope must explicitly allow only this bounded enum for supported production tools and must preserve every existing evidence validation. Synthetic fixtures are not a reason to weaken production envelopes. Read-only tools must remain read-only; transactional tools retain atomic domain writes and receipt finalization.

Existing permission, category, task/agent/worker ownership, approval scope, emergency stop, browser affinity and filesystem lock checks are unchanged. A confirmed malformed-input bug encountered in a changed handler must be reproduced and fixed before that handler is accepted; non-string input must not become an executable path, command or destructive empty file by coercion.

## Implementation shape

Use small typed catalogs alongside the existing Terminal catalog and the established one-pass renderer pattern. Reuse shared typed diagnostics where their actual wording applies. Keep the existing executor structure; no unrelated refactor or dependency is required. The catalog grows by complete domains, with all seven translations in each accepted domain. The source-language audit tracks domains still incomplete rather than claiming a partial catalog completes the product.

## Acceptance

Actual executor tests cover all seven languages, readable output/activity, exact source preservation, explicit rejection, captured locale, durable replay, changed preferences, and relevant permission/ownership/unknown paths. Controlled filesystem and local browser fixtures prove behavior without paid providers or external communication. Existing normalized receipt, approved-action, task and chat tests continue to pass. Integrated browser fixtures inspect affected user-visible output on desktop and phone, including Arabic direction and both themes.

After all domains: one fresh integrated review, repair confirmed findings with observed failing regressions, then full source/Chromium, types/build, format/diff, bundle, dependency audit/license, stable API generation and local migration evidence. Native PostgreSQL/Docker, actual phone HTTPS, Safari/native input/accessibility, speakers, secret/history scan and real 24-hour evidence remain explicitly separate requirements of Goal 7. This feature never authorizes installing software, spending, credentials or publishing.
