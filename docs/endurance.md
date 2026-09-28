# Endurance verification

The endurance harness is a release-evidence tool for the current commit. It
does not prove that every future deployment is faultless, and a short smoke run
must never be presented as a verified 24-hour result.

## What the wall-clock run exercises

Both wall-clock drivers start the same topology:

- one HTTP-only API;
- two scheduler-only workers;
- one shared, durable PostgreSQL database;
- one project with ten continuously scheduled agent responsibilities; and
- a Playwright observer that samples the real Operations Room and its SSE
  reconnect behavior.

The workload uses a deterministic, endurance-only provider/tool adapter. It
does not need a model-provider key and must not perform public-web, messaging,
payment, publication, or other real external actions. Ordinary production
images reject the synthetic adapter. The Docker runner builds the dedicated
`endurance-runtime` target once, starts Compose with `--no-build`, and records
the exact image IDs used by the API, both workers, and PostgreSQL. The API and
workers must share one image ID whose OCI commit and source-tree labels match
the clean-checkout build attestation. Node 24 and PostgreSQL 17 base images are
manifest-digest pinned. The marker and runtime identity checks are deployment
guardrails, not signatures: a root-controlled operator or compromised Docker
daemon can still replace bytes or falsify inspection data. Host/root trust and
signed-image policy remain deployment responsibilities. The native runner is
loopback-only. It requires a clean exact Git HEAD, runs the repository
production build itself before any runtime process starts, and then launches
the built API, UI, and worker artifacts. It requires PostgreSQL 17.x and hashes
the exact `postgres`, `initdb`, `pg_ctl`, `pg_isready`, and `psql` executables,
the Node executable, and `pnpm-lock.yaml` into runtime provenance. Use it as
runtime evidence, not as a production hardening proof.

A 24-hour schedule injects six worker losses plus provider timeout, rate-limit,
malformed-output, PostgreSQL-unavailable, SSE-disconnect, and emergency-stop
faults. The report passes only when all expected responsibilities complete,
no agent falls more than two responsibility cycles behind, irreversible
receipt keys are not duplicated, stale owners commit no result, recoverable
worker loss is reclaimed within 120 seconds, every injection has timely
durable incident evidence, health never reports a false green state, SSE
reconnects, and at least 1,440 persisted minute buckets exist.

## Prepare a candidate

Run from a clean checkout of the commit being tested. The runner fails before
starting the topology if tracked or untracked source is dirty or HEAD differs
from `GITHUB_SHA`. It records the exact commit/tree digest plus a deterministic
runtime-artifact digest. The independent verifier recomputes all of them from
the same checkout and cross-checks the runtime attestation described above.
Ignored evidence, dependency, build-output, and local shim directories do not
contaminate the source-tree claim.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm exec playwright install chromium
mkdir -p artifacts/endurance-reports
```

The shared options are:

| Option                    | Default                   | Meaning                                                                 |
| ------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `--duration-hours N`      | `24`                      | Real elapsed duration; minimum one minute.                              |
| `--seed N`                | `240901`                  | Unsigned 32-bit deterministic fault seed.                               |
| `--fault-profile PROFILE` | `standard`                | `standard`, or test-only `compressed-all` (minimum two minutes).        |
| `--output PATH`           | OS temporary directory    | Summary JSON; parent directories are created.                           |
| `--overwrite`             | off                       | Replace report files; never overwrite a prior native run-log directory. |
| `--keep-on-failure`       | off                       | Retain the failed topology/control state for manual diagnosis/cleanup.  |
| `--postgres-root PATH`    | `ENDURANCE_POSTGRES_ROOT` | Native runner only; portable PostgreSQL toolchain root.                 |

`SIGINT` and `SIGTERM` request bounded cleanup and still produce failed
evidence when possible. Do not use `--keep-on-failure` on an unattended host:
Docker containers/volumes or native PostgreSQL/Node processes may remain live.
Evidence files are staged beside the report and atomically renamed. Even with
`--overwrite`, linked, redirected, or non-regular destinations are rejected.
An evidence-write failure still removes run-scoped temporary controls and
secrets unless `--keep-on-failure` explicitly retains a failed run.

The verifier always requires `--expect-commit`. Wall-clock evidence also
requires `--expect-runtime docker-compose` or
`--expect-runtime native-postgres`; the value must match both runtime
provenance and the independently recomputed build attestation.

## Docker Compose runner

Docker Engine with Compose v2 is required. Create four independent, one-line
secret files under the gitignored `.secrets/` directory:

- `database_url` — for example
  `postgresql://agentic:<URL-encoded-password>@db:5432/agentic_os`;
- `operator_auth_token` — 32-4096 trimmed characters;
- `runtime_control_key` — a different, independently generated 32-4096
  character secret; and
