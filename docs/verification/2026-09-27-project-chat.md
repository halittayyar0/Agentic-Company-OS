# Project conversation checkpoint — 2026-09-27

Goal 7 remains active. This work migrates Project Studio conversation to durable request recovery and the selected-language conversation interface. The surrounding project detail, workbench, meetings, project/global Operations, authored playbooks, additional API/provider messages and durable Browser/Terminal operator receipts remain outstanding.

## Changes and design review

- Apple HIG principles apply to this web interface: `entering-data.md › Best practices` says “Be clear about the data you need,” informing visible labels and validation; `scroll-views.md › Best practices` informs retained reading position and explicit newer-message navigation; `generative-ai.md › Outputs` recommends “specific, reassuring feedback,” implemented through observed send receipts. This is a functional workspace, with project identity above conversation, semantic light/dark colors and restrained controls.
- The fixed Turkish project composer is replaced with the shared seven-language conversation surface. Both Chinese variants and Arabic RTL are included. Messages, names, code and model identifiers retain their source language. The coordinator's tool permissions and approvals remain authoritative; a conversation filter is not an execution sandbox.
- A project conversation has one request type. Its history, outbox, draft and validation use both coordinator and project identity. History uses 50-message pages and a 500-message display ceiling; older-message reading does not jump on refresh. Drafts survive reload in this browser tab. Enter inserts a line and Ctrl/Command+Enter submits outside composition. Inputs are 16px with 44px action targets.
- Both expert and project composition use ValidatedForm, React Hook Form and Zod. Invalid submit focuses the associated field. Recovery uses AlertDialog, an explicit acknowledgement and Cancel as initial focus. A pending record stays available after response loss, reload, stop or archive; GET recovery does not dispatch work. A missing receipt can be recovered only by explicitly resending the exact original identity and payload. Unknown outcomes require review; clearing a tab record cannot cancel server effects.
- `taskId` is accepted only for durable `ask` requests, included in the receipt and hash domain, and checked again under the runtime/agent/project admission locks. The admitted project snapshot supplies context. Changed ownership rejects before a message or provider call. Project deletion cannot make an existing identity executable again. Historical direct-request hashes keep their original encoding. No schema migration or new dependency is needed.
- A stale client completion cannot remove a newer local send identity. Inactive/unmounted views cannot start a send. The project view omits expert-wide activity that could otherwise be mistaken for project evidence.
- Project conversation now uses the coordinator's saved automatic/manual model selection. The manual model is carried in the saved intent and survives recovery; only the returned receipt is described as the observed model.

## Verification results

The complete `pnpm run verify` gate exited successfully against the final implementation:

- Root suite: 800 tests, 795 passed, zero failed and five explicitly skipped (529.3 seconds).
- Production Chromium suite: all 238 cases passed (7.3 minutes), including the seven project-language recovery cases, saved manual-model selection and leaving the view during asynchronous validation without dispatching a message.
- PGlite migrations, workspace type checking and production builds passed.
- Dependency audit reported no known vulnerabilities; the license policy passed. This is the configured audit result, not proof that the software has no vulnerabilities.
- The bundle gate passed with 356.4 KiB gzip for code plus one language per localized surface; the 368,000-byte limit was unchanged.
- Two consecutive API-generation runs produced the same 224 generated files byte for byte, with no changes between runs.
- The final repository-wide formatting check and `git diff --check` passed after the implementation and report updates.

The five root skips are the four native PostgreSQL cases (competing worker advisory ownership, receipt/browser affinity and reconciliation across adapters, task lease heartbeat/recovery lock ordering, and workspace writer locking) plus Windows symlink creation denied with EPERM. They are not counted as passes.

The initial focused server run passed 18 tests (durable requests and legacy project filtering); the final durable-request run passed 17, including historical direct-request hash compatibility. Frontend helper tests passed six. The first production-browser run passed all 31 focused cases. Final English dark desktop (1365 × 950) and Arabic light phone (320 × 844) header/composer captures were inspected: conversation labels, source content, recovery result and controls remain readable, with no horizontal overflow. Surrounding Turkish workbench tabs visible in the English capture are explicitly outstanding.

Regression evidence includes the expected first failures for unsupported project scope and frontend scope validation. A transient formatter file-open error was retried successfully; a test's `response.json()` needed explicit type narrowing before workspace type checking passed. No unresolved failure is being counted as a pass.

Evidence includes `%TEMP%/acos-project-chat-verify.log`, `acos-project-chat-backend-red.log`, `acos-project-chat-backend-green.log`, `acos-project-chat-backend-final.log`, `acos-project-chat-helper-red.log`, `acos-project-chat-helper-green.log`, `acos-project-chat-types.log`, `acos-project-chat-ui-first.log`, `acos-project-chat-codegen-stability.json`, `test-results/project-chat-first/` and the final Project Studio captures in `test-results/ui-release-smoke/`. Temporary/ignored files are local evidence, not portable release attestations.

## Limits

Read-only follow-up for the next project-page pass found concrete remaining work: `pages/tasks/detail.tsx` drops loaded project content on a failed refresh, its cancel confirmation closes before settlement and its failure toast asserts that nothing changed. `blocked-task-resume.tsx` still uses a local-only draft and the legacy resume route does not bind the answer to an exact reviewed question/version. Workbench labels and directional tab navigation also remain to be localized/reviewed. These findings are not fixed or covered by the conversation evidence above.

Tests inject provider behavior and browser API fixtures; no paid model call was made. PGlite checks transaction and receipt behavior within one process, not native PostgreSQL replica races. No new physical-phone, Safari, native IME, screen-reader, native-speaker, Docker, POSIX or real 24-hour evidence is claimed. Browser storage is not a cross-device outbox. Conversation history/outboxes are not automatically transferred to a new coordinator. Nothing was installed, committed or published.
