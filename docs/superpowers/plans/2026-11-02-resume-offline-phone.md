# Offline phone resumption implementation plan

> **For agentic workers:** Execute inline with superpowers:executing-plans. The user delegated routine decisions; no further design approval loop. One independent final review before integration.

**Goal:** Existing workspaces remain usable locally when the optional private phone network is offline, with a truthful localized status view.

**Architecture:** Resume validation admits an unavailable optional phone capability without changing saved settings. The existing executor selects a local-only deployment when its resume-only phone preflight fails. A completed, read-only setup session displays the result using the existing status UI.

**Tech Stack:** Existing Node24.22.1, TypeScript, native Node HTTP, setup HTML/JS and Playwright; no new dependencies.

**Spec:** docs/superpowers/specs/2026-11-02-resume-offline-phone-design.md

## Global constraints

- Preserve C47 and T7 branches/evidence and unrelated dirty primary checkout.
- No fresh-install fallback, saved policy rewrite, model/network exposure, guessed URL or raw probe diagnostics.
- Only local runtime readiness may be called verified; degraded phone is explicitly unavailable.
- Preserve authentication, exact origin/host checks, private session URL fragment, CSP, TTL and explicit key reveal.
- Localized status uses existing setup layout and natural height, no new visual system.7languages,320/1024viewport, RTL and keyboard checks.

## Review focus

1. Saved private-network selection, secrets, budgets and permissions remain unchanged after offline restart.
2. A failed optional capability cannot conceal a failed required runtime prerequisite.
3. Late hostname/listener conflicts do not configure or trust an unsafe phone route.
4. A resumed status page cannot reinstall or expose credentials without the normal local authenticated action.
5. Reload and language changes retain the degraded explanation and valid local workspace link.

## Task1: Resume and deployment

- [x] Add resume/execute regression tests; observe the existing offline failures.
- [x] Preserve plan validation while allowing only resumed phone preflight to degrade. Return closed phoneUnavailable and retain it in the private runtime record.
- [x] Verify fresh rejection, missing required prerequisite rejection, local native/container deployment boundaries and no preference/credential replacement.

## Task2: Status experience

- [x] Add completed-session security and browser regression tests; observe RED.
- [x] Add read-only completed session and bootstrap integration, seven-language explanation and reload restoration in the existing setup view.
- [x] Verify all7locales at320/1024, RTL, local workspace navigation, authentication/key reveal and no installation/model effects.

## Task3: Qualification and delivery

- [ ] Update DESIGN, mobile/setup docs and change log; run focused and full relevant checks, types, build, format, secrets.
- [ ] Independent review; fix findings with regression tests. Commit as Halit Tayyar without coauthors, push isolated branch and open a concrete PR. Preserve original CI attempts.
- [ ] Only merge after required checks and ordinary branch policy allow it; final main/live verification cannot borrow C47 or old349 evidence. Record any blocked or unrun gates explicitly.
