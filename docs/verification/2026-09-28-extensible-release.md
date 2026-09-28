# Extensible alpha release — 28 September 2026

This record supersedes the outstanding implementation descriptions in earlier
dated checkpoints. Those records preserve their original failures and results.
For release approval, use the required GitHub checks on the exact installed
revision; older successful runs are not substitutes.

## Implemented

- Seven-language native/container setup, independent private credentials,
  persisted choices, interrupted-installation resume and runtime health checks.
- Read-only, approval, full-access and custom execution policy, with fresh
  permission checks, exact approval receipts and emergency stop.
- Thirty work guides, 24 capability tools, 22 runtime tools and five selectable
  packs. Personal guides, utility presets and Node programs support persistent
  editing, JSON import/export and enable/disable.
- Source repositories can be copied into isolated Git workspaces and connected
  to real agent projects. Checks run against a frozen candidate; application
  uses the exact tested revision and rollback creates a recorded revert commit.
- Optional private HTTPS phone access through an existing Tailscale connection,
  or an operator-managed VPN and TLS reverse proxy. No native mobile app.

## Observed evidence

- Full local source suite for the executable-tool implementation: **1,447 passed,
  zero failed, six skipped** (1,453 total). The later locale extraction and
  accessible-label changes have separate browser/build checks.
- Updated customization UI: **83/83** Chromium tests passed, including seven
  languages, Arabic RTL, phone layouts, larger text, source workflow and personal
  program creation/reload.
- Workspace typecheck, production build, frozen API generation, formatting and
  bundle budget passed. Selected customization translations load on demand;
  their additional feature budget is explicit in the checker.
- Production dependency audit: no known vulnerabilities reported. Production
  dependency license policy passed. Gitleaks directory scan found no leaks;
  the required CI job scans commit history separately.
- A real Windows x64 installation using PostgreSQL 17.10 started an API and two
  workers, persisted Arabic/read-only/pack choices, saved a personal guide,
  stopped and resumed with the same operator identity and saved guide.
- Container run [36447201082](https://github.com/halittayyar0/Agentic-Company-OS/actions/runs/36447201082)
  passed production topology, worker recovery and the ten-minute PostgreSQL
  endurance evidence verifier at `d51a10f`. The short duration cannot establish
  24-hour endurance. The evidence artifact is retained with the run.
- Both macOS Apple Silicon and Intel jobs passed at `d51a10f` in
  [36447201077](https://github.com/halittayyar0/Agentic-Company-OS/actions/runs/36447201077).
  Newer revisions require their own platform results.
- Real approved-action execution rejected an unapproved personal program,
  executed its revision-bound Node code, checked the minimal environment,
  recorded one succeeded receipt and did not repeat a file write on retry.
- Real Git tests cover failed-check rejection, tested apply, repeated apply,
  rollback, original-source changes, immutable review copies and private-file
  rejection, with authenticated API and mobile UI coverage.
- A separate temporary HTTPS phone preview returned UI 200, anonymous API 401
  and authenticated API 200. Chrome login and navigation were inspected.

## Explicit limits

This is single-operator alpha software. Native programs retain the service
account's filesystem and network authority. Container authority is determined
by its actual mounts and operating-system permissions. No arbitrary MCP server
installation is included in the personal package format.

Source apply does not restart the service or reverse database migrations.
Interrupted external changes may require inspecting the recorded state and Git
HEAD; unknown outcomes are not automatically replayed. See
[source workspaces](../source-workspaces.md).

Physical-phone acceptance, native Safari, native-speaker review and a real
24-hour endurance run remain unverified. The native wizard was exercised on
Windows; container production/soak evidence and wizard executor tests are
separate from a real container-wizard end-to-end installation. Live paid-model
quality is not established by deterministic provider fixtures.

See [GitHub Actions](https://github.com/halittayyar0/Agentic-Company-OS/actions)
and the release notes for the final protected-merge revision and its checks.
