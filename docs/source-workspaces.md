# Reviewed source changes

Open **Settings → Improve source code**, select an active agent with terminal permission, and connect an absolute path to a clean Git repository. The root must be a real directory; linked roots and a source inside agent storage are rejected. This can be this application's own checkout or another project. Git and enabled agent process execution are required.

The request creates a real agent project and a separate branch under that agent's `source-changes/<id>` directory. The agent uses its existing file and terminal tools there. Credentials and runtime files must remain outside Git. Tracked secrets are not made safe by cloning a repository.

## Check and apply

Inspect the diff, then run an array of up to four exact argument arrays. `{workspace}` becomes the separate, committed review copy. The default runs a frozen dependency installation, type checking and tests with pnpm. Adapt these commands to the project's actual checks. Each command has a 20-minute limit, bounded output and the existing emergency-stop/process controls. No shell joins or interpolation are used.

A check passes only if every command exits successfully and the reviewed Git tree stays clean and on the same commit. This records command evidence, not a guarantee that arbitrary project tests establish correctness. Changes to private-file paths, newly introduced symlinks/submodules, merge histories and empty changes are rejected. Later edits in the agent's working copy do not change the reviewed candidate.

Apply requires the original repository to remain clean at the exact starting commit and the review copy to remain clean at the tested commit. It fast-forwards to that commit. A repeated successful apply returns the recorded result. Rollback adds a new revert commit and verifies that its tree matches the original tree; it never resets history or discards concurrent operator edits.

## Runtime and recovery boundaries

Applying source does **not** restart a running application or reverse database migrations. For this application's native installation, stop the owned runtime, run `pnpm build` from the updated checkout, then resume its existing private installation directory with `pnpm run setup --resume <installation-directory>` and check readiness. Preserve the installation's secrets and database. For containers, rebuild and restart the existing installation without removing its volumes. Back up and review database migration compatibility before updating a live service.

A lost connection is not permission to repeat an action. Refresh the record. An interrupted apply/rollback is recorded as `unknown` when its failure can be recorded; a hard process crash may leave `preparing`, `checking`, `applying` or `rolling_back`. These states cannot be automatically applied again. Inspect Git status, HEAD, the recorded base/candidate and the service logs before manual reconciliation. No automated destructive recovery is provided.

The native process account remains the OS security boundary. A separate Git copy is not an OS sandbox for malicious test programs. Container mode confines programs to the container's configured mounts and capabilities. The production image includes Git and pinned pnpm; a repository used by this screen must be explicitly made available as a writable container mount. The runtime image itself is not an editable Git checkout.

## Evidence

Local Windows/Node 24 proof covers actual Git copy creation, a failed check blocking apply, a passing check, immutable candidate delivery, revision conflicts, concurrent original edits, policy downgrade, committed private-file rejection, no-op rejection, idempotent apply and rollback. Authenticated HTTP tests cover every route. Browser tests cover all seven locales at a 390-pixel viewport and a single apply transition. Physical-phone testing and native runtime installation on every OS are separate acceptance checks.
