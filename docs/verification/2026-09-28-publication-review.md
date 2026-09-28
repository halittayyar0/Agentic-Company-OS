# Publication source review — 28 September 2026

This is the completed earlier source-preview checkpoint. Subsequent
[runtime status localization](2026-09-28-runtime-status-localization.md) changes
have a separate completed local checkpoint; this report does not attest that
later source.

Status: source export installation and applicable local checks passed; not a
publishable release attestation. Existing work and the Git index are preserved. No commit,
branch rewrite, push, tag, remote change, account change or external tool
installation was performed. Locked project dependencies were restored from the
existing local cache in a separate exported-source directory.

## Scope and findings

The initial current-tree inspection covered **1,382 present files**, totaling
approximately 12.6 MB. All were ordinary files; there were no source symlinks or
candidate paths matching the checked runtime-data, environment-secret, database,
log, dependency, build-output or browser-evidence patterns. `.env.example` is the
intentional documented template exception. Actual local runtime data was not
read or copied.

An all-reachable-reference history **path** inventory found **33 commits, 13
references and 652 distinct paths**, with no match to those checked sensitive
path patterns. This includes local Codex capture/checkpoint and backup refs;
these are not a proposed publication refspec. Path names do not prove safe file
contents or history. Do not use a mirror push for this checkout.

A narrow, redacted current-file triage checked private-key headers, selected
provider/GitHub/AWS/JWT token shapes, credential-bearing URLs and local user
paths. It produced 28 findings, reviewed in context without printing credential
values:

- 26 credential-URL matches were explicit test sentinels, disposable CI database
  settings, a schema-only example or construction from a newly generated local
  test password. No live service credential was identified by this limited pass.
- One user-path match was ordinary prose about avoiding host/home credential
  mounts, not a personal directory.
- One actual personal workstation path in a review document was replaced with
  the portable skill name/version and reproduced review checklist location.

This is **not** an equivalent replacement for Gitleaks/TruffleHog or a full
content/history secret scan. The external scanner request remains unanswered;
neither executable was available on PATH and nothing was downloaded. Full
redacted candidate/history scanning remains required before publication.

The local inventory and redacted finding hashes are retained at
`test-results/publication-review/inventory.json`. They are ignored evidence,
not files to upload as part of an unreviewed working tree.

## Proposed source contents

The export is built from an explicit current-file list, not a recursive copy of
the workspace. It includes the application/API source, generated API clients,
SQL migrations and snapshots, locked workspace manifests, tests, documentation,
CI, license/security/contribution files, and the existing mockup package. The
mockup package remains because it is still a declared workspace package; removing
it would require a separate dependency and build change.

Four historical assistant notes under `.agents/memory/` are excluded from the
proposed export. Their originals remain untouched in the checkout and existing
Git history. They are not runtime inputs. In particular, their old suggestion
to replace OpenAPI integer fields with numbers conflicts with the current
explicit Zod 3 generator configuration and bounded API contract. `replit.md` now
documents the authoritative current configuration and exact browser-owner
routing for the API/worker topology.

Platform configuration is retained where it is generic project configuration;
there is no automatic deletion of an optional development platform or its
workspace package. The export carries no `.git` directory, operator `.env`,
runtime data, installed dependencies, test reports, logs or compiled outputs.
It is source code requiring the documented Node/pnpm/dependency setup, not an
installer or a running server.

The only binary assets are:

| Asset                                                               | Bytes  | SHA-256                                                            |
| ------------------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `artifacts/agentic-company-os/src/assets/company-roster-atlas.webp` | 110826 | `cdffa8d68795ab91501e21853a543fa9ef48dd2ae487ad1387f3c595832e5d05` |
| `docs/assets/dashboard.png`                                         | 146833 | `aa442fd0d6234c02d580a58a775bc4296a3ec0fabe931a9ef13e7a7efcf40f48` |

