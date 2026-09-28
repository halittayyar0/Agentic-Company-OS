# Browser workbench

The browser is the expert's existing remote browser session. Opening this panel only reads it; **Take control** is the explicit allocation/ownership action. The panel shows periodic PNG captures, with their local receipt time. It is not a video stream or proof of a currently running agent action.

## Desktop and phone controls

The toolbar, forms, loading/error states, ownership labels, confirmation and recovery use the selected `tr`, `en`, `de`, `ru`, `zh-CN`, `zh-TW` or `ar` pack. Hostnames, page titles, remote pixels and expert names remain original content. The interface uses semantic light/dark colors, 44px controls and 16px address/text inputs. Arabic reverses interface layout while addresses and the remote image retain their source direction.

Take control, open an HTTP(S) address, and click a field in the image. Compose text in the native text area, then select **Send text**. Enter in this area adds a newline; IME composition does not submit. The 4096 UTF-16-code-unit limit, NUL and incomplete Unicode characters are rejected without truncating a draft. The backend inserts complete text through Playwright `keyboard.insertText`. This does not fabricate keydown/up events; a multiline insertion can produce more than one browser input event. Sites that depend on physical keyboard events may behave differently.

Visible controls send remote Tab, Shift+Tab, Enter, Backspace, Escape, arrows, browser history, reload and scroll. Tab on the image remains local keyboard navigation, preventing a focus trap. Click/double-click targets account for letterboxing and clamp to the last real pixel. The **Actual image size** option gives the image its original dimensions inside a bounded scrolling region, so phone users can read and pan the page without widening the document. Full screen includes the controls and has a visible exit. Desktop text entry uses the same explicit composer; passive pointer movement and local wheel scrolling do not enqueue remote actions.

The remote screenshot is not an accessible DOM representation of a third-party page. Native phone IME, physical phones, Safari and screen-reader behavior still require direct testing. Private HTTPS phone access uses the existing web application; see [mobile access](./mobile-access.md). No separate application or mandatory paid host is introduced.

## Authority and admission

The private lease stays in memory. Public observations never expose it in the interface or recovery record. A changed public expiry can be the operator's own input renewal; it does not prove a change of owner. Exact private heartbeats and server admission control authority. Inputs and navigation require an existing session and exact lease; a stale input cannot allocate another browser. Closing requires explicit confirmation and the current lease. A stale lease cannot downgrade itself to permission to close a later agent-owned session.

The API and worker check persisted emergency stop before browser acquisition/navigation/input, and the persisted runtime version and exact request owner fence queued actions across a stop/resume transition at the actual worker effect. Reads and release remain available for inspection and cleanup. Unmounting, hiding the page or leaving the tool prevents new dispatch; an acknowledged late takeover is released using its captured lease. Cleanup waits for this tab's dispatched request before attempting release, with expiration as the fallback. A client timeout does not cancel a server or external effect.

## One outstanding request and recovery

This tab sends one browser mutation at a time. Further events are not queued for later replay. Before dispatch it writes metadata under `acos.browser-request.v1.<agentId>` in `sessionStorage`: UUID, expert ID, action category, start time, `protocolVersion: 1` and pending/unknown state. Text, addresses, screenshots and private leases are excluded. Storage is read back before dispatch; failed or silently dropped writes block dispatch. Draft text and addresses remain in memory across SPA tool/route changes; copy them before a full reload or closing the tab. The application requests the browser's native leave-page warning while those drafts exist, but browser support for that warning varies.

Malformed or lost responses and restored pending markers hold new mutations. A successful read alone never clears that hold. The operator explicitly refreshes, inspects the page and acknowledges possible effects. Acknowledgement only clears the local marker; the earlier action may still complete later. Nothing is automatically resubmitted. A late response must match the complete original local metadata in memory and storage; a reused UUID with changed metadata cannot import control or erase a newer request. New text entered while a request is pending is retained.

The new versioned UUID is a durable server admission identity. **Check server record** performs an exact authenticated GET. It reports recorded, dispatched, completed, not-dispatched or unknown state without replaying an action. A successful read never restores the old private lease or saved pixels; explicitly inspect the current page and take control again when available. No matching record is inconclusive. Legacy records lack server recovery identity and retain explicit local review. Damaged records may be cleared after current-page review, but an intervening change to the stored record prevents clearing.

Recovery drafts are not synchronized between devices. Browser receipts store no typed text, URL, screenshot, page title or private lease. Split-worker command payloads remain encrypted under the existing runtime key. A timeout, malformed result or failure capturing an image after navigation remains uncertain until the exact server record can be checked. HTTP status alone never proves that an accepted action did not execute. See [durable operator recovery](./operator-recovery.md) for deployment, retention and output-key rules.

## Verification scope

Automated coverage uses production Chromium with controlled API fixtures, pure validation/recovery tests, and real HTTP/PGlite/local-browser integration. The checkpoint report lists exact counts and unverified environments. Screenshot decode/response failure preserves the last image and disables interaction until a valid observation. No test with fixtures establishes physical-phone access, native PostgreSQL topology, provider availability or 24-hour durability.