- `postgres_password` — the password used by both the database and URL.

Then run the real 24-hour proof:

```bash
pnpm endurance:wall-clock -- \
  --duration-hours 24 \
  --seed 240901 \
  --output artifacts/endurance-reports/wall-clock-24h.json

pnpm endurance:verify-report -- \
  artifacts/endurance-reports/wall-clock-24h.json \
  --expect-mode wall_clock \
  --expect-commit "$(git rev-parse HEAD)" \
  --expect-runtime docker-compose
```

Set `APP_PORT` if loopback port `5000` is unavailable. The runner creates an
isolated Compose project, injects faults through a run-specific read-only
control mount, builds a local endurance image once unless
`ENDURANCE_PREBUILT_IMAGE=true` selects an explicitly named prebuilt image,
starts the topology with `--no-build`, and removes its containers and volumes
after an ordinary run. A prebuilt run fails unless the three application
containers use the selected exact image ID and its OCI source labels match the
current clean commit/tree identity.

## Native Windows PostgreSQL runner

The native runner is useful when Docker is unavailable. It creates an
ephemeral loopback PostgreSQL cluster, chooses unused API/database ports, and
starts the built API plus two independent worker processes. The supplied root
is searched recursively for one directory containing `postgres.exe`,
`initdb.exe`, `pg_ctl.exe`, `pg_isready.exe`, and `psql.exe`. Any version other
than PostgreSQL 17.x is rejected before `initdb` runs.

The Windows CI job downloads the exact EDB PostgreSQL 17.10 binary archive and
checks its repository-pinned SHA-256 before extraction, then runs the native
process smoke and short wall-clock verifier path. EDB did not provide a
separately reachable checksum/signature for that archive when this pin was
recorded, so the in-repository SHA-256 detects later byte drift but does not
establish independent publisher authenticity.

Instead of `--postgres-root`, set `ENDURANCE_POSTGRES_ROOT`. No existing
PostgreSQL service or database is reused. The generated database password,
operator token, and runtime-control key are per-run values and are not written
to the report.

Before starting a 24-hour native run, complete a one-minute wall-clock
preflight from the exact clean commit and built artifacts that will be tested.
Use the same portable PostgreSQL root and seed as the long run. The independent
verifier binds the preflight to the commit, verifies the browser manifest and
checkpoint bytes, and the explicit provenance check below proves that the
native PostgreSQL driver—not Docker or the embedded development database—ran
the candidate:

```powershell
$postgresRoot = "C:\path\to\portable-postgresql"
$preflight = "artifacts\endurance-reports\native-preflight.json"
$commit = (git rev-parse HEAD).Trim()

pnpm endurance:wall-clock:native -- `
  --postgres-root $postgresRoot `
  --duration-hours 0.016666666666666666 `
  --seed 240901 `
  --output $preflight `
  --overwrite

# A valid short run exits 1 only because it cannot claim verified24h.
if ($LASTEXITCODE -ne 1) { throw "Native preflight returned an unexpected status" }
pnpm endurance:verify-report -- $preflight `
  --expect-mode wall_clock `
  --expect-commit $commit `
  --expect-runtime native-postgres `
  --allow-unverified-duration
if ($LASTEXITCODE -ne 0) { throw "Native preflight evidence did not verify" }

$preflightEvidence = Get-Content -Raw $preflight | ConvertFrom-Json
if ($preflightEvidence.provenance.configuration.runtime -ne "native-postgres") {
  throw "Preflight did not use the native PostgreSQL runtime"
}
if ($preflightEvidence.provenance.runner.postgres -notmatch '^PostgreSQL 17\.') {
  throw "Preflight PostgreSQL provenance is not the required major version"
}
```

Do not edit source, rebuild, switch commits, change the PostgreSQL root, or
change the seed between this preflight and the 24-hour launch. If any of those
inputs changes, discard the preflight and run it again.

After that preflight passes, launch the real run without changing those inputs:

```powershell
$report = "artifacts\endurance-reports\wall-clock-24h-native.json"

pnpm endurance:wall-clock:native -- `
  --postgres-root $postgresRoot `
  --duration-hours 24 `
  --seed 240901 `
  --output $report

if ($LASTEXITCODE -ne 0) { throw "24-hour runner did not verify" }
pnpm endurance:verify-report -- $report `
  --expect-mode wall_clock `
  --expect-commit $commit `
  --expect-runtime native-postgres
```

## Short smoke runs are not 24-hour evidence

A shorter run is useful for checking startup, fault injection, browser
observation, evidence writing, and cleanup:

```powershell
$report = "artifacts\endurance-reports\wall-clock-smoke.json"
$commit = (git rev-parse HEAD).Trim()
pnpm endurance:wall-clock:native -- `
  --postgres-root "C:\path\to\portable-postgresql" `
  --duration-hours 0.0833333334 `
  --seed 240901 `
  --output $report `
  --overwrite

