# Emergency language boundary and remaining release proof

Status: focused safety, browser and refreshed installed-source checks passed.
Goal 7 is not complete; the remaining external and user-controlled requirements
are listed below. No production code was changed for this audit.

## Correction to the previous translation finding

The earlier runtime-status report identified the Turkish `task_status_changed`
summaries in `runtime-emergency-stop.ts` as an outstanding display translation.
Tracing the reachable UI and its actual query scopes does not support that
classification:

- These are global source audit rows: both `agentId` and `taskId` are null.
  `/api/activity` returns their original stored content to authenticated clients.
- Current expert activity queries specify an agent. Project activity queries
  specify a task. Those predicates exclude the global audit rows. Project trace
  code also discards records outside its task scope.
- `/activity` redirects to `/operations`. The active Operations surface consumes
  its typed read model and translated UI packs, not these raw global summaries.
  Version-one Operations event kinds already have seven-language display labels.
- `CompanyCommsDock` contains an older global activity panel, but has no importer
  in the registered application. Its dormant strings are not evidence of an
  untranslated reachable screen. This audit does not reactivate that component.
- The emergency dialog/banner use their existing selected-language copy, with
  an English safety fallback if that language chunk is unavailable. User-entered
  reasons remain original source content.

The raw audit text is therefore retained as source evidence. No new event schema,
UI label mapper, API language parameter or locale-file read was added to the stop
transaction. This corrects the earlier gap classification; it is not a claim of
native-speaker acceptance or proof that every future UI consumer is localized.

## New regression evidence

`runtime-emergency-locale-boundary.test.ts` uses an owned temporary workspace and
process-lifetime PGlite. Three cases first demonstrate that the real locale reader
rejects invalid JSON, an unsupported locale and an oversized preference. Each then
proves that:

1. Calling emergency stop activates the local execution fence synchronously,
   before awaiting database work.
2. The durable stop state, original operator reason, source audit row and typed
   Operations event are persisted; the audit rows have no agent/task scope.
3. Repeating the same request does not duplicate either event or change its
   control version.
4. Resuming releases the local stop after the durable transition; switching to a
   valid English preference later does not rewrite earlier audit evidence.

The focused group, including the existing lease-revocation, entrypoint-blocking,
replica-cleanup and interrupted-provider tests, passed **8 tests, zero failures
or skips**, in 16.2 seconds. Log: `acos-emergency-locale-boundary-source.log` in
the host temporary directory. The existing implementation already satisfied
this invariant; no production correction or failing-test claim is made.

The existing emergency-control browser selection passed again: **three passed,
zero failures/skips**, in **8.6 seconds** (`acos-emergency-locale-boundary-ui.log`).
It checks English stop/retry/resume confirmation, Arabic at 320 px and the safety
fallback when a translation chunk fails to load. The 320 × 700 Arabic light-theme
capture was inspected: the focused reason field, wrapping text and action buttons
remain within the dialog and viewport. Its hash is recorded in `snapshot-proof.json`
under `test-results/emergency-locale-boundary/`. These are repeated existing cases,
not three additional registered browser tests.

The separate source export restored **509 locked packages, zero downloads** from
the existing cache with lifecycle scripts disabled, then passed full workspace
types and the production build. Its full general suite passed **1,372 of 1,378
tests, zero failures/cancellations, six skips**, across **213 files**, in
**754,214.5922 ms**. Terminal session 73398 completed with exit zero;
`acos-emergency-boundary-export-full-source.log` records the run. English remained
the saved preference of that owned export after the suite. The six exclusions
remain five native PostgreSQL checks and one Windows output-symlink fixture
whose setup returned `EPERM`.

The snapshot has **1,390 candidate paths and 1,386 included source files**. The
same four historical assistant notes remain excluded only from the proposed ZIP.
Both workspace copies matched all **198 frontend files** of the earlier 903-case
full browser run. All production source, configuration, dependencies and existing
tests are unchanged from the preceding verified source preview. This turn adds
one test file and one verification document, and corrects two earlier documents.
No fresh single 910-case browser run is claimed.

