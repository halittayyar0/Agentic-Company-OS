# Publication secret scan — 2026-09-28

The operator authorized downloading the scanner and completing GitHub publication.
Gitleaks 8.30.1 was downloaded from its official GitHub release. The Windows x64
archive matched both the official checksum manifest and the release asset digest:
`d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e`.

## Reviewed results

- Unconfigured source scan: 12 findings in the previously verified 1,386-file
  source export (12.29 MB scanned).
- Unconfigured full reachable-history scan: five findings across 32 scanned
  commits (14.30 MB scanned). This is the scanner's commit count, not a claim
  about unreachable objects or external repositories.
- All findings were reviewed: four CI fixture-token uses, three deterministic
  receipt-test key uses, four explicit deployment placeholders, and one prose
  false positive in the source; history contained five versions of the same
  loopback CI fixture token. No real credential was identified in these findings.
- `.gitleaks.toml` extends every default detector. Its four exceptions require
  both an exact reviewed value and the corresponding exact source-file path.
  No directory, file, commit or detector is globally excluded.
- Source and reachable-history scans with that configuration each exited zero
  with no remaining findings. Reports use `--redact=100` and stay outside the
  publication candidate.
- A separate disposable scanner check confirmed that the reviewed CI fixture is
  accepted only in its CI path; a different key in that path and the same fixture
  in another path are both detected. All three assertions passed.

The workflow now scans both checked-out source and complete fetched history.
This local result does not establish a successful GitHub Actions run. Secret
scanners are heuristic; this is not a guarantee that every possible secret was
detected. Original history and local operator data remain intact.

## Publication boundary

The current GitHub connector identifies the account but reports no installations
or accessible repositories. Chrome also opened GitHub without an authenticated
session. Official GitHub CLI device authentication was initiated so the operator
can authorize from a phone. No repository, push, public release or remote CI
success is claimed until those actions return verified results.

The earlier source/build/browser evidence remains recorded in the emergency
locale boundary report. This change modifies scan configuration, workflow and
documentation only; it does not change application behavior or constitute a new
full application test run.
