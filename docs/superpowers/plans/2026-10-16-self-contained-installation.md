# Self-contained installation implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Use one independent whole-branch review before integration.

**Goal:** Extract, start, connect a model and complete a first task without separately installing infrastructure.

**Architecture:** Add a verified native bundle to the existing setup. Own a private PostgreSQL process beside the existing API/workers; reuse setup, secret storage, migrations and first-job flow.

**Tech stack:** Node 24, TypeScript/esbuild, PostgreSQL 17, minimal bundled production externals, GitHub Actions.

**Spec:** ../specs/2026-10-16-self-contained-installation-design.md

## Global constraints

- Targets: Windows x64, macOS x64/ARM64, Linux x64/ARM64; Node >=24 <25; pnpm >=10.17 <11 is build-time only.
- End-user package needs no global Node/Docker/Git/pnpm/PostgreSQL. Ordinary user; loopback; owner-private data; no silent permission or database fallback.
- Keep legacy Docker/source installations, seven languages, existing production gates and durable migrations.
- Exact downloaded byte checksums and source provenance; no upstream install scripts or user secrets in archives.

## Review focus

1. Paths with spaces/Unicode and changed executable bytes must not invoke PATH tools or escape the bundle.
2. An interrupted database initialization or unrelated existing directory must not be adopted or destroyed.
3. Resume/duplicate launch/port collision must preserve data and prevent two owners.
4. Default wizard must not ask native-bundle users for infrastructure credentials or misreport model readiness.
5. Shutdown/failure must leave no owned service running or credentials in public output.

## Tasks

### 1. Manifest and pinned build inputs

Files: new `scripts/src/setup/native-distribution.ts` and `.test.ts`, `deploy/native-runtimes.json`, build helpers under `scripts/`.

Interface: `readNativeDistribution(root)` validates target/manifest and actual file hashes; returns null only when the manifest is absent. Fixed runtime input metadata covers the five targets.

- [ ] Write and run failing regressions for strict schema, traversal/duplicates/target mismatch, missing/tampered bytes and absent manifest.
- [ ] Implement strict bounded parsing, required runtime/application files and host validation. Verify focused tests pass.
- [ ] Pin official Node binaries and PostgreSQL/zlib source inputs and licenses with checked hashes; inspect upstream archive layout without executing lifecycle scripts.

### 2. Managed PostgreSQL and native installer

Files: new `scripts/src/setup/managed-postgres.ts` and `.test.ts`; modify installer/resources/bootstrap/preflight/resume as required.

Interface: bundled setup supplies a verified native-distribution object; managed database preparation returns its secret URL and owned lifecycle operations. Existing unbundled executor behavior stays the default.

- [ ] Add failing tests for generated private connection, native prebuilt path requiring no pnpm/build, cluster identity, interrupted initialization, unsafe directory, duplicate ownership and shutdown order.
- [ ] Implement staged initdb, SCRAM/loopback startup, exact ownership/major checks, bounded readiness and retained-data shutdown; integrate resource creation and resume.
- [ ] Run meaningful installer/resource/deployment/resume/managed-database regressions; prove source/container behavior remains intact.

### 3. Self-contained archive and launch flow

Files: new `scripts/build-native-setup.mjs`, narrow extraction helper, launcher/bootstrap helpers and corresponding tests; retain existing `scripts/build-setup.mjs`.

Interface: builder takes exact commit, fresh destination and pinned target; emits compiled runtime layout, platform launcher, manifest, notices and archive/provenance. The compiled API carries its bundled dependencies; copy the real PGlite and playwright-core package trees, retain installed dependency notices, and require the actual extracted first-job/runtime gate to catch missing externals.

- [ ] Pin failing checks for launcher relative executable resolution, safe arguments and absent global infrastructure.
- [ ] Build the real Windows archive with bundled runtime/PostgreSQL; extract to a new path with spaces/Unicode and start using a restricted PATH.
- [ ] Implement browser opening/fallback, no-browser mode and owner-private auto-resume pointer; test arguments, invalid pointer and duplicate launch.
- [ ] Verify package inventory, checksums and no source/dev dependency requirement at runtime.

### 4. Wizard and first-job experience

Files: setup-client.js/page.ts, relevant setup/browser tests, README language variants and self-hosting documentation.