# The runner intentionally exits nonzero because verified24h is false.
pnpm endurance:verify-report -- $report `
  --expect-mode wall_clock `
  --expect-commit $commit `
  --expect-runtime native-postgres `
  --allow-unverified-duration
```

The verifier is the authority for whether the short evidence is internally
valid. `--allow-unverified-duration` relaxes only the 24-hour duration claim;
it does not waive topology, responsibility, receipt, stale-owner, recovery,
incident, health, SSE, journal, or integrity checks. A short report must retain
`verified24h: false`.

CI uses the explicit `compressed-all` profile to live-exercise worker loss,
provider timeout, rate-limit, malformed output, database unavailability, SSE
disconnect, and emergency stop in one deterministic, non-overlapping short
run. It requires at least two real minutes and can never claim 24-hour
verification:

```bash
pnpm endurance:wall-clock -- \
  --duration-hours 0.03333333333333333 \
  --fault-profile compressed-all \
  --seed 240901 \
  --output artifacts/endurance-reports/compressed-all.json --overwrite

pnpm endurance:verify-report -- \
  artifacts/endurance-reports/compressed-all.json \
  --expect-mode wall_clock \
  --expect-commit "$(git rev-parse HEAD)" \
  --expect-runtime docker-compose \
  --allow-unverified-duration
```

## Evidence and acceptance

For an output such as `wall-clock-24h.json`, the runner writes:

- `wall-clock-24h.json` — bounded summary, assertions, topology, provenance,
  injections, the exact journal hash, browser checkpoint/manifest hashes, and
  automated sign-off;
- `wall-clock-24h.jsonl` — ordered append-style event journal;
- `wall-clock-24h.json.sha256` — SHA-256 of the exact summary bytes;
- `wall-clock-24h.json.primary-evidence.jsonl` — bounded, ordered receipt and
  invocation, responsibility agent/cycle, cycle-lag, raw health, and SSE
  evidence whose exact bytes are SHA-256-bound by the summary;
- `wall-clock-24h.json.browser-manifest.json` — run/report-bound relative
  checkpoint paths, capture times, kinds, SHA-256 values, plus every bounded
  semantic browser sample (1,441 for a 24-hour run); and
- `wall-clock-24h.json.browser/<run-id>/` — bounded browser checkpoint files.
- native runs additionally retain
  `wall-clock-24h-native.json.native-runtime/<run-id>/logs/` for bounded API,
  worker, and PostgreSQL process logs. Runtime controls, sandboxes, secrets, and
  PostgreSQL data stay in run-scoped temporary storage and are removed after
  ordinary cleanup. A prior run-log directory is never reused or overwritten.

Accept a 24-hour claim only when the runner exits zero, the independent
verifier exits zero without `--allow-unverified-duration`, `mode` is
`wall_clock`, both expected commit and expected runtime match, the checkout is
still clean, the source tree and runtime artifact digests recompute exactly,
`wallClockHours >= 24`, every assertion passes, the browser evidence passes,
the completion journal and automated sign-off agree with the report end time,
the SHA sidecar matches, and the report's `journalSha256` matches the exact
JSONL bytes. The verifier derives
the required browser sample count from the journal's requested duration rather
than mutable summary metrics. It also recomputes the seeded fault schedule and
requires the ordered journal `fault_scheduled` events and ordered report
injections to match every deterministic fault ID, kind, and scheduled time. The
primary JSONL is parsed with exact sequence, count, semantic-order, time-span,
and size bounds. The verifier independently reconstructs agent-by-cycle
coverage and lag, operation-key duplicate and stale-owner counts, successful
irreversible receipt/invocation evidence, raw PostgreSQL/worker health truth,
SSE cursor advance, incident omissions, and injection recovery durations; the
recomputed metrics and assertions must exactly equal the summary. Extra,
duplicate, missing, or reordered contract records are rejected even if all
outer hashes are regenerated. The
independent verifier resolves every manifest entry inside the run-scoped
browser directory, matches its actual bytes and manifest bytes to the report
hashes, requires the full health-bucket-plus-one semantic sample sequence,
rejects internal or start/end browser sampling blind windows over 90 seconds,
and recomputes the incident/SSE aggregates without page errors or mismatches.
Only then is `verified24h` exactly `true`.

The accelerated command is deterministic test evidence only:

```bash
pnpm endurance:accelerated -- --seed 240901 \
  --output artifacts/endurance-reports/accelerated.json --overwrite
pnpm endurance:verify-report -- artifacts/endurance-reports/accelerated.json \
  --expect-mode accelerated \
  --expect-commit "$(git rev-parse HEAD)"
```

Accelerated evidence always has `verified24h: false`.
