# Windows source snapshot paths implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline, with one fresh whole-branch review after implementation.

**Goal:** Complete the real source snapshot/check/apply/rollback journeys under a Windows root that makes the managed Git branch lock path reach 260 characters.

**Architecture:** Retain the source workflow and its sandbox contract. Apply Git for Windows long-path support per managed Git command; make the existing real workflow fixture exercise the boundary regardless of the temporary root's length.

**Tech stack:** TypeScript, Node 24, real Git for Windows, existing structured sandbox and PGlite tests.

**Spec:** `docs/superpowers/specs/2026-10-10-windows-source-paths-design.md`.

## Global constraints

- Preserve the seven source-workspace cases and all current release test/skip expectations.
- Add `core.longpaths=true` only on Windows managed source Git commands; do not change user/global/repository configuration.
- Preserve all permission, private-file, link, snapshot, revision, effect, cleanup and accounting boundaries.
- Original candidate `432186f85a23456827a57585951463721863b27f` remains failed; new evidence must bind to its own final source/commit.
- Routine implementation/publication is already authorized; no paid service, real identity flow or additional implementer agents.

## Review focus

- Short hosted Windows roots still need a regression that reaches the actual branch-ref lock boundary.
- Existing long roots must not be shortened or redirected to bypass ownership/path checks.
- Application/rollback and cleanup refusal must still work after snapshot cloning succeeds.
- Non-Windows Git invocations must retain their original behavior.
- The unrelated original hosted wall-clock failure cannot be dismissed by this fix or a subset of passing tests.

## Task 1: Managed Git path support and real journey regression

**Files:** Modify `artifacts/api-server/src/lib/source-workspaces.ts`, `artifacts/api-server/src/lib/source-workspaces.test.ts` and `docs/chatgpt-connection.md`.

**Interfaces:** Consumes the existing `execArgvInSandbox(agentId, argv, timeoutMs, beforeEffect, locale)` and source workflow APIs without signature changes. Produces no new public API, environment setting, migration or locale copy.

- [ ] Pad only the owned Windows sandbox fixture so `.source-reviews/<UUID>-<UUID>/.git/refs/heads/codex/source-<UUID>.lock` reaches 260 characters. Keep all existing behavioral assertions.
- [ ] Run `node --no-wasm-code-gc --import tsx --test --test-name-pattern "a source change stays isolated" artifacts/api-server/src/lib/source-workspaces.test.ts` against unchanged production. Confirm the real clone failure and retain its passive process receipt.
- [ ] Add only Windows `-c core.longpaths=true` to the managed Git argv in `source-workspaces.ts`.
- [ ] Run `node --no-wasm-code-gc --import tsx --test artifacts/api-server/src/lib/source-workspaces.test.ts`: all seven cases pass; inspect the first journey to ensure both clone and later apply/rollback assertions execute.
- [ ] Document the per-command setting and its limited scope in the source-change section of `docs/chatgpt-connection.md`.
- [ ] Run the adjacent source/native-session fence tests, `pnpm typecheck`, `pnpm exec prettier --check` on changed files and staged Gitleaks. Use the installed pinned Node 24/pnpm paths.
- [ ] Retain original full local/hosted failure identities and focused RED/GREEN logs in the release ledger; commit the fix.
- [ ] Obtain one fresh whole-branch review, resolve findings, then run the complete new candidate local/hosted release gates. Diagnose the independently failed hosted wall-clock stage rather than rerunning it. Only merge after full exact candidate acceptance, and verify new original main/public results.
