# Durable meeting commands implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` inline. Preserve the existing worktree. The active Goal 7 authorizes implementation; do not introduce repeated approval gates for this internal work.

**Goal:** Make every manual meeting write recoverable without duplicating records after a lost response.

**Architecture:** Store a required UUID, normalized-input hash and compact result in the same database transaction as each write. Serialize through the existing runtime-control lock. A replay returns that exact result before consulting mutable project/meeting state; receipt GET is project-scoped and read-only. Keep the existing leased model-turn protocol separate.

**Tech stack:** TypeScript, Express, Drizzle, PostgreSQL/PGlite, React Query, existing sessionStorage recovery and seven-language UI.

**Spec:** Active Goal 7 and `docs/meeting-turns.md`. Manual commands are create/update meeting, append founder transcript, create decision/action, update action and complete meeting. Start remains the existing durable model-turn command.

## Global constraints and decisions

- Required identity for every write; no server-generated compatibility identity.
- No new dependency, paid call, installation, publication or commit.
- One transaction commits both the domain change and its receipt. Unexpected failures roll back both. Business rejections are recorded with a stable error code and cannot later become success under the same ID.
- Compact receipts contain scope, command kind, result IDs and status; no copied transcript/history. Read current content from the normal GET routes.
- Save creation as a draft first, then explicitly start its first model turn. This makes the existing two server commands visible and avoids losing the boundary between draft creation and a billed model action.
- Preserve existing operator permissions and post-meeting action tracking; never allow metadata PATCH to bypass start/completion lifecycle rules.
- Client saves exact intent before dispatch, blocks duplicate submissions, checks receipts without replay, and retries a missing receipt only with the original identity. A recovery inbox is project-scoped so a removed/unlisted meeting cannot hide its pending command.
- A matched success clears only the submitted draft; failed/unknown outcomes preserve editable input. A malformed stored intent stays untouched until explicit review.
- Seven locales: tr, en, de, ru, zh-CN, zh-TW, ar. Arabic RTL, keyboard focus and 44 px phone controls follow `UX-CONTRACT.md`.

## Review focus

1. Concurrent requests in separate router instances: exactly one record and matching responses.
2. Transaction failure after writing domain state but before receipt: neither survives rollback.
3. A deleted project/meeting or changed owner must not make an accepted identity reusable or change a replay.
4. A browser reload/navigation/storage failure must not create a new command identity or erase unsent text.
5. A response or local record with mismatched kind/project/meeting/action must never be acknowledged as success.

## Tasks

- [x] Write and run failing API tests for missing IDs, concurrent replay, changed-input conflicts, read-only receipt lookup and retained identities.
- [x] Add `project_meeting_commands` schema/migration and the transaction-bound command executor/router. Return compact results and remove the superseded write handlers.
- [x] Update OpenAPI and regenerate clients; adapt callers and API tests to explicit compact command outcomes plus GET records.
- [x] Add exact-intent browser storage, receipt inspection and same-ID retry. Integrate project-level recovery and explicit create-draft/start flow with all seven packs.
- [x] Verify source/API/migration tests, seven-language browser recovery, types, build, bundle, generation stability, formatting and release gates. Record actual skips/limits.

## Execution ledger

- Ruling: execute inline under the existing autonomous Goal 7 mandate. Skill approval/commit handoffs are not repeated; the user's publishing and credential boundaries remain in force.
- Previous checkpoint is progress: the meeting form/draft implementation and verification report are current. The new work addresses its documented remaining durable-write gap.

- Implemented the transaction-bound router and migration, regenerated the API, and replaced manual client writes with exact-intent recovery. Creation now saves a draft before an explicit model round.
- Full source suite: 837 passed, 5 environment skips; full Chromium baseline: 307 passed. Final focused source/API/migration checks: 31 passed. Final Project Studio: 61 passed on the final production build; final format, types/build, bundle, generation, audit and license checks passed. Exact checkpoint scope and external skips are tracked in `docs/verification/2026-09-27-meeting-commands.md`.