Full formatting passed. The final archive, its checksum companion, source hashes
and log hashes are bound in `final-export-provenance.json` in that evidence
directory. Only the reviewed documents change after the full test snapshot;
all other included source hashes remain identical. No live model calls or
external writes were used. This is local process/PGlite proof, not native
PostgreSQL multi-connection, container or physical-phone proof.

## Completion audit

The goal is still unproven as a whole. The concrete evidence map is:

| Requirement                                                       | Authoritative evidence inspected                                                                                                                                                  | Remaining proof                                                                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Preserve existing work                                            | Empty index and final source roundtrip retain base HEAD `81151c63e4bbf35fad39256566b3e362fb3325d0`; scoped new test/document                                                      | Explicit publication selection                                                                                                              |
| Every registered page, themes, keyboard, font scaling, RTL        | `App.tsx` registrations, [route inventory](2026-09-27-route-acceptance-inventory.md), 903-case full Chromium checkpoint and seven later phone cases on identical frontend         | Native device/input/assistive-technology acceptance; these automated cases do not cover every conceivable state                             |
| Seven first-run and working languages, both Chinese scripts       | Typed packs, first-run/settings and authored role/skill catalogs; [runtime status audit](2026-09-28-runtime-status-localization.md); actual emergency query-scope review above    | Native-speaker review and any additional reproducible reachable-flow finding; original content remains original                             |
| Durable agents, tools, approval/retry and backend                 | Latest 1,378-source-test run, focused actual DB/HTTP/provider seams, ownership/receipt tests and new stop-language boundary                                                       | Native API/two-worker PostgreSQL topology and races                                                                                         |
| Phone access without our own app or mandatory paid dependency     | [Private browser access guide](../mobile-access.md), authenticated same-origin serving, phone viewport fixtures                                                                   | Actual installed phone over mobile data, private DNS/TLS, Safari/network verification                                                       |
| Format/types/build/bundle/licenses/audit/API generation/migration | [Combined gate report](2026-09-28-full-release-gates.md), [installed source report](2026-09-28-runtime-status-localization.md), unchanged product/dependency/configuration hashes | This delta passed format/types/build/full source; production dependency audit is not a source secret scan                                   |
| Native PostgreSQL and Docker                                      | Explicit local test skips and configured CI jobs                                                                                                                                  | Required environments and actual successful runs; a workflow definition is not execution evidence                                           |
| Source/history disclosure and exact release candidate             | Proposed source-only archives with per-file roundtrip hashes, earlier limited redacted triage and history path inventory; [release checklist](../release-checklist.md)            | Full content/history secret scan, selected exact commit/history, clean exact-commit checkout and successful remote CI/CodeQL/container jobs |
| Endurance truthfulness                                            | Verifier and provenance regression tests; release checklist forbids 24-hour claims from short runs                                                                                | No real 24-hour run; no such claim is made                                                                                                  |
| Keep secrets, cost and publishing under user control              | No staging/commit/push/publication, paid calls, account changes or external tool installation                                                                                     | Portable scanner request is still unanswered; publication and final repository choices remain user-controlled                               |

The full-history scanner, native/container/phone environments and exact-candidate
publication controls are concrete remaining requirements. A green local suite
does not complete them. Existing pending input is not treated as consent.

These same unmet prerequisites were recorded in the preceding publication-source
and runtime-status goal checkpoints and again in this checkpoint. The current
shell still has no `docker`, `psql`, `postgres`, `tailscale`, `gitleaks` or
`trufflehog` command; the service query reported no matching PostgreSQL, Docker
or Tailscale service. No configured native database or physical phone is available
to this verification. Download permission for the portable scanner remains
unanswered. Successful local work does not authorize installing it or publishing.

The local test/build/browser processes for this checkpoint finished successfully.
Progress beyond the completed source preview now needs the outstanding scanner
authorization and the appropriate native/phone environment, followed by a
maintainer-selected exact candidate and its remote checks. The goal remains
unachieved; additional repeats of unchanged local checks do not supply that proof.
