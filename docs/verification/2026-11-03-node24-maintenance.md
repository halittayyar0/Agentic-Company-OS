# Coordinated Node 24 maintenance

Status: local candidate in verification, not a released build. Baseline: published
v0.5.10, main `4df02635ba85ac18b0cbf4d2d6bdacafb7f4ba57`. Its acceptance applies
only to that revision; this candidate stages application version 0.5.11.

## Benefit and scope

All five native targets, all three Docker stages, source prerequisites, setup
copy in seven languages and active CI use Node 24.22.2. Earlier 24.x patches
cannot pass a new setup readiness check; a recheck on a supported runtime lets
the operator continue without losing language or installation mode.

The [upstream maintenance release](https://nodejs.org/en/blog/release/v24.22.2)
corrects callback context when stream writes wait for backpressure. Controlled
tests verify operation-local permission decisions in that situation. No owned
production stream callsite or production permission exploit was established.
The production policy implementation and effect admission rules are unchanged.

## Retained local evidence

- Existing policy/prerequisite baseline on Node 24.22.1: 13 passed.
- New context/minimum-version regressions on 24.22.1: four expected assertion
  failures and eight passes. These are semantic failures, not loader failures.
- The same context/prerequisite and affected package/compose tests on 24.22.2:
  27 passed, no skips. Both default and legacy async context implementations use
  real Node child processes and database-backed policy decisions.
- Setup browser suite: eight passed. Seven locales at 320 and 1024 pixels,
  direction/layout checks, rejection of 24.22.1, continuation on 24.22.2 with
  the selected language and native mode retained. No installation is submitted.
- Separate Turkish/Arabic 320-pixel setup screenshots were manually viewed:
  readable version requirement, retained RTL, ordinary document scrolling and
  disabled continuation, without horizontal overflow. These are browser
  viewports, not physical-phone evidence.
- Nested test processes retain the existing optional WASM GC workaround. A
  dedicated negative assertion exposed missing propagation before it was fixed;
  all three stream regressions then passed with the workaround enabled.
- An initial TypeScript check rejected cross-project imports from the API's
  compilation root. Moving the probe into the existing scripts integration
  project fixed it without expanding that root. Corrected type checks, build
  and bundle budgets passed; the original failed check remains recorded.
- Production and full dependency audits: zero known vulnerabilities. License
  policy passed. Artifact DNS retry tests: 12 passed.
- Clean migration entrypoint on 24.22.2 passed in disposable process-lifetime
  PGlite. It launched through the existing clean-environment gate with a fresh
  provider store; no user database or provider credentials were imported.
- Review-stage source snapshot: 2,435 files, 24.53 MB; source and full-history
  Gitleaks scans passed with empty finding reports. The final candidate snapshot
  covers 2,436 files; source and full-history scans also pass with empty reports.
- Complete local Chromium UI suite on 24.22.2: 1,517 passed in 51.4 minutes,
  two workers, zero retries/failures/flaky/skipped cases. The original successful
  exit, unique complete success IDs, summary and last-run file were checked and
  SHA-bound. This is local UI evidence, not original GitHub or actual-main proof.
- Original complete local source run: 3,170 tests, 3,135 passed, 35 skipped,
  zero failures/cancellations, in 76.3 minutes with concurrency one and the
  existing test-only WASM GC workaround. Its stream probe predates the optional
  constructor/queue permutation strengthening below.
- The additional local skip is `safe output rejects a linked overwrite target
without touching its referent`: this Windows session cannot create a symlink
  (`EPERM`). All 34 named Windows CI skips otherwise match. The release gate
  still requires 3,136 Windows passes and those 34 skips; it does not admit this
  extra local skip. Linux remains 39 skips and each Mac source stage 41 skips.
- The final stream probe separates construction from write-queue scope, including
  unscoped construction with scoped writes and scoped construction with unscoped
  writes. Both context implementations retain the constructor's scope on 24.22.2.
  The exact final probe still produces three semantic assertion failures on
  24.22.1; it and the updated producer/census contracts pass 29/29 on 24.22.2.
  No new top-level case was added during this coverage strengthening.
- Original source census plus three added stream tests establishes 3,170 cases
  in all four release source stages. Required pass counts rise by three and
  existing named skip sets stay unchanged. API code generation produces no diff;
  final whole-workspace type checks pass after the test and census changes.
- Final formatting passes with the nested CLI explicitly selecting Node 24.22.2.

Original protected PR/platform/native jobs and
exact actual-main acceptance are pending. No native package, genuine model task,
persistent PostgreSQL or public distribution evidence is claimed for this new
candidate yet.

The local host has no Docker CLI, so no local container build was executed.
The new candidate's original production/endurance container CI remains required.

The additional whole-project frontend static auditor did **not pass**. A bounded
diagnostic and traced parser state proved an identical-state loop at offset
9707 in the unchanged `tests/ui/home-start-recovery.spec.ts`. The tool uses
inconsistent prefix boundaries to decide whether the same slash begins a regex.
The inspected file matches the released baseline byte-for-byte. Only the owned
stuck auditor was stopped (exit -1); its original output and diagnostic proof
remain retained. The installed tool, application and test source were not
modified to evade that limitation. Source/browser checks remain separate.

## Runtime inputs and compatibility

The official latest-24 index identifies 24.22.2 with `security: false`. The five
archive checksums in `deploy/native-runtimes.json` match the official checksum
list. The separately staged Windows executable reports v24.22.2 and has SHA256
`1c331340fa6cac5e4294725959070a143fa0507195a78ad77eed7943f719aac9`.
The pinned official Docker index is
`sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c`;
its manifest includes amd64 and arm64.

Node license bytes are unchanged. PostgreSQL 17.11, pnpm 10.17.1, the Windows
helper source/executable/provenance/notice, upgrade protocol 1, model pins,
permissions and task deadlines remain unchanged. Historical release fixtures and
security-release links retain their original versions. This maintenance patch
is not described as a security release.

## Limits and next gate

The stream is constructed inside the creating operation's scope. Writing from
another scope does not transfer ownership of an externally constructed stream;
a stream constructed without scope must not borrow the draining reader's scope.
The controlled probes perform no filesystem, browser, model or delegation effect.
PGlite evidence is process-local, not persistent PostgreSQL proof.

Physical phone, Safari and 24-hour reliability evidence are absent. The next
gate is the exact candidate's original protected checks, followed by an ordinary
merge and independent actual-main/native qualification before publication.
