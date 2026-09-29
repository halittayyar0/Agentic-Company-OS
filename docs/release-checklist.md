# Public release checklist

Use this checklist for every public release. Never publish from an unreviewed
working tree or from a directory that contains operator runtime data.

## 1. Prepare the candidate

- Use Node 24 and the pnpm version pinned in `package.json`.
- Confirm `.env`, `data/`, `agent-sandboxes/`, `.conversation/`, `.secrets/`,
  logs, screenshots containing private work, and local database files are not
  tracked.
- Run API code generation and verify that it produces no diff.
- Run `pnpm run verify` from the candidate source state.
- Build and smoke-test the production container when Docker is available.
- Exercise the production topology as one HTTP-only API plus two independent
  scheduler-only workers on PostgreSQL. Kill one worker, observe its runtime
  incarnation become stale, restart it, and confirm a new healthy incarnation
  rejoins without a stale-owner commit.
- Exercise operation-receipt race convergence and the guarded `unknown`
  reconciliation path. Do not describe lease/receipt coverage as universal
  exactly-once external delivery.
- Capture the README screenshot from that same candidate.
- Check first-run language selection, both Chinese variants, Arabic layout, and operator login on desktop and phone viewports.
- For an installed release, follow [mobile access](./mobile-access.md) on a real phone over mobile data; keep the API host port private and confirm the operator sign-in gate.

## 2. Review exactly what will be published

```powershell
# Stage an explicit, reviewed path list; never use git add -A in a dirty tree.
git add -- README.md README.tr.md LICENSE SECURITY.md '<other-reviewed-paths>'
git diff --cached --name-status
git diff --cached --check
git diff --cached --name-only | rg '(^|/)(\.env($|\.)|data/|agent-sandboxes/|\.conversation/|\.secrets/|.*\.log$)' | rg -v '(^|/)\.env\.example$'
```

The final command must print nothing. Do not use `git add -f`. Inspect binary
assets and generated migrations explicitly. Run a staged and full-history secret
scan with Gitleaks or an equivalent scanner before pushing.

The secret-scan workflow uses the MIT-licensed Gitleaks CLI directly, with a
pinned release and SHA-256 verified before extraction. It does not require a
Gitleaks Action organization license key. Reports redact secret values and stay
in the runner's temporary directory; no report upload or PR comment is enabled.
A configured workflow is not a successful scan: inspect its result for the exact
candidate and review findings without publishing unredacted values.

## 3. Verify a clean checkout

The strongest candidate proof comes from a fresh clone of the exact commit:

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-spec run codegen
git diff --exit-code -- lib/api-client-react/src/generated lib/api-zod/src/generated lib/api-zod/src/index.ts
pnpm run verify
docker compose config --quiet
docker build --pull -t agentic-company-os:release-candidate .
```

Docker commands may be omitted only when the release is explicitly marked as
not container-verified.

Confirm the CI production-topology job starts one API and two workers with a
shared PostgreSQL database and a distinct runtime-control key, reports all three
runtime instances healthy, observes a killed worker as stale, and accepts only
a new worker incarnation after restart. Workers must not receive the operator
bearer or publish an HTTP port.

Also require the container job to build the dedicated `endurance-runtime`
target once with exact commit/tree OCI labels, prove the ordinary image rejects
synthetic mode, start the prebuilt endurance image with `--no-build`, and
independently verify its short PostgreSQL-backed ten-agent soak. The runtime
attestation must show one identical image ID for the API and both workers plus
the digest-pinned database image ID. That short run must exercise receipt
evidence and worker replacement while remaining `verified24h: false`. The
Windows job must SHA-256 verify its PostgreSQL 17 archive and pass both the real
native process smoke and short native wall-clock verifier path.

## 4. Validate endurance claims

Follow [endurance.md](./endurance.md) from the exact clean candidate commit.
Accelerated evidence and short wall-clock smoke reports are useful release
inputs, but both must have `verified24h: false` and must not be advertised as a
24-hour result.

If release notes, badges, or documentation claim 24-hour verification, require
all of the following:

- the Docker or native PostgreSQL runner elapsed at least 24 real hours using
  one API, two workers, and ten continuously scheduled responsibilities;
- the runner exited zero and the independent verifier exited zero without
  `--allow-unverified-duration`;
- `--expect-commit` matched the released commit and `verified24h` is exactly
  `true`;
- the summary JSON, ordered JSONL journal, SHA-256 sidecar, browser checkpoint
  manifest and files, fault/incident correlations, and automated sign-off are
  retained as release evidence, and the verifier matched the manifest and each
  checkpoint file's actual bytes to the report hashes and accepted all 1,441
  semantic browser samples; and
- no responsibility, duplicate irreversible receipt, stale-owner, recovery,
  incident, health, SSE, browser, topology, journal, or integrity assertion was
  waived.

## 5. GitHub repository controls

Create the repository privately first, push only the reviewed `main` candidate,
and wait for CI, Windows, container, CodeQL, and secret-scan jobs to pass. Before
making it public, enable:

- protected `main` with required checks and no force-push or branch deletion;
- Dependabot alerts and security updates;
- secret scanning and push protection;
- private vulnerability reporting;
- read-only default Actions token permissions;
- a project description, social preview, license detection, and relevant topics.

Publish the first candidate as a prerelease tag such as `v0.1.0-alpha.1`. Public
visibility, the remote owner/name, commit-history policy, tag creation, and the
final push are maintainer-controlled actions.
