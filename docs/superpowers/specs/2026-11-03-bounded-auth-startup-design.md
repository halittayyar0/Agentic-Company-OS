# Bounded authentication startup and safe failure observation

## Evidence and user outcome

Original PR100/head467eb35 Windows installation job125612638127 failed before the zh-CN desired-outcome form appeared. Four locales had passed. Its diagnostic recorded HTTP200 auth-status headers, zero page errors and a loading screen; it did not establish response-body completion. The original log and artifact13188810851 are preserved and the candidate is rejected. The dependent Windows runtime guard correctly failed. Other platform passes cannot excuse this failure.

One observer-only local Windows investigation of the unchanged source passed all seven locales, with completed auth responses; its owned PostgreSQL/account fixtures were cleaned up. This does not explain or repair the original hosted failure.

A separate controlled browser reproduction serves the current production UI and an owned loopback auth peer. The peer sends HTTP200 and an incomplete JSON body. After the unchanged30000ms native page-readiness budget, the page still shows only Loading page, with no recovery action. Exactly one auth request has headers and no finished body. No account or model is used. `getAuthStatus` currently waits without a deadline. This deterministic product defect is distinct from the still-unconfirmed original Windows cause.

The user should receive the existing localized, secure session-unavailable screen and a usable Retry action when authentication cannot be completed. Protected workspace content must remain closed until a new valid response verifies it.

## Design decisions

- Give only the read-only `/api/auth/status` operation a15000ms deadline covering headers and JSON-body completion. This is an implementation choice, consistent with existing control-plane read budgets. Existing browser modules already use native `AbortSignal.timeout` and `AbortSignal.any`; reuse that pattern with the optional caller signal. Reject late data after the composed signal aborts.
- Pass the React Query cancellation signal from shared `authStatusQuery` in `AuthGate` and operator result review. Attempt this same-origin read even when browser connectivity hints report offline: local/self-hosted reachability is established by the response. Stop interval polling before the first valid auth status exists, so an error remains visible for explicit Retry instead of looping back into a spinner. Preserve normal polling after a valid status, focus behavior and explicit reconnect refresh and session-expiry checks.
- Reuse `AuthLoading`, `AuthUnavailable`, the shared Button and the existing seven auth language packs. Preserve visual tokens, alert semantics,44px controls, keyboard behavior,320px wrapping and Arabic RTL. No new authentication strategy, credential entry, provider, storage or permission is added.
- Do not add a timeout or automatic retry to login/logout or other mutations. Server authorization remains authoritative. A timeout/cancelled/invalid response never grants access or invents an authenticated state.
- Extend only the offline native smoke's safe connection diagnostics with bounded auth-request lifecycle observations: request started, headers received, completed or failed. Link events by fixture-local numeric IDs; never retain bodies, URLs, credentials, cookies, arbitrary error messages or identity data. Existing assertions, readiness deadlines, rate limits and mutation behavior stay unchanged.
- Keep the original467 source available in a clean source-only qualification clone while implementing in the existing isolated worktree. Old original source counts3155 and Linux UI1502 remain bound to467; later counts belong only to the new commit.

## Required proof

- Controlled production-browser stalled-body RED, followed by GREEN against the same peer and unchanged30000ms outer budget.
- Read boundary regressions for a body stalled after200, no headers, caller cancellation, pre-aborted callers, late valid data and normal login/status behavior. Verify invalid data remains denied.
- Seven-locale narrow UI recovery: a stalled initial status becomes a stable localized error, does not interval-loop, keeps protected requests closed and can explicitly retry against a reachable local service even with an offline hint. Existing login401, language-pack failure and503 recovery remain green; inspect narrow English/Arabic and desktop rendering.
- Diagnostic privacy, lifecycle ordering and bounded-record tests, plus focused guided-native integration without relaxing its existing assertions or deadlines. No claim that a passing new run proves the old intermittent cause.
- Types/build/format/generated consistency, both audits, licenses, existing numeric bundle ceilings, staged/commit secret scans and one independent final review. Update only discovered test totals; keep original platform skip sets and strict endurance gates unchanged.
- New Halit/no-coauthor commit, normal push and its own original hosted checks before protected integration. Actual-main, genuine fresh/0.5.9 GUI upgrade, native archive bytes, distribution and public readback remain separate.
