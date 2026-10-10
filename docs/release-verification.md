# Verify a release candidate

Maintainer guide. Installing and using the product does not require this tool.

`pnpm release:verify` reads GitHub metadata, security results and original CI
logs. It helps prevent a clean default branch or an unrelated test summary from
being mistaken for evidence about the candidate you intend to publish.

## Requirements

- Node 24, the pinned pnpm version and installed repository dependencies.
- GitHub CLI (`gh`) authenticated with read access to the repository, Actions,
  branch protection and code-scanning results. The command does not start login.
- A reviewed, clean candidate with completed original CI and platform workflows.
- Full 40-character candidate head, base, tree and tested PR merge SHAs retained
  from candidate preparation. Preserve the tested merge identity before squash.

The command uses only GitHub API GET requests. It starts no jobs, changes no
permissions, dismisses no alerts and performs no model inference.

## Before merging

Replace the uppercase placeholders with the reviewed candidate identities. Use
a new report path whose parent directory already exists:

```sh
pnpm release:verify --repo OWNER/NAME --phase pr --pr NUMBER --head HEAD_SHA --base BASE_SHA --tree TREE_SHA --tested-merge TESTED_MERGE_SHA --output .tmp/pr-release-verification.json
```

On Windows, macOS and Linux the arguments are the same. If `gh` is not on PATH,
add `--gh` followed by its executable path. Quote paths containing spaces.
`pnpm release:verify --help` works offline.

The command requires all eleven protected context/App pairs, strict protection
and linear history. It checks the candidate's exact tree and the tested merge's
tree and parents. It reads every page of CodeQL analyses and open alerts from all tools with
both `refs/heads/main` and `refs/pull/NUMBER/merge` explicitly supplied. An open
PR alert blocks acceptance even when its root `state` is `null`.

It then reads the original Linux, Windows and both Mac architecture source/UI
jobs. The expected test counts and named skips come from
`scripts/release-expectations.json` **in that exact candidate commit**, with its
Git blob checksum checked. An unrelated local or newer copy is not used.

The full `pnpm test` result must belong to its named successful step and command
window. Additional PostgreSQL test summaries later in the log are recorded but
cannot replace the source result. Skips must match the reviewed test names and
reasons; durations may vary. UI runs must have the expected count and workers,
with no retries, failures, flaky cases, skipped cases or interrupted cases.

Original workflow event, commit, path, run attempt and job identities are also
checked for every required Actions producer, including secret scanning, CodeQL
analysis and the coding helper. Checkout logs must prove the exact PR merge ref
and SHA, or the exact main squash SHA. Mac aggregation jobs are bound to the four
original source/installation dependencies in the same platform run. Empty PR
linkage metadata after closure is allowed only with this checkout evidence;
present linkage must match the PR, head and base.

A restarted or ambiguous run needs independent investigation; this
command will not select a newer green result to conceal it. Candidate identity
and protection are read again after the logs to detect movement during checking.
Replaced check IDs at an unchanged commit also reject the report.

GitHub documents the branch-scoped [code-scanning endpoints](https://docs.github.com/en/rest/code-scanning/code-scanning)
and paginated [check-run endpoints](https://docs.github.com/en/rest/checks/runs).

## After the ordinary squash merge

Run the same command with `--phase main` and a new output path. Keep the original
PR head, base, tree and tested merge inputs; do not replace them with a new main
head. The command verifies that current main is that PR's ordinary squash,
has the tested tree and sole expected base parent, and has all ten main Actions
checks. It retains all eleven original PR checks and explicitly queries both
security refs again. The original main push logs must pass independently.

If main has advanced since this PR, prepare and verify the current candidate.
Historical acceptance of an older commit is not acceptance of a newer release.

## Read the result correctly

Exit zero and a new JSON report mean:

- `checksAndSecurityPassed: true`: the exact required checks and both security
  scopes passed.
- `sourceAndUiLogsPassed: true`: four full source stages and three clean UI
  stages matched the reviewed expectations.
- `publicationReady: false`: native evidence bundles, independent coding and
  endurance verifiers, distribution images, real installation/resume/backup,
  packaged installer and anonymous public readback still need their acceptance.

The report records source identities, check/job/run IDs, expectation blob SHA,
captured-log SHA-256 values, counts and scope. `suites.producers` records the
original workflow and checkout evidence; `suites.stages` records the four source
and three UI results. It contains no raw logs or tokens.
Keep original logs and artifacts separately so the hashes can be independently
rechecked. A report is evidence, not permission to publish or a signed attestation.

An API error, missing permission, incomplete pagination, wrong source, changed
policy, missing stage or failed assertion exits nonzero without a passing
report. Existing report files are never overwritten. Inspect the original job
and fix the cause before preparing new evidence.

## Updating expected coverage

When adding or removing tests, update the candidate's expectation file in the
same reviewed change. Keep all six platform stages. Derive the new source total
from the complete suite, preserve platform-specific named skips, and change UI
counts only when the reviewed UI suite changes. Explain every reduction or new
skip; do not lower counts or enlarge exclusions to accept an unexplained failure.

This command does not prove real ChatGPT account inference, physical-phone
access or 24-hour operation. Follow the complete [release checklist](./release-checklist.md)
and retain those limits unless their own requirements have been verified.