- [ ] Read Apple Design and applicable frontend context; preserve the existing design while changing this flow.
- [ ] Add failing browser checks for bundled-native default, hidden/omitted database credential, explanatory included-runtime copy and language switching for all seven locales.
- [ ] Implement truthful bundled-native capability UI, keep advanced alternatives, and make the model-connection next step clear.
- [ ] Complete a new actual local-model task from the freshly extracted package; check durable calculator outputs, completion/review, actual usage and restart persistence.

### 5. Matching-host CI, review and GitHub delivery

Files: native distribution workflow, archive installation smoke harness, release verification metadata/expectations, docs and version/changelog.

- [ ] Add actual archive extraction/install/first-job/stop/resume gates for all five matching targets, with restricted PATH and isolated user data; record controlled-vs-real provider scope.
- [ ] Run local focused gates, types/build/format, full Windows source and relevant browser gates. Keep existing release checks and accurate test census.
- [ ] Obtain independent whole-branch review; fix concrete findings with regression evidence.
- [ ] Push/attach PR; wait required original CI/platform/security and native archive checks, merge when passed, qualify exact main and produce new public assets.
- [ ] Publish scoped release, anonymously re-download/hash/check archives and write the finite completion receipt. Do not mark the unrelated long-term goal complete.

## Execution ledger

- 2026-10-16: Baseline public main `1bae2b055ae60615373930c4749d4a272fb0c233` was fully qualified and released as v0.5.3 in this conversation. Reused the clean attached recovery worktree; new branch `codex/self-contained-installation-20261016`. D: checkout has unrelated changes and is not being edited.
- Ruling: Use full platform bundles rather than automatically installing global prerequisites or introducing another desktop framework. This directly meets the user's no-infrastructure-setup requirement and preserves the existing production runtime.
- Ruling: User's explicit ongoing authorization and no-confirmation instruction replace skill approval stops. Implement inline and review the concrete result before publication.

- Inputs ruling: rejected the trimmed npm PostgreSQL payload (missing dump/restore/readiness tools and incomplete payload notices). Build official PostgreSQL 17.10 with pinned static zlib 1.3.2 and static MSVC CRT. The initial direct static-libpq proposal failed actual Windows linkage on encoding symbols; retain upstream shared libpq, relative Unix runtime paths, and relocated/ad-hoc-signed Darwin library references. Original failed local build logs are retained.
- Source-build repairs: use the MSVC linker before Git utilities; disable MSYS argument conversion for native /nologo switches; accept case-insensitive Meson ZLIB metadata names. The final helper reports all packaged runtime file hashes.
- Independent review fixed explicit native-resume commit bypass and persisted recovery identity before PG initialization/start. Module library search supports both PostgreSQL lib layouts, and archive smoke loads dblink/postgres_fdw before backup.
- Actual UI: all seven managed-database locales tested in Chromium, including 320px Arabic RTL; root inspected retained English/Arabic screenshots. Focused setup cases 28/28 passed before recovery changes; installer/resume changes 7/7 pass.
- Windows filesystem discovery: a full run on D: found that rewriting an already-correct owner needs extra ownership privileges. Keep owner unmodified and replace only access rules for fresh same-owned objects. Owner/storage 7/7 and registration 4/4 passed on both C: and D:; existing weakened or foreign storage remains rejected. Full run started before the fix and retains its original failures; a clean final run remains required.
- Node license review: authoritative Windows ZIP LICENSE differs from the pinned upstream tag only by CRLF versus LF. Keep exact ZIP bytes, compare normalized line endings only, and report the authoritative file hash.
- Source census expected delta: 12 setup cases plus one Windows ACL regression = 13. Expected total 2,674; the new ACL case is a named skip on non-Windows hosts. Confirm exact counts and all original skip names from final original CI logs before release.

- Windows development archive iteration 3 passed the actual fresh extraction in a space/Unicode path with restricted infrastructure PATH: 2,282 manifest files, Node 24.21.0, PostgreSQL 17.10, all six installation steps, controlled 391 first job, durable settings, private module load, binary backup/restore, retained task/operator identity on restart and verified process cleanup. Archive SHA256 96a4ee1a41a9a6ebb8590312f5aee30a558604bca684d26186f3f25eb2034d04. This is a development assembly, not the final clean-commit release artifact.
- Independent review revisited final module paths, Windows UTF-8 manifests, provenance-bound PG copy and ACL repair; no remaining Important findings. Fresh committed artifacts, all matching-host CI and actual local-model task remain publication gates.