Their ownership/fixture provenance is documented in
[asset provenance](../assets/README.md). The current dashboard capture belongs
to the successful [combined local gate](2026-09-28-full-release-gates.md).

## Reviewable export evidence

The local export manifest records every included path, size and SHA-256, the four
exclusions, the originating HEAD, and the archive hash. Verification compares
every extracted entry against that manifest and rejects missing/extra files,
path traversal, duplicate entries or content differences. Source files are
rechecked after copying to detect changes during export.

Evidence lives under `test-results/publication-review/`; the source-only archive
and temporary extraction are kept under the ignored `.tmp/` directory. These
are local review artifacts. No Git commit is represented by the export, and a
fresh dependency install/full verification of the eventual exact commit still
remains open.

## Decisions still required before GitHub publication

- Review the exact included paths/content and full redacted scanner results.
- Choose the intended public history and author metadata. Excluding `.agents`
  from a source archive does not remove it from existing Git commits or refs.
  A source path list alone is not permission to publish the current history.
- Prepare the chosen exact commit and verify a clean checkout plus remote CI.
- Keep native PostgreSQL/topology, Docker, real phone/private HTTPS/mobile data,
  Safari/native input/accessibility, native-speaker and 24-hour exclusions as
  recorded in [release readiness](2026-09-27-release-readiness.md).
- The maintainer controls remote ownership, public visibility, push and tags.

## Export installation finding

The first export contained 1,379 files; its archive SHA-256 was
`8728c377962863cee1e21bb3f304bc8f0414e5e8859c612f84ebbee82fb6d318`.
All entries survived the archive/extract/hash comparison. In its separate
directory, `pnpm install --offline --frozen-lockfile --ignore-scripts` passed
(509 packages reused, zero downloads), and full workspace types/build passed.
All 198 rebuilt frontend files matched the earlier fully tested build exactly.

Starting the actual bundled API exposed a previously untested installation
boundary: its PGlite migration, readiness, authentication and seven-language
catalog worked, but direct UI routes returned HTTP 500 when a deployment parent
was dot-prefixed, such as `.tmp` or `.local`. This initial export is retained as
failed evidence, not a usable release candidate.

`sendFile` had received an absolute `index.html` path without a separate root,
so Express's default hidden-file policy also evaluated deployment ancestors.
The fix sends the fixed `index.html` filename relative to the configured public
root. It does not enable hidden-file serving or change API authentication.

The new real HTTP regression first passed for an ordinary parent and failed for
a dot-prefixed parent (404 rather than the expected HTML; the full app had mapped
the same error to 500). After the correction, both cases and the existing app
security checks passed: **7 passed, zero failed/skipped**. They check direct Home,
Skills and nested Studio routes, immutable asset caching, hidden/outside file
non-disclosure, API fallthrough and method/content negotiation. Logs are
`acos-static-ui-hidden-root-red.log` and `acos-static-ui-hidden-root-green.log`.

## Corrected export and actual-server browser check

The corrected archive contains 1,380 files (1,384 candidates less the four
historical assistant notes), totaling 12,611,447 uncompressed source bytes. Its
3,527,642-byte archive has SHA-256
`da24cdaa3604dc800e335419ab68127eaf6aed068de3a1aba7cddc03b922dda2`.
Every entry passed the copy/archive/extract/hash comparison. The separate export
again restored the locked dependencies offline with scripts disabled: 509
packages reused, zero downloaded. Full workspace types/build and formatting
passed. This archive predates the test-fixture corrections below.

The built API was started from that extracted source, with a fresh disposable
operator key, loopback address, process-lifetime PGlite, disabled scheduler and
no configured model providers. No operator data or credentials were copied.
The actual runtime/browser smoke passed all eight recorded checks:

- PGlite migrated and the server became ready.
- An unauthenticated catalog request returned 401.
- Authenticated catalogs returned 30 guides and ten new tools in all seven
  languages, with private/no-store caching and strict locale validation.
- Direct `/skills` served the exact built HTML under the hidden parent path.
- A Chromium phone viewport completed the real first-run English selection,
  rejected an incorrect key and established the real authenticated session.
