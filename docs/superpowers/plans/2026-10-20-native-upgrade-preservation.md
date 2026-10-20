# Native installation upgrade implementation plan

Goal: upgrade an existing native installation through START while preserving
tasks, settings, credentials, workspaces and a recoverable previous database.

Architecture: strict versioned compatibility inspection; lease-owned cold-copy
staging and migration-only process; journaled promotion; localized setup flow.

Tech stack: TypeScript, Node 24, PostgreSQL 17, existing native installer,
owner-private storage, node:test and Playwright.

Spec: `docs/superpowers/specs/2026-10-20-native-upgrade-preservation-design.md`.

## Global Constraints

Work only in the attached isolated native-fault-evidence-recovery worktree.
Preserve the dirty D: checkout. Use pinned Node 24/pnpm 10.17.1. Keep ordinary
restart's strict identity checks. No provider requests or workers during staging.
Preserve original data and secrets, reject uncertain ownership and shutdown, and
leave incomplete work inaccessible to normal startup. Never label a preflight
helper as a finished upgrade. User authorization covers routine merge/publish
after fresh required checks. Execute inline with one final independent review.

## Review Focus

1. Unknown/edited predecessor packages and rewritten historical migrations:
   Task 1 tests strict identity, version bounds and unchanged journal/SQL prefix.
2. Redirected, live or changing cluster files and external tablespaces/WAL:
   Task 2 tests cold-copy ownership, inventory and clean shutdown rejection.
3. Process termination on either side of every promotion operation, including
   pointer writes and a competing old START: Task 3 injects failures and retries.
4. Hidden scheduler/provider activity or permission/configuration reset:
   Tasks 2 and 4 prove migration-only staging and preserved paused preferences.
5. Narrow/RTL/localized setup and real package identity after restart:
   Tasks 4 and 5 cover all seven locales, 390px, five targets and real Windows Qwen.

### Task 1: Establish strict upgrade compatibility without changing installed data

Interfaces: produce `inspectNativeUpgrade` returning package identities, original
installation identity and byte fingerprints; consume manifest verification,
bounded installation reads, input validation and exact launch-pointer checks.
Add an inventoried release metadata producer consumed by inspection. No launcher
integration or identity rebinding in this task.

Files: new `scripts/src/setup/native-upgrade-preflight.ts` and tests;
new `scripts/src/setup/native-release.ts` and tests;
`scripts/build-native-setup.mjs`; this plan/spec and private progress ledger.

1. Run existing native distribution, launch, resume and managed PostgreSQL tests.
   Expected: current exact-base tests pass.
2. Write and run failing tests for supported v0.5.5/new metadata, strict stable
   version/target/protocol bounds, exact installation/pointer/commit binding,
   same package, unsafe nesting, unsupported modes and unchanged migration history.
   Include real temporary package inventories, tampering and no-write assertions.
   Expected: new behavior fails before implementation.
3. Implement bounded metadata parsing and a read-only inspector. Verify both
   package inventories; use an explicit reviewed legacy mapping, never guessed
   commit dates. Compare old migration entries and historical SQL hashes.
4. Make the native builder emit the same validated release metadata before its
   inventory. Keep schema 1 compatibility and ordinary resume behavior unchanged.
5. Run new plus baseline tests and scripts typecheck, formatting and diff checks.
   Expected: all pass without modifying any source installation.
6. Commit `feat: validate native upgrade package compatibility` and ledger result.

### Task 2: Stage and verify a stopped cluster without starting agents

Interfaces: consume Task 1 identities under existing instance OS lease; produce
verified cold-copy inventory and stopped, migrated staged cluster. Migration CLI
accepts owned database secret path and writes no credentials to stdout.

Files: new upgrade snapshot/migration helpers and tests, API migration-only
entrypoint/build, native required files, package verifier/smoke harness.

1. RED: live/unclean server, redirection, external WAL/tablespaces, changed files,
   copy interruption, insufficient/failed copy and migration failures preserve source.
2. GREEN: verify clean shutdown with bundled pg_controldata, copy complete regular
   cluster into an owned same-filesystem staging area and verify full inventory.
3. RED/GREEN: migration-only process preserves data/sequence/identity, applies only
   append-only migrations, sets durable stop, cannot import API/providers/workers.
4. Verify real PostgreSQL staging/restore, native build and tests; commit and ledger.
   Expected: original cluster bytes unchanged; staged cluster is cleanly stopped.

### Task 3: Add recoverable promotion and exact identity rebinding

Interfaces: consume staged copy and installation lease; produce journaled exact
metadata/pointer transition and resume lease handoff. Normal resume refuses an
incomplete journal; ordinary pointer save remains strict.

Files: upgrade coordinator/journal, installer/resume/native-launch/bootstrap and
their tests, OS lease handoff tests.

1. RED: interruption before/after every rename/write, stale CAS, mismatched UUID,
   concurrent old/new launcher, repeated recovery, mismatched staging inventories.
2. GREEN: durable journal and source metadata backup; guard old launcher; retain
   old database; promote staged database; compare-and-swap metadata and pointer;
   recover each unambiguous phase and reject uncertain state.
3. Verify new runtime starts paused, same secrets/data paths, restart and no
   automatic rollback after accepted work. Keep backup; commit and ledger.
   Expected: no state permits workers to start against an ambiguous cluster.

### Task 4: Provide a guided upgrade in the existing seven-language installer

Interfaces: authenticated local session consumes coordinator; browser sees safe
summary/progress and recovery actions, never secret values or commands to paste.

Files: setup session/page/client/CLI, DESIGN.md where needed, docs and tests.

1. Apply Apple Design and frontend/premium guidance to the existing setup UX.
2. RED/GREEN: fresh/upgrade choices, stop-old-launcher help, preserved-data review,
   progress, paused-success/recovery state, token expiry and denied cross-origin calls.
3. Verify seven authored translations, RTL and keyboard/focus at 390px and desktop.
   Update native START-HERE and upgrade docs. Commit and ledger.
   Expected: no separate infrastructure installation required in the upgrade flow.

### Task 5: Qualify the actual upgrade and publish after required gates

Interfaces: consume complete branch; produce exact-source Windows upgrade proof,
five matching-host package proofs, required CI and public release readbacks.

1. RED/GREEN: real public v0.5.5 instance with existing real local task, settings,
   provider/owner fingerprints and workspace; run upgraded package; verify every
   retained fixture, durable pause and manual resume followed by a new local job.
2. Run source/security/build/browser and five matching-host native gates, including
   failure recovery. Review whole branch independently; fix material findings.
3. Push and attach PR, merge only after required checks, qualify exact main packages,
   publish new release and verify anonymous bytes/hashes and public instructions.
4. Record benefit, evidence, limitations and next useful gap. Global Goal 7 stays
   active. Expected: claims exactly match the published commit and actual proof.