- The original local full Windows source run finished with 2,674 cases: 2,625 pass, 14 failures, 35 named skips, zero cancellation. All 14 failures arose in five storage-dependent files started before the ACL fix; original output is retained. Re-running those five affected files on D: with the fixed storage implementation, rather than hiding the original result. Final hosted full-source gates remain mandatory.

- The five affected Windows source files passed a complete rerun: 17/17, zero failures or skips. The original failing full run remains retained.
- Original PR64 native run 38963801286 passed both macOS targets and both Linux targets. Windows exposed the hosted runner full-administrator token, which PostgreSQL correctly refuses. The supported package requires an ordinary account. Add an early native admin/root diagnostic and a CI-only disposable non-administrator fixture; do not weaken PostgreSQL, UAC, storage or machine policy. The two token regressions increase source census to 2,676 with unchanged named skips.

- A clean candidate `eec38322eba6ab7fa29d433b463d943b039ec00b` Windows archive completed a genuine CPU `qwen3.5:2b-q4_K_M` first task: 58.5 + 14.5 = 73 EUR, calculate/complete_task/model review, three actual calls and 7,882 reported tokens including review. No paid provider, fallback or delegation. Fresh Unicode-path installation, private modules, durability, binary backup/restore, retained task/identity after restart and cleanup all passed. Archive SHA256 `797413e9c9bf885833a4e18582ff0433bd850ace84ac9784aec92bf68e7f963e`. Final exact-main archive still requires its own fresh model acceptance.
- Public onboarding was corrected in all seven languages. Actual static Chromium checks passed English desktop and all languages at 320px, including Arabic RTL; no overflow or page errors.
- Hosted Windows fixture debugging is separate from application acceptance. Original `Get-Command` returned multiple application paths; the original array-to-path exception was reproduced, then all 11 scalar/path cases passed. A separate manual-only diagnostic branch retains original failed observations without rerunning failed workflows or resetting the ordinary application test runs for each probe.
- The original credential launch exceeded the documented CreateProcessWithLogonW 1,024-character command-line limit; the original diagnostic reported Windows error 87. An 824-character hash-checked reader created the process. A subsequent booleans-only diagnostic proved that Windows PowerShell 5.1 credential launch did not inherit any of the four custom environment fields. Transport now binds the child source and JSON inputs together and reads a fixed relative payload from the owned working directory.
- A separate noncredential, hidden, owned-process PowerShell 5.1 fixture reproduced null exit status after WaitForExit/Refresh; opening the exact process handle before waiting retained the actual exit code 17. No local account, service, host security-policy or user ACL change was made by these local diagnostics. Full hosted ordinary-user archive acceptance remains mandatory.
- All original candidate `61592d8` source/UI/container/platform/native workflow jobs passed; all five fresh native archives independently matched 11,391 inventory files. Canonical pre-merge verification nevertheless blocked on scoped CodeQL alerts 52/53. The original SARIF and all workflow/artifact evidence remain retained; no merge, alert dismissal or release occurred.
- Security correction: runtime downloads use a closed set of reviewed literal Node URLs and require the configuration to match. Public setup diagnostics project only known literal phases/steps plus a generic error; HTTP error payloads/private URLs are not copied into public receipts. Two bounded URL/privacy regression cases increase complete source census to 2,678 with unchanged named skips. Fresh original security analysis, source/UI and all five package gates remain required.
- Candidate `8c4edc9` fixed both CodeQL alerts by new analysis (zero results/open scoped alerts, no dismissal); all five archive checks passed again. Its original Intel source job `117248435232` failed one leaf lifecycle case (2 reported failures including parent, 2,678 total/2,635 pass/41 skips). A dispatched judge request failed before usable response usage, so accounting correctly blocked the task before its intended finalization barrier. The original transport cause is not recovered from that log; no production-accounting defect is claimed.
- Fixture isolation correction: the owned judge peer closes each response rather than pooling idle connections across heavy database cases. A new regression first requires two actual SDK responses on separate closed connections (observed red with one retained idle socket, then green), then deliberately drops one judge response and proves one request/no retry, no barrier entry and an accounting block. All six existing lifecycle conflicts now also assert barrier entry before their unchanged rollback assertions. Production settlement, deadlines and retries are unchanged; complete source census becomes 2,679 with unchanged skips.
