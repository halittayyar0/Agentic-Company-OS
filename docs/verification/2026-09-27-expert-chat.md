# Expert Conversation checkpoint — 27 September 2026

This records the local Windows working tree using Node 24.19.0. Existing work is preserved. Goal 7 remains active. The Expert profile's one-to-one Conversation tab now uses the durable request contract from the [preceding server checkpoint](./2026-09-27-chat-requests.md). Project-scoped chat and the remaining application surfaces are separate work.

## Changes

- Rebuilt the Conversation tab with selected-language packs for Turkish, English, German, Russian, Simplified Chinese, Traditional Chinese and Arabic. The interface distinguishes questions, queued projects and recurring responsibilities. Message bodies, names, model identifiers and activity summaries remain original source content.
- Saves an exact UUID, expert, locale, content, request type, model override and reviewed configuration in tab storage before POST. Storage failure blocks dispatch. GET recovers the receipt after a reload, including during an emergency stop or after archiving. Changing the interface language preserves the original pending payload. A missing receipt offers explicit recovery of that same identity; the client never automatically retries POST.
- Ordinary replies, queued projects and known rejections release the tab's pending record only after a visible render. Rejected text is retained. Late completion in a hidden profile tab keeps its recovery identity. Unknown outcomes and system notices require explicit review before clearing the local pending record; clearing does not cancel or repeat server work.
- Validates receipt identity, message scope, role, original user content, recorded model consistency and project ownership/mode before showing a confirmed result. Damaged local identities fail closed. Upstream error details are not displayed in the recovery UI.
- History loads 50 records per page, at most 500 in one displayed window. Older-page and refresh failures preserve loaded content. New arrivals do not move a reader who is viewing older messages. The latest 12 recorded expert events are explicitly described as potentially belonging to other work; they are not represented as a live trace or proof of completion.
- Uses labeled native request radios, at least 44px controls, visible focus, Enter for newlines and Ctrl/Command+Enter for submission outside IME composition. Arabic uses logical layout properties; source text uses automatic direction and code remains left-to-right. Shared Markdown colors now follow the selected theme, with localized unsafe-link labels supplied by this chat.
- Updated the request, self-hosting and localization guides. The bundle checker accounts for all seven new chat packs while retaining the overall 1,300,000-byte raw and 364,000-byte gzip transfer ceilings.

## Evidence

| Check                                           | Result                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Focused Conversation browser suite              | 17 passed, 0 failed                                                                      |
| Full root test suite                            | 751 total: 747 passed, 4 skipped, 0 failed                                               |
| Full production browser suite                   | 167 passed                                                                               |
| Workspace type checks and production builds     | Passed                                                                                   |
| Database migration chain                        | Passed on process-lifetime PGlite                                                        |
| Formatting, dependency audit and license policy | Passed; no known production dependency vulnerabilities reported                          |
| Selected-language bundle budget                 | 1221.3 KiB raw / 352.4 KiB gzip; passed unchanged overall ceilings                       |
| Combined `pnpm run verify`                      | Passed; exit 0                                                                           |
| Visual review                                   | English desktop dark mode, including the composer, at 1365px; Arabic light mode at 320px |

The four new helper tests cover all seven copy shapes, isolated tab drafts and identities, damaged/unavailable storage, malformed or inconsistent receipts, system outcomes, bounded direct-message history and exact cursors. They are included in the full root totals.

The 17 browser tests use the production build and controlled API fixtures. They cover all three request types in every locale, radio keyboard selection, newline and IME guards, exact source preservation, unsafe links, phone width/RTL, lost responses and read-only recovery, recovery after a locale change, unknown-work review, local storage failure, stale configuration rejection, damaged identities, late hidden-tab responses, a 520-message history with a 500-message display limit, failed older-page and current-history reads, clipboard failure, oversized work, and missing language assets. A queue receipt is checked as queued work rather than completed execution. Existing Expert detail and Project Studio flows passed again in the full browser run after the shared Markdown change.

An exploratory focused run failed because a new fixture initializer retained the test configuration's preloaded Turkish locale. Its error snapshots showed Turkish controls where English and other selected languages were expected. That run was stopped; the fixture now sets its selected language once per tab and preserves intentional later changes. The corrected focused run and the subsequent complete verification both passed. The failed run is not counted as evidence of success.

Logs: `%TEMP%/acos-chat-ui-verified-focused.log` and `%TEMP%/acos-verify-20260927-expert-chat.log`. The stopped exploratory run remains in `%TEMP%/acos-chat-ui-final-focused.log`. Inspected screenshots are under `test-results/chat-verified-focused/`. These local temporary logs and ignored screenshots are not a portable release attestation. API source and generated contracts were not changed in this UI checkpoint; generation stability belongs to the preceding server checkpoint rather than a new generation run here. Final report formatting and diff whitespace were checked after recording results.

## Remaining work and limits

The four root-suite skips are three native PostgreSQL ownership/race/heartbeat checks requiring `DATABASE_URL`, and one Windows file-symlink capability check that returned `EPERM`. PGlite does not establish native PostgreSQL multi-process behavior. `docker`, `psql` and `tailscale` remain unavailable on PATH. Docker topology, live provider execution, a real phone over private HTTPS and a real 24-hour run remain unverified. Automated Chromium viewports and key events are not physical phone, Safari, native IME or screen-reader testing. Native-speaker review is still outstanding.

Tab drafts and pending identities are not shared between devices, and closing the tab may remove them. Server messages, projects and request receipts belong to the shared database. The [phone access guide](../mobile-access.md) continues to use the existing browser UI and private HTTPS; no separate mobile app or mandatory paid hosting service was introduced.

Computer tools, project detail/Studio, global/project Operations, additional API/provider errors and source playbooks remain in Goal 7. The Computer workspace audit found fixed dark styling and Turkish controls; its terminal and file editors also need their own draft, interrupted-response and concurrent-edit review. The direct-chat receipt contract does not automatically protect those operator endpoints or project-scoped conversations. Locales remain partial until the remaining routes and native-language review are complete. Nothing was installed, committed or published in this checkpoint.
