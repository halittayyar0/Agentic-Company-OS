# Preserve existing native installations during upgrades

Status: implementation in progress; no upgrade is available in v0.5.5.

## User outcome

An ordinary user downloads and extracts a new native package, opens START,
selects their existing installation, and upgrades without installing Node.js,
Docker, PostgreSQL or a separate database tool. Tasks, projects, settings,
provider credentials, operator identity and workspace paths survive. New work
stays paused until the operator reviews the upgraded installation.

This is an architectural change to installation identity and database ownership.
Existing user authorization covers implementation, tests and publication after
the required checks. No additional provider spending or authentication is needed.

## Chosen approach

Keep the original private instance directory and its secrets and workspaces in
place. Require the old launcher to stop, acquire its existing OS installation
lease, verify the source and destination package inventories, and reject any
unsupported predecessor, downgrade, platform change or edited migration history.
Never weaken normal restart's exact package and pointer checks.

Build and migrate a cold copy of the PostgreSQL cluster with the new package.
PostgreSQL requires a stopped server for an ordinary filesystem backup and a
complete cluster including WAL; minor releases within a major version share
storage format. See [filesystem backups](https://www.postgresql.org/docs/17/backup-file.html)
and [upgrades](https://www.postgresql.org/docs/17/upgrading.html). Only managed
PostgreSQL 17 on the same OS and architecture is in scope. External tablespaces,
external WAL, redirected paths and uncertain shutdown state fail closed.

A journal records every transition. After copy verification and migration-only
checks, guard the original metadata against the old launcher, retain the original
database with an atomic rename, promote the verified new cluster, and rebind
metadata and the remembered launch pointer. Recover by inspecting the journal
and exact filesystem state; never infer permission to start workers from an
unknown or partial phase. Retain the previous database and metadata for recovery.

## Identity and compatibility

- Existing manifest schema 1 stays strict and supported. A new, inventoried
  `native-release.json` describes application version and the upgrade protocol.
- The only predecessor without this file accepted initially is the exact public
  v0.5.5 source commit `8946dea16eeb314e66b078995b98d0e43a631fdc`.
  Its package still needs full inventory verification. This is compatibility
  identification, not a signature or assertion that an unsigned package is trusted.
- Accept stable versions in the reviewed 0.5 series, strictly newer than source,
  at least 0.5.5, with the same target and PostgreSQL major 17. Fail closed for a
  changed protocol, unknown legacy commit, older target, or missing metadata on a
  target package. Semver alone is insufficient: the old migration journal must
  be an unchanged prefix and each historical SQL file must retain its hash.
- Retain the exact installation UUID, locale, access mode, tool selections, model
  endpoint and secret files. Read bounded metadata through nonredirected paths.
  No secret values enter compatibility reports, browser responses or logs.
- Destination package must be separate from the source package and instance.
  Source and destination inventories are checked again under the instance lease
  before any copy or mutation, rather than trusting browser preflight results.

## Migration and recovery

The migration-only entrypoint imports the database layer, not the API, scheduler
or provider clients. It applies the append-only migrations under their existing
advisory lock and persists a runtime stop. It verifies identity, migration rows,
representative data and write/sequence behavior on the copy, then shuts it down
cleanly. No model request, recurring job, browser session or agent process starts.

The parent retains the installation lease throughout staging and promotion. A
temporary bundled Node child owns only staged PostgreSQL. It listens for IPC
disconnect before validation, aborts startup on parent loss, and joins cleanup
before exit. No lease token or credential value crosses IPC. An ordinary-user
WSL/Linux experiment found that a direct PostgreSQL child survived a killed
parent; the staging child closed it cleanly in the same experiment. On Windows,
forced parent termination can also end descendants before cleanup and leave an
unclean copy. Preparing attempts are therefore always retained and replaced with
a new cold copy; a clean shutdown alone never makes a partial migration reusable.
No cleanup command selects an original or external database using a stale PID.

The promotion protocol must survive failure before and after each atomic rename
and metadata/pointer write. A journal and saved original metadata bind source and
target commits, roots, UUID, cluster inventory and transition identity. The old
launcher must reject the guarded record before the first destructive namespace
change. An incomplete journal blocks normal startup on the new launcher. Do not
automatically revert after the upgraded application has accepted user work.

## Interface

The seven-language setup wizard offers fresh installation or upgrade when a
valid predecessor is found. Explain which data remains, that the old START
window must close, that a private backup is retained, and that work remains paused.
Use existing local setup authentication, expiry, loopback binding and CSP.
Show bounded progress, meaningful errors and an explicit recovery route after
interruption. Preserve language selection, keyboard use and 390px layout.
Advanced CLI flags are an additional route, not required for ordinary users.

## Completion evidence

Unit and filesystem failure tests cover unknown versions, edited migrations,
misbound installation/pointer/secret files, symlink and hardlink redirection,
shutdown state and all promotion boundaries. Existing restart and install tests
remain green. Real Windows proof starts with the public v0.5.5 package and a
completed real local-model job, upgrades with unchanged secrets and workspaces,
verifies retained data and stop state, resumes explicitly and completes another
local job. Matching-host native CI covers all five archive targets. Browser
checks cover all seven languages and narrow layout. All source, security and
release gates must pass on the published commit; old release evidence is not
proof of this feature.

## Boundaries

No unattended remote download or execution, major PostgreSQL upgrade, source or
Docker migration, cross-platform transfer, signing/notarization, or automatic
rollback of newly accepted work. Keep v0.5.5's documented manual upgrade boundary
until the complete upgrade flow is qualified and released.

Self-review: retaining the data path avoids rewriting sandbox references;
guarding original metadata is required because old launchers treat an unknown
phase as resumable. Copy-only staging isolates migration failures. Identity
checks are compatibility/integrity checks, not authentication of a publisher.
