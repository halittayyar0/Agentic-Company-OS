# Retain private-helper file snapshots

PR100 head e498615 passed its 21 original execution jobs, including the final
Windows 3167-case source census and 100/100 finite endurance fixture. Its separate
required CodeQL check125655271582 failed with five new high-severity alerts.
The stock release verifier correctly rejected the candidate. Do not merge it,
dismiss alerts, weaken rules, or rerun its original producers.

Four alerts flag pathname check/use gaps in the helper loader, packager and
Windows ACL fixture. Open first, inspect and read the retained descriptor, then
compare the final pathname identity and canonical location before accepting it.
Use nonfollowing, nonblocking opens where POSIX supports them so symbolic links
and named pipes cannot turn validation into an unintended read or a hang.
Windows retains its canonical-path, regular-file, size, digest and identity
checks. This does not defend against a same-owner writer who can replace the
application itself or turn a returned executable pathname into an execution
handle.

Package the verified executable, notice and provenance bytes directly instead
of reopening their source paths to copy them. Preserve output hashes and normal
repeat-build behavior. The owned Windows security fixture retains its created
file descriptor for identity, content mutation and content verification.

The fifth alert is a test assertion using a hostname substring. Split the
comma-separated TRUSTED_HOSTS value and compare complete entries; keep the
production allowlist and connection behavior unchanged.

Retain the pinned helper source/executable/provenance, permissions, original
deadlines, source/UI census, seven-locale coverage and numeric bundle limits.
Run existing behavioral contracts, add a FIFO check within the existing loader
case to guard the descriptor-first ordering, then types/build/integrity/security
checks. A new head requires fresh original CI and its CodeQL security result.
Actual-main, genuine model/059 GUI upgrade, distribution and publication gates
remain pending until that new candidate is accepted normally.
