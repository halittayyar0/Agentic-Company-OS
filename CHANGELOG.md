# Changelog

All notable changes to Agentic Company OS are documented here. The project uses
[Semantic Versioning](https://semver.org/). The public API remains pre-1.0.

## [0.3.5] - 2026-09-30

### Improved

- When the native PostgreSQL endurance check cannot restart its database, its report now records bounded process, endpoint, and PID-file state. The probes preserve Windows process handling and never include command output, database logs, paths, or credentials.
- The public landing page browser test now closes Chromium before its local HTTP server, preventing an open browser connection from holding Windows CI until its job timeout.
- The native process smoke now recognizes bounded health degradation caused by its own worker and database outage commands. It still rejects degraded samples outside those exact windows; the long-run verifier continues to use its seeded fault schedule.
- Windows installation now uses an OS-owned named pipe for its single-installer lock, so an unrelated TCP listener cannot block setup. The Windows source-test job uses a scoped Node 24 WebAssembly workaround while an upstream V8 crash remains open.

The intermittent Windows CI failure is still under investigation in issue #29. Local native process and ten-minute recovery runs passed; this release adds evidence to distinguish a failed server start from a command reporting failure after the server is already running.

## [0.3.4] - 2026-09-30

### Improved

- The setup wizard now names the requirement blocking the selected installation mode, with a short action and guide link in all seven languages. It distinguishes a missing Docker command, a stopped engine, Windows containers, missing Compose v2, and unsupported Node, operating system or processor.
- Operators can recheck the computer without losing setup choices. An uncertain recheck disables Continue until a fresh result arrives; the setup guide opens separately so the private session remains available.

The readiness check covers local prerequisites only. The reviewed installation rechecks them and verifies its database and runtime. Provider access needs a separate explicit test.

## [0.3.3] - 2026-09-30

### Improved

- Model Settings now prefers an available tool-capable test model, starting with a free identifier and then an economy-tier option when the catalog offers one. A manual selection is never replaced.
- All seven languages distinguish a successful chat-only connection test from agent-task readiness. A current, tool-capable model test links back to Projects so an operator can inspect the next attempt. Every test still requires separate confirmation and may incur a provider charge.

The test proves only that the selected model replied at that settings revision. It does not exercise tools, guarantee later access, or verify every worker has applied the configuration.

## [0.3.2] - 2026-09-30

### Fixed

- Projects created before a model is connected now remain in the retry queue instead of becoming permanently blocked after repeated setup failures. Setup-only retries do not consume an optional project step budget. The current attempt records a distinct provider-setup reason and shows a localized explanation.
- Saving a usable, tool-capable model connection wakes only unleased projects whose current attempt was waiting for setup. Split worker runtimes refresh their provider revision before retrying model selection.
- The home composer and detailed project form explain the waiting state in all seven languages and link directly to model settings. Creating a project still preserves the brief while setup is deferred.

Configured credentials are not a connection test. The explicit model test in Settings remains available; projects can still retry after authentication, billing, or network failures.

## [0.3.1] - 2026-09-30

### Added

- Three model-free local utilities inside the installed workspace: CSV inspection, JSON structure mapping and list comparison. The same deterministic checks run on the public start page and in the private app, with seven-language reports and downloadable text results.
- A direct Home link to the utility workbench so a fresh installation can produce a useful result before a model provider is configured.
- A dedicated lazy-route transfer budget and browser acceptance across all seven languages, narrow screens, local file input, report download and the no-upload boundary.

Agent work still requires a connected model provider. Local checks do not start or simulate an agent task.

## [0.3.0] - 2026-09-29

### Added

- Shareable, text-free evidence packets for one selected task-activity page, with SHA-256 checksum and an offline verifier included in the portable installer. The packet does not authenticate its creator or establish task success.
- Separate German, Russian, Simplified Chinese, Traditional Chinese and Arabic welcome READMEs, with a seven-language switcher and English as the default entry point.
- Twenty task-specific work guides in all seven languages, bringing the built-in catalog to 50 guides with explicit inputs, procedures and acceptance checks.
- Ten bounded data/document processors for CSV grouping and selection, JSON paths and flattening, list comparison, literal text operations, Markdown tables, exact unit conversion and calendar intervals. The 34-tool capability catalog retains lazy schema loading, pack revocation and personal utility presets.
- Seven-language `pnpm run setup` wizard for native PostgreSQL or Docker Compose, private credentials, interruption/resume, tool packs and optional private HTTPS phone access.
- Persisted read-only, approval, full-access and custom execution policy with fresh effect checks and revocation of stale automatic grants.
- Personal guides, utility presets and revision-bound Node programs with import/export, enable/disable and recorded execution; 12 additional data/document processors.
- Isolated Git source workspaces with agent projects, recorded checks, exact tested-revision application and rollback commits. Application deployment and database rollback remain separate operator tasks.
- Linux container, Windows native and macOS Intel/Apple Silicon verification workflows, secret-history scanning and CodeQL analysis.

- Durable UUID admission and exact authenticated receipt queries for Terminal and Browser actions (migration 0025), encrypted Terminal output recovery, worker effect fencing, and seven-language local review. Older local-only records are not replayed or upgraded. Deploy API and UI together and retain the matching runtime key with protected database backups; see [operator recovery](docs/operator-recovery.md).

- Required UUIDs and compact, atomic receipts for all manual meeting writes (migration 0024), with project-scoped receipt checks, original-identity retries and seven-language recovery review. Meeting creation saves a draft before an explicit model start. Deploy the matching API and clients together; see [meeting upgrades](docs/meeting-turns.md).

- First-run selection for Turkish, English, German, Russian, both Chinese scripts, and Arabic, with persistent workspace language for subsequent agent turns and RTL direction for Arabic.
- Private phone-browser access guidance using the existing responsive web UI, HTTPS and an operator-protected private network route.
- Root-project-scoped meetings with durable participants, transcripts,
  decisions, action items, bounded tool-free agent turns, and cross-project
  access isolation.
- Persistent Company Room membership, explicit `@mention` routing, ambient
  role-relevance routing, and a model-level no-reply gate.

### Changed

- Expose saved model turns in a project-level recovery inbox even when the meeting is absent. Add paged storage discovery, explicit damaged-record review, original-input acknowledgement and seven-language recorded-reply/skipped-expert inspection. Allow reviewed local clearing after a missing receipt without automatically retrying or cancelling server work.
- Budget the model-turn inbox at 1,330,000 raw / 392,000 gzip aggregate code bytes and its seven language packs at 29,000 / 12,000 bytes. Other per-asset, media and locale-family limits remain unchanged.
- Localized global and project Operations in all seven languages, including evidence inspection, stale states and operator reconciliation. Keep original evidence text, show bounded history and explicit timezone, and distinguish sample coverage from endurance. Phone summaries use two columns and Arabic sheets follow reading direction.
- Preserve the exact reconciliation decision and note after an uncertain response; check server evidence before identical retries, and keep open reviews when a bounded snapshot omits their receipt. Drafts and unresolved decisions now survive same-tab navigation/reload, with an independent recovery panel, scoped exact receipt reads, original server audit review and explicit local clearing. Validate the 2,000-byte UTF-8 note bound before sending.
- Account for selected Operations translations and guarded review with explicit aggregate bundle ceilings of 1,320,000 bytes raw and 389,000 bytes gzip. Keep existing per-asset/media limits and aggregate Operations-pack limits of 100,000/36,000 bytes.

- Localized Company Room membership, mentions, message history, reply status and uncertain-send recovery in all seven languages. Preserve source text; support Arabic phone layouts, composition keyboards and loading older history without forcing the reader to the latest message.
- Persist Company Room send identities and receipts with migration `0020`. A replay returns the recorded message without repeating the model round, including after emergency stop or membership changes. An interrupted round remains explicitly unconfirmed.
- Limit product CSS scanning to the app sources and co-locate shared vendor groups. Increase the aggregate selected-language gzip ceiling from 362,000 to 364,000 bytes for room recovery, history and translations; retain raw and individual-asset ceilings.

- Localized Team Studio catalogs, configuration, recovery and receipts in all seven languages. Installation intents use durable request receipts to recover the original result after uncertain responses.
- Localized the approval inbox in all seven languages, including phone layouts, RTL, decision history and host-command confirmation. Preserve exact source commands and operator notes; distinguish recorded approval and permission consumption from successful execution.
- Reworked the shared visual system around readable controls, cool neutral surfaces, system color-mode preference and semantic status colors. Project cards now identify the actual owner instead of implying that every active agent belongs to every project.
- Localized the Home journey and quick project composer in all seven selectable languages, including examples, validation, status badges, and saved work-approach labels. Home language packs load on demand and the bundle gate measures one selected language plus the shared app.
- Localized the Projects list in all seven selectable languages, including search, filters, owner and progress labels, plus empty/loading/error states and Arabic right-to-left layout. Only the selected Projects language pack loads.
- Localized full project creation in all seven languages, including validation, team and safety states, priorities, cadence, and failure feedback. Form controls have visible labels and phone-sized targets; Arabic radio keys follow visual direction.
- Localized the shared emergency stop and resume controls in all seven languages, including confirmation, safety warnings, and error recovery. A missing safety language file falls back to English while the control stays operable.
- Localized command search and shared dialog, sheet, toast, and search-clear controls. Command search restores keyboard focus, dialogs fit short phone screens, and Arabic controls use logical alignment.
- Localized theme, working-expert status, and sign-out feedback. The Arabic phone menu opens from the right with a keyboard focus trap, and phone controls use larger touch targets.
- Localized the Expert directory in all seven languages, including role explanations, department names, search, filters, pagination, and empty/error/stale states. Stored names and custom roles are preserved. Search handles accented letters and Arabic marks; phone selects have larger targets and logical alignment.
- Load sign-in language files on demand, keeping the workspace closed on language-asset failure and retaining safe UI copy after an unauthorized response. Exclude unused legacy component styles from the production stylesheet, with an import guard, while keeping the existing transfer budgets.
- Localized New expert forms, validation, permissions, template names, and model selection in all seven languages. Preserve edited identity, custom instructions, and canonical department keys; explain unavailable models and verify manual selection before submitting. Arabic selects and switches follow the page direction.
- Load shell translations on demand with localized startup and recovery states available before any workspace request. The language chooser remains available without downloading every shell pack; total bundle limits are unchanged.
- Routed legacy `/activity` bookmarks to `/operations` without losing query state, removed the duplicate navigation entry, and focused the canonical heading after redirect.
- Replaced the fixed four-agent Company Room round with an uncapped roster and
  independently bounded per-message response budget.
- Moved meetings out of the global company conversation and into each
  project's own working memory.
- Rebased the aggregate raw-code bundle ceiling from 1.26 MB to 1.30 MB for the
  route-split meeting and room surfaces while retaining the existing gzip and
  single-chunk limits.

### Security

- Serialize approval decisions with emergency stop, check the live scope and expiry after acquiring decision locks, and reject changes to the optional reviewed digest. The inbox blocks incomplete previews and stale confirmation dialogs; uncertain results require a successful refresh before retry.

## [0.2.0] - 2026-09-29

### Added

- Public seven-language start page with runnable finite and recurring task examples.
- Portable installer that pulls an immutable Linux amd64/arm64 image; no Git, pnpm or source build required on the container path. Native source installation remains available.
- Economy-first execution, on-demand authorized tool schemas, bounded recursive delegation and automatic hiring.
- Durable current-cycle and rolling-day usage admission before execution and review calls; explicit unknown and partial reported-cost coverage.
- Model-free waiting for finite children, provider-outage backoff for unavailable completion review, and room for reasoning models to return a review verdict.
- Real container installation/resume acceptance and opt-in free-only live finite/recurring task proof.
- Updated fast-uri to 3.1.7 for GHSA-58mr-gqgx-xq4g; verified the upstream malformed-host regression cases.

See [release verification](docs/verification/2026-09-29-efficient-autonomy.md) for the acceptance scope and remaining limits.

## [0.1.0-alpha.1] - 2026-08-29

### Added

- Durable finite and continuous task ownership with scheduled wake-ups,
  lease-safe recovery, bounded provider retries, and observable model fallback.
- Per-task model pin and runtime route telemetry.
- User-changeable, locally processed agent avatars with a separate bounded image
  endpoint, versioned caching, and reset-to-default support.
- A blocked-task handoff card that preserves the operator's answer on failure
  and returns the responsibility to the autonomous queue after a successful
  response.
- Responsive company navigation, compact agent workspaces, light and dark themes,
  and a run-centered status receipt on the company workspace.
- A versioned Workforce Studio with three installable team blueprints, explicit
  handoff contracts, parent-bounded authority, and atomic optional root-task
  creation.
- A sanitized six-stage Run Inspector plus an Agentforce-inspired capability
  contract that separates agent role intent from enforced data, action,
  guardrail, and channel permissions.
- GitHub CI, CodeQL, secret scanning, Dependabot, container smoke tests, and
  production dependency license checks.

### Changed

- Reworked the operator UI from a decorative mission-control treatment toward a
  legible, task-first company workspace.
- Moved bundled portraits into a Vite-hashed, compressed asset and expanded the
  bundle budget to cover media files.
- Paused hidden computer/browser surfaces and stretched idle polling while
  keeping active work on a faster live cadence.
- Counted every task-attributed usage-ledger entry, including judge reviews,
  toward finite-task token and provider-reported-cost circuit breakers.

### Security

- Powerful browser, terminal, sudo, publishing, deletion, spending, and external
  communication paths remain fail-closed behind runtime permissions and scoped
  human approval.
