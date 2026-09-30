# Portable PostgreSQL backup checkpoint

The Compose backup guide now writes a custom-format archive with `pg_dump --file`
and uses `docker compose cp`. This avoids the binary-to-text conversion performed
by Windows PowerShell and PowerShell before 7.4. Native instructions also use a
file argument, and restoration explicitly fails on SQL errors.

Installation acceptance now dumps its own migrated fixture, creates a unique
empty restore database, restores the archive, compares the agent identity roster
and migration journal entry count, and rolls back a UTF-8 agent insertion while
checking the restored sequence. The container variant copies the archive through
the host filesystem and restores that copy. Cleanup only drops the fresh database
after its creation was confirmed. No operator database is used by these drills.

## Local evidence

- Eight contract scenarios passed: success, corrupt archive, restored-data mismatch, failed database creation, failed restore, binary/size checks, path replacement and growth during the read.
- Scripts typecheck passed.
- Real Windows PostgreSQL 17.10 installation and resume passed after correcting the command wrapper to retain bounded `psql` output. Its old blanket `ignoreInheritedStdio` setting discarded the fingerprint; the first failing run is not counted as passing evidence.
- The latest helper, including its ASCII transport of the UTF-8 probe and descriptor-based archive read, was run against that disposable installation and passed an actual dump/restore/read/write drill: 14 agents, 30 migration journal entries and a 165,506-byte archive. The test PostgreSQL process was stopped afterward.
- No model/provider call or paid service was used.

The first PR security scan identified a path-based `lstat`/`readFile` race.
Archive inspection now opens once, checks and reads that descriptor with a hard
allocation/read bound, rejects non-regular/linked inputs and detects growth or
truncation encountered during the read.
Regression tests replace the pathname and grow the file after inspection. The
The second scan cleared that race and reported an unspecified file mode on the
read-only open call. The call now explicitly specifies private mode `0o600`,
which does not create a file or change existing permissions with `O_RDONLY`.
The next security scan is still required before merge; neither alert was dismissed.

## Pending gates and limits

Linux container transfer/restore and macOS native acceptance await this branch's
CI. Full source/UI checks will be enforced by the PR; they were not repeated
locally for this test-and-documentation change. Production UI, API and agent
permissions were not modified. No new phone or language-flow acceptance is
claimed.

This drill does not certify an operator's own backup or preservation of every
table value, secret file or workspace volume. The guide retains encrypted storage,
separate failure-domain storage, trusted dump sources and operator restore-test
requirements. A native dump must use compatible PostgreSQL tools. The native
acceptance process keeps the archive in its private evidence directory; it is
never uploaded as an ordinary source artifact.
