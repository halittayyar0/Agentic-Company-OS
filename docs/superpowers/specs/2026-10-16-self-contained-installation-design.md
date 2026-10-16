# Self-contained first installation

## Intent and authorization

People with minimal technical knowledge should extract a Windows, macOS or Linux package, start it, choose a language and model connection, and complete a first task without installing Node.js, Docker, pnpm, Git or PostgreSQL. The user explicitly requested fresh-package installation tests, fixes and GitHub publication and previously instructed us to make routine decisions and finish without confirmation. Those instructions replace additional design/plan approval stops. Execution is inline, with independent review before integration.

## Choice

Ship a platform-specific portable application containing a pinned Node 24 executable, PostgreSQL 17 binaries, the compiled API/workers/UI and their production dependencies. Reuse the existing seven-language setup and durable PostgreSQL runtime. This avoids global dependency installation and an additional desktop framework. Keep the existing Docker distribution and source installation as advanced alternatives.

Targets: Windows x64, macOS x64/ARM64, Linux x64/ARM64. Do not claim Windows ARM native support or Alpine/musl support. Ordinary user execution; PostgreSQL cannot run as root. No administrator privileges, global PATH edits, background OS services, payments or disabling Gatekeeper/host security. Unsigned packages may produce normal OS trust prompts; document that accurately.

## Package contract

- Fresh output directory; exact source commit; fixed upstream URLs and SHA-256/SHA-512 checksums; no install-time package manager or downloaded scripts.
- Include runtime attribution/licenses and build input provenance. Do not execute upstream npm lifecycle scripts. Materialize necessary bundled-library aliases inside the package after validating their targets.
- Existing API layout, migration journal, environment-secret loading and production behavior remain authoritative. PGlite remains development-only.
- `native-distribution.json` identifies the exact source, host target, Node/PostgreSQL versions and a bounded inventory of relative regular files with byte counts and SHA-256. Reject traversal, absolute paths, duplicates, unsupported targets, wrong executable versions and changed/missing bytes. Runtime input artifacts must not be inferred from whatever is on PATH.
- Windows `START.cmd` and Unix `START.command` run the bundled executable relative to their own location, supporting spaces and Unicode. Open the private local setup URL in the default browser; retain a printed fallback. A no-browser option supports headless/server tests. Launch again resumes the retained installation through a private last-installation pointer, without exposing its token.
- Data, passwords and model credentials live outside the extracted package in owner-private storage. A release archive contains no user data or secrets.

## Managed native database

Native bundle capabilities report an included database. The wizard defaults to this native path and does not request a PostgreSQL URL. Source setup keeps its existing explicit external-database contract. The legacy container package keeps its pinned-image behavior.

The installer generates a random password and reserves an available loopback port. Create an owned PostgreSQL cluster with UTF-8, C locale and SCRAM authentication, fsync/durability enabled. Initialize in a new staging directory; publish it only after successful initialization. Persist identity/major-version metadata, never adopt or overwrite an unfamiliar database. Reuse the recorded database port and secrets on resume; a collision fails safely. Start one API and two actual workers from the shipped build, without compilation. Shut down workers/API and the owned database; retain data for the next launch. Interruptions, partial initialization, duplicate launch and failed startup must release ownership and leave useful bounded diagnostics without printing credentials.

The production startup still applies the checked-in migration chain and actual topology probes. Existing permissions, approvals, budgets, provider boundaries and secret isolation are unchanged. No silent fallback to an in-memory database, simulated task or paid model.

## First task

Reuse existing onboarding/model-connection/first-job flows. A model connection is still necessary: the application does not invent credentials or bundle model weights. The setup must make this next step clear. Acceptance includes one new actual local-model job through a freshly extracted final package on Windows; CI first-job tests on other targets may use a controlled provider but must label that scope. A provider-free successful installation is not a successful AI task.

## Verification and delivery

Unit regressions cover manifest validation/tampering, no-source native execution, database ownership/resume/failure cleanup, launch arguments and hidden database inputs in all seven languages. Build then extract each actual archive into a new directory outside the checkout; restrict PATH so installed Node/Docker/pnpm/PostgreSQL cannot satisfy the test. Prove bundled runtime/database versions, real migrations, API/two-worker topology, first job, clean shutdown and resume retaining task data. Every supported archive needs an actual matching-OS/architecture CI check, including Linux ARM64; do not substitute cross-compilation for execution.

Retain existing source/UI/security/platform release gates. Publish only after review and required gates, with platform download links, checksums and scoped verification receipts. Keep failures and diagnose rather than weakening test assertions. Never claim physical-device or 24-hour proof from this work.