- Catalog search, keyboard guide expansion and an editable project draft worked
  against the real API. The draft flow created no task and made no model call.
- Model providers remained unconfigured and the scheduler remained disabled.
- All 198 rebuilt frontend files matched the previously tested production build.

There was no browser request mocking in this smoke. The browser and owned API
process were closed afterward. The inspected phone-sized capture is
`runtime-skills-en-phone.png`. This proves a local Chromium viewport and real
development API flow, not a physical phone, private HTTPS, native Safari,
production PostgreSQL or container installation. The 903-case browser fixture
suite was not rerun for this server-only change; its exact frontend bytes were
unchanged.

`runtime-smoke.json` and `runtime-server.log` hold the passing evidence.
`runtime-smoke-initial.json` and `runtime-server-initial.log` retain the failed
initial launch. `source-manifest-runtime-repair.json` preserves this archive's
manifest even after a later export refresh.

## Installed-language fixture repair

The real first-run UI correctly persisted `en` into the exported workspace's
`data/workspace-locale.json`. Running the full source suite in that installed
workspace exposed eight older tests that had asserted Turkish output or saved
locale without explicitly selecting Turkish. The full failed run completed:
**1,321 total, 1,307 passed, eight failed, six skipped**, in 740.4 seconds across
210 files. Its log is `acos-source-preview-repaired-full-source.log`.

Five test files now explicitly select Turkish for their Turkish-specific
execution fixtures. The consumed historical approval fixture, which has no
saved execution language, checks the exact recovery message for the actual
workspace language. The language preference was not erased or changed to make
these tests pass. Authority, receipt identity, lease fencing, single-use and
no-replay assertions remain in place. Application language selection was not
changed.

The first focused correction exposed one later assertion in the same CEO test:
**88 passed, one failed** (`acos-source-preview-locale-fixture-green.log`; the
filename is historical, not a success claim). After correcting that remaining
workspace-language expectation, all five files passed **89/89, zero
failed/skipped**, in 45.3 seconds
(`acos-source-preview-locale-fixture-final.log`). The earlier narrow reproduction
is retained as `acos-source-preview-locale-fixture-red.log`.

All 1,380 installed source files matched the main workspace before the final
full rerun. Compared with the successful runtime smoke, only these five test
files changed; `candidate-before-final-source.json` records each final hash and
the retained English preference. Full workspace type checking passed again
(`acos-source-preview-final-types.log`). The final full source rerun completed
with exit 0: **1,321 total, 1,315 passed, zero failed/cancelled, six skipped**, in
725.1 seconds across 210 files (`acos-source-preview-final-full-source.log`).
The six exclusions remain five unavailable native PostgreSQL checks and the
Windows output-symlink fixture whose setup returns `EPERM`; none is a pass.

The main workspace API bundle was also rebuilt successfully after the server
repair (`acos-source-preview-workspace-api-build.log`). The matching frontend
does not need a rebuild or a repeat of the 903-case fixture suite for test-only
locale changes. Its real-server smoke and exact 198-file comparison are separate
evidence, with the limits stated above.

## Final source consistency

The installed test tree is kept fixed while the two verification documents are
updated in the main workspace. `final-source-provenance.json` records the final
test summary, all installed source hashes compared with the frozen input, the
retained English preference, unchanged frontend build, document-only changes and
empty Git index. The completed logs are copied with SHA-256 records into the
ignored `test-results/publication-review/logs/` directory.

Final packaging uses the same explicit source list and full archive roundtrip
checks. `source-manifest.json` records the final archive path and hash;
`final-export-provenance.json` must confirm that every application/test source
matches the passing full-run snapshot, with only the two reviewed verification
documents differing. The archive's `.sha256` companion provides its fingerprint.
No dependencies or runtime state from the installed test directory enter the
source archive. This remains a local source preview, not an exact Git commit or
authorization to upload source/history.
