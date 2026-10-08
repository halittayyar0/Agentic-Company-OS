# Connect a ChatGPT account

This guide describes the connection tool in the guided model connection branch.
Sign-in grants permission; it does not prove that a model request completed or
that quota is available. These commands perform no inference.

The flow follows OpenAI's [open-source sign-in guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
and [self-hosted VM guide](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms).
It uses a public client, PKCE, a private loopback callback and signed ID-token
validation. It does not read your personal Codex credentials or require an API
key or client secret.

## On your own computer

Build the application, then run:

```sh
pnpm connect:chatgpt sign-in --same-computer
pnpm connect:chatgpt status
```

The browser and this command must run on the same computer. After browser
sign-in, the terminal shows the proposed account. Confirm it to save and select
it. Declining preserves the previous selection. No job starts automatically.

`status` returns account IDs, revisions, expiry and granted plan permission.
It never returns credentials. Two registrations can have the same email; use
their distinct IDs.

To sign in again, reuse the saved registration:

```sh
pnpm connect:chatgpt sign-in --same-computer --registration ACCOUNT_UUID
```

To explicitly enable plan permission after an identity-only sign-in, add
`--enable-plan`. Ordinary sign-in does not force another consent prompt.
`--manual-link` is available for a new registration when the local browser
cannot be opened. Returning authorization links contain a private ID-token hint
and are opened directly instead of printed.

## On a server or in a container

A phone or laptop browser cannot reach a callback bound to the server's
`127.0.0.1`. Prepare the server first and complete sign-in on your own computer.

On the server, as the installation's runtime owner:

```sh
pnpm connect:chatgpt prepare-target
```

For the repository's Compose installation:

```sh
docker compose exec --user node app node artifacts/api-server/start-chatgpt.mjs prepare-target
```

Keep the returned `targetHostId`. The server retains this stable identity when
importing; the laptop's host ID does not replace it.

On your own computer, complete sign-in and inspect `status`. Export exactly the
selected account at its observed revision:

```sh
pnpm connect:chatgpt export --registration ACCOUNT_UUID --expected-revision REVISION --target-host TARGET_HOST_URN --transfer-directory ABSOLUTE_NEW_DIRECTORY
```

The new directory's parent must already exist. Export protects the directory
and files for their owner before writing credentials. It retires the local
credential set before marking the transfer ready, without revoking the session
the server will use. A nearly expired session must be renewed by signing in
again before export.

Transfer the protected directory over SSH, preserving owner-only protection:
`0700` for the directory and `0600` for files on Unix; a protected owner/SYSTEM
ACL on Windows. Use the server runtime's OS user, not a different administrative
account. Never upload these files through the application, chat, email or Git.

Import on the server:

```sh
pnpm connect:chatgpt import --expected-revision 0 --transfer-directory ABSOLUTE_TRANSFER_DIRECTORY
```

For Compose, place the protected directory in a path mounted into `app`, then:

```sh
docker compose exec --user node app node artifacts/api-server/start-chatgpt.mjs import --expected-revision 0 --transfer-directory /app/data/TRANSFER_DIRECTORY
```

Revision `0` means a new account. For an existing signed-out registration, use
its current revision from `prepare-target`. A signed-in target is preserved.
The import validates the signed identity, saves the selected registration and
lets this server own subsequent token refreshes. Once connected, the web UI can
be used from the phone through your installation's authenticated remote access.

Successful import replaces its transfer file with a credential-free consumed
record. Check `transferFileCleared`; remove other transfer copies after success.
Export is ready for at most ten minutes, and credentials can expire earlier.
A `prepared` or `consuming` record after interruption is deliberately
unimportable: inspect status and sign in again instead of replaying it.

OpenAI currently documents that host-specific usage attribution and revocation
are unavailable for transferred sessions. See the linked VM guide for current
limits.

## Storage and sign-out

Installed PostgreSQL runtimes share encrypted registration storage and a durable
refresh lock. Development without PostgreSQL uses an encrypted owner-private
store at `~/.agentic-company-os-chatgpt`; an absolute
`CHATGPT_STORAGE_DIRECTORY` can select a different development directory.
The CLI's `--store-directory ABSOLUTE_PATH` explicitly selects a protected local
store, which is useful when preparing a laptop session for transfer.

Refresh replaces the complete rotating token set. Temporary failures preserve
valid credentials; confirmed unusable-token errors clear credentials and retain
the account/client mapping for sign-in again. A crashed local file lock is not
automatically stolen by a timeout. Stop every process using that local store
before an operator removes a stale `registration.lock`.

```sh
pnpm connect:chatgpt sign-out --registration ACCOUNT_UUID
```

Sign-out reports local clearing and remote revocation separately. If
`revocationConfirmed` is `false`, disconnect the application in
[ChatGPT settings](https://chatgpt.com/settings/usage). No refresh token means
that remote revocation is reported as `null`.

## Optional governed coding runtime (development branch)

The development branch connects `vm_codex_task` to durable tasks. It is disabled
by default and appears only for a task using a ChatGPT model with terminal
permission. Direct chats do not receive this tool. Its only model-supplied
argument is the job prompt; the backend selects the executable, account,
workspace, private runtime home and permission profile.

An operator must explicitly enable both `ALLOW_AGENT_CODEX_TASKS=true` and
`ALLOW_AGENT_PROCESS_EXEC=true`, and set `ACOS_CODEX_EXECUTABLE` to the canonical
absolute path of an operator-managed Codex binary outside the writable task
workspace. A separate API role cannot launch it. These settings request
availability; they do not prove the installation supports the required process
ownership and filesystem containment. Actual preparation must pass before a
native inference begins.

The current native controllers target Windows and Linux. The installed Codex CLI 0.159.2
refuses the required split-read containment in the tested unelevated Windows
environment, so that environment stops before inference. Linux process lifetime
has separate native lifetime and pinned CLI permission tests. Live account inference
and other installation environments still need their own validation.
Native macOS coding support and complete container release acceptance remain pending. Do not enable
this runtime by relaxing containment or sharing your personal Codex home.

For a source-change task, the backend selects that task's draft directory inside
its agent sandbox. It never uses the original checkout directly. Multiple
source-change rows, a different owner or a non-draft state are rejected. Other
tasks use their agent's sandbox working directory.

Source workspace admission captures the source-change ID and revision.
Changing, removing or duplicating that record invalidates the running
authority; restoring its old values does not revive it. The source workflow
and native session admission lock the same record. Source checks, application
and rollback refuse a running session or an unverified process cleanup before
advancing the source revision. The source screen explains this in the selected
language and links to the task for session inspection. It never grants an
unknown cleanup or retries the source operation automatically.

Successful session checkpoints retain their admitted source revision. A later
revision cannot reuse the earlier checkpoint; the existing explicit recovery
flow must archive incompatible session metadata before a fresh admission.
Migration 0039 preserves older metadata with a null source fence. It does not
invent a source revision for old checkpoints or silently bind them to a source
workspace.

Individual and shared task-family budgets are checked again immediately before
the native turn starts. Required human decisions are bound to the exact native
item and reviewed command or patch digest. The native runtime executes an
approved item once; the ordinary approval queue does not also execute it.
The durable tool envelope prevents automatic repetition of the same logical
invocation. Lost ownership or ambiguous execution leaves an uncertain session
that cannot resume automatically.

Reported token usage is recorded once per native inference, with a durable
unique key. Missing token usage remains unknown, and unavailable prices remain
`null`. A coding checkpoint is published only after owned process cleanup,
approval cleanup and usage persistence succeed. A delayed accounting write can
later add its receipt, but cannot turn an uncertain session into a ready one.
An ended Codex turn is recorded as `codex_turn` with
`deliverableVerified=false`; files and required checks must still be verified.

The existing completion review receives that scope alongside the operation's
state; a succeeded native turn cannot supply command, test, or artifact proof.
For source-change tasks, the review separately reads linked
`frozen_source_snapshot` records. `snapshotChecksPassed` means the selected
checks passed for the recorded `candidateCommit`; `applicationRecorded` means
the source workflow recorded applying that same commit. A rolled-back change
retains its historical check result but is no longer recorded as applied.
These records do not verify the repository's current files, comprehensive test
coverage, or deployment. Old source snapshots cannot certify a later recurring
cycle. Up to eight source records are sampled with a total and truncation flag;
private paths, check commands and output are excluded. This adds metadata to the
existing review rather than making another inference request.

This integration is not part of the released v0.3.13 snapshot. Offline protocol
peers verify the service, HTTP approval transactions and accounting behavior;
they do not execute the displayed commands or establish native containment.

### Linux lifetime controller development

The source includes a separately tested PID1 guardian for a dedicated Linux
PID namespace. It checks a private owner pipe before creating the target and
continues watching it through execution. EOF stops the namespace's processes;
the guardian reaps detached descendants before reporting cleanup. If PID1 is
killed, the kernel destroys its PID namespace. This addresses the documented
[Bubblewrap startup race](https://github.com/containers/bubblewrap/issues/633)
instead of treating `--die-with-parent` alone as a complete ownership proof.
See [Linux PID namespace semantics](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html).

The opt-in native test uses Python3, Bubblewrap and actual unprivileged user/PID
namespaces. It exercises owner EOF, owner/helper SIGKILL, target success/crash,
early startup loss, detached descendants and rejection outside PID1, checking
kernel namespace emptiness and the recorded outer process identity. Run on Linux:

```sh
ACOS_LINUX_NAMESPACE_TESTS=1 node --import tsx --test --test-concurrency=1 \
  artifacts/api-server/src/lib/vm/linux-owned-namespace.test.ts \
  artifacts/api-server/src/lib/vm/linux-owned-launcher.test.ts \
  artifacts/api-server/src/lib/codex-task-linux-process.test.ts
```

The production Linux launcher connects this guardian to the existing emergency
runtime registry. It verifies the namespace init's kernel identity, preserves
protocol pipes and awaits kernel destruction before accepting a cleanup receipt.
Eight launcher tests include abrupt Node owner loss with detached descendants,
an isolated verifier network and private writable namespace `/tmp`;
a separate process-factory test uses an explicit offline CLI fixture to check
the actual default launcher, private home, explicit environment and one launch.
The launcher requires root-owned, non-writable system Bubblewrap/Python tools.
System Bubblewrap must advertise `--argv0 VALUE`; the observed compatible version
is 0.9.0. A legacy 0.8.0 installation is refused before protected helper creation.
Pinned Codex otherwise falls back to a helper alias inside its denied private
home. Do not grant that directory access to work around the incompatibility.
The launcher rejects modified private guardian source and rechecks live ownership.
The worker report may show `preflight_required` on Linux; this is permission
to check a task, not certification that coding works on that installation.
The process-lifetime tests make no model calls and do not independently prove
CLI permissions, macOS or container compatibility.
An installation that refuses namespaces must fail this proof; do not disable
host policy or advertise supported coding execution after a skipped test.

The ordinary production Docker image omits this optional native coding
toolchain. The separate `coding-runtime` target packages Codex 0.159.2 and its
pinned namespace helper. The built image passed 22 offline native permission
and lifetime cases with Python 3.11.2, UID 1000, an init reaper, a read-only root,
dropped host capabilities and a 512-process limit. The public opt-in
`pnpm test:coding:container IMAGE_DIGEST` gate repeats this scope and verifies
real Compose merges, including the installer's final private override.

The [container wizard option](./self-hosting.md#optional-coding-workers) selects
only the existing workers and a separate immutable image. It requires Compose
2.24.4 or later and a Linux x64 engine. AppArmor hosts must load the dedicated
bundled profile first; CI requires its actual enforced path. Local evidence on
a host without AppArmor does not prove that path. Full container installation,
resume and public release checks remain separate acceptance gates. Keep the
API's ordinary profile and do not broaden host policy to obtain a green result.

### Offline native Linux permission gate

A separate gate runs the **actual pinned Codex CLI 0.159.2**, inspects the
effective owned configuration and named profile, starts an ephemeral thread,
and uses `command/exec` to run fixed local Python checks. It requests no turn,
model inference, login or approval. The factory uses fake fixture credentials;
the Linux controller additionally isolates the app-server's network for this
test. Normal model tasks omit that additional restriction. Socket denial is
verified by `EPERM`/`EACCES`, with a successful backend socket positive control;
a failed connection alone is not accepted as network enforcement.

Four command cases cover approval, workspace write, and both custom file settings.
They verify workspace reads, the expected file-write boundary, private and
outside-file denial, private-home symlink denial, no access token in the command
environment or readable `/proc` environments, no private sentinel through
`/proc/*/root`, and no write access to the verified CLI file.
The exact backend-verified CLI file has read access so the native Linux helper
can re-execute it; its containing installation directory gets no profile grant.
Each owned namespace has fresh temporary storage for the native mount registry.
An executable installed below `/tmp` retains its explicit installation tree
through a read-only bind; unrelated host temporary files are not mounted.

A fifth case runs the production driver through initialization, configuration
inspection and thread creation. It awaits a delayed final admission refusal,
checks that no `turn/start` is physically written, and verifies owned-process
cleanup. This validates the pre-inference admission fence without a model call.

On x64 Linux, prepare a disposable fixture from pinned, integrity-checked npm
bytes (three exact regular members, no install scripts or global install):

```sh
python3 scripts/src/testing/install-codex-linux-fixture.py > /tmp/acos-codex-fixture.json
export ACOS_LINUX_CODEX_EXECUTABLE="$(python3 -c 'import json; print(json.load(open("/tmp/acos-codex-fixture.json"))["executable"])')"
ACOS_LINUX_CODEX_TESTS=1 node --import tsx --test --test-concurrency=1 \
  artifacts/api-server/src/lib/codex-task-linux-native.test.ts
```

The CI Linux job runs this gate alongside the lifetime tests. A completed local
gate certifies those fixed commands on that measured CLI/kernel combination.
It does not certify authenticated plan inference, native model-generated patch
approval, recurring delivery, a different distribution, nested containers or
other operating systems. Tests elsewhere skip this explicitly enabled native
gate; those skips are not native coverage. The released v0.3.13 snapshot does
not contain this integration.

### Offline first-job integration gate

The development branch has an opt-in first-job test that runs the real native
installer, a fresh owned PostgreSQL cluster, the API and two workers. It uses
rendered Chromium in all seven languages at 390px, with Arabic at 320px and RTL.
The model HTTP peer and judge responses are fixed local fixtures. No human
credentials, downloads of models or paid inference are used.

With Node 24, pnpm 10.17.1, Chromium and PostgreSQL binaries already available:

```sh
ACOS_GUIDED_LOCAL_SMOKE=1 node --import tsx \
  scripts/src/testing/guided-local-connection-smoke.ts \
  /absolute/postgresql/bin /absolute/pnpm/bin/pnpm.cjs
```

Run with a clean environment: provider credentials, database/runtime-control
overrides, ChatGPT storage, synthetic/endurance configuration and Codex flags
are refused. The test checks restart and backup restoration, keeps each first
job through closing setup and reloading, saves the local endpoint through the
actual API without inference, and explicitly starts one job per language.
Actual workers run the arithmetic tool and completion path. Recorded model usage
is simulated. A confirmed rate-limit rejection waits for the real window; the
production settings limit is unchanged.

The owned evidence directory retains screenshots and source-bound results.
This gate does not certify real model quality, native Codex coding, a physical
phone, another host OS, container installation or 24-hour reliability.

### Read the executing fleet's configuration

The authenticated `GET /api/connections/codex` endpoint reads fresh, healthy
scheduler workers' startup reports. It performs no executable probe, provider
request, token renewal or native launch. An API server's operating system and
local flags never stand in for another worker's configuration.

Each worker reports one of these states:

| State                    | Meaning                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `disabled`               | The optional runtime was not enabled at worker startup.                                                                              |
| `configuration_required` | Process execution or a valid absolute executable path was not configured.                                                            |
| `unsupported_platform`   | This worker's platform has no implemented native lifetime controller.                                                                |
| `preflight_required`     | Startup configuration permits checking a task; native installation, permissions, ownership and containment still require validation. |
| `not_reported`           | This worker version has not provided a valid configuration report.                                                                   |

The fleet response uses `worker_configuration` proof scope and always sets
`requiresTaskPreflight=true`. It has no globally "ready" or "verified coding"
state. `no_worker` means no eligible healthy worker report was observed;
`unknown` includes legacy reports and an incomplete list without an observed
candidate. At most 128 workers are returned, with `truncated` explicitly set
when more exist. A truncated list cannot prove fleet-wide unavailability.

`configurationAt` is the worker incarnation's startup time. `heartbeatAt` and
`staleAt` describe liveness of that observation, not a successful coding test.
Draining, stopped, expired and future-dated worker reports are excluded. Restart
a worker after changing its startup environment. The worker and combined
entrypoints publish only configuration booleans; executable paths, hostnames,
process IDs, account details and credentials are absent from this response.

The model tool catalog also omits this optional tool on platforms without an
implemented native controller. Actual task execution retains all live preflight
checks; neither this endpoint nor a configuration report grants permission.

### Recover a stopped coding session

Open a task's **Coding session** section to review its current recovery status.
A reset is available only when the old runtime's shutdown was acknowledged or
the runtime was never launched, the task has no active ownership, and no native
action is still awaiting a decision or result. An elapsed lease or a completed
native item is not proof of shutdown. Historical sessions with no shutdown
acknowledgement remain ineligible.

After reviewing the task history, acknowledge that uncertain actions remain
unresolved and choose **Archive and reset session**. The server archives private
session metadata and preserves existing files, usage records and operation
evidence. The task stays in its existing state. Recovery does not reconcile
unknown effects, retry inference, change accounts or grant new permissions. A
later separately authorized coding invocation receives a new private runtime
home and must pass the current authority and containment checks.

If a response is lost, keep the same tab and choose **Check saved result**. A
saved request identity survives reload in tab storage; loading the page never
submits it automatically. Only an explicit retry after a missing-receipt response
resends the same request identity and observed revision. If browser storage
cannot safely preserve those details, the control sends no new reset.

Only the selected recovery language is loaded. If that language file cannot
load, **Check again** reloads the page while retaining the request identity in
tab storage. Reloading never sends a reset or repeats an uncertain operation;
inspect its saved result after the controls become available.

The authenticated endpoints are `GET /api/tasks/{taskId}/coding-session`,
`POST /api/tasks/{taskId}/coding-session/recover` and
`GET /api/tasks/{taskId}/coding-session/recover/{requestId}`. The POST requires
`requestId`, `expectedRevision` and `acknowledgeUncertainEffects=true`; extra
fields are refused. Accepted and rejected receipts are immutable, scoped to the
task and observed revision, and retain their request identities after task
deletion. Reusing an identity for a different scope conflicts. A `503` does not
prove a failed commit: query the same identity before deciding what to do next.
Public responses omit private homes, thread IDs, account details and owner tokens.

## Verified scope

### Keep the task you are preparing

Home and New project retain their original task text and choices in this tab
when you visit Connections and settings, change the interface language or reload.
The detailed form also retains its title, priority, finite or ongoing type and
cadence. Each form has a separate versioned draft. Interface language changes do
not translate your original task text. A skill's navigation prefill applies once;
later edits take precedence on reload.

Drafts contain only these bounded composer fields; provider keys, account tokens,
permissions and task submission receipts are not stored with them. Corrupt,
unsupported or oversized draft data is refused and does not replace editable
input. If tab storage is unavailable, editable text can survive in-app navigation
in this tab's memory, and an inline message asks you to keep a copy before a full
reload or closing the tab. Failed or unconfirmed Start responses retain the draft.
Only an explicit Start with a valid task identity clears its submitted draft;
restoring a draft, changing language or returning from connection setup sends no
job.

### Connect without leaving the job

In the guided-connection branch, **Connect a model** opens a focused dialog on
Home and New project; the same action is available in Settings and after the
first-run language choice. The original composer stays mounted. Escape or
**Return to my job** closes the dialog and restores useful keyboard focus.

- **Local model:** edit the private Ollama address reached by the backend, save
  against the observed settings revision, or restore the installation default.
  Restoring removes the runtime override; an environment address stays active.
  Discovered models and tool support are shown separately from an inference test.
- **API key:** choose OpenAI or OpenRouter. Unsaved keys live only in component
  memory and disappear when the form closes. A confirmed save clears the key
  field. No browser storage or URL contains the key.
- **ChatGPT:** inspect existing accounts before starting a new connection.
  Explicitly confirm that the browser and backend share a computer, start
  official sign-in, then open the returned official link. Review/save the
  proposed account and select it in separate actions. Identity-only permission,
  signed-out accounts and paused plan usage remain visible. Granting plan
  permission or renewing an existing account reuses its registration.

Viewing, refreshing, saving, selecting and closing this dialog never creates a
new job or sends an inference test. Saving provider settings can make previously
authorized jobs waiting for a provider due again, as stated in the dialog. Use
Advanced settings for an explicitly confirmed model test; provider charges and
plan quota can apply.

A failed or unconfirmed provider save blocks another write until an explicit
read of current state; editing does not dismiss that warning. Reopening the
form reads the current endpoint/revision before initializing its fields. No
mutation is automatically retried. Pending ChatGPT attempts retain only their
non-secret reference in this tab's memory, so closing/reopening inspects the
same attempt. Closing is not cancellation; **Cancel sign-in** is explicit. The
one-time authorization URL stays only in component memory and disappears when
the attempt ends or the dialog closes. A lost start response waits out the
bounded attempt window rather than silently creating another attempt. A full
reload loses this in-memory reference but never confirms or selects an account.

Phone/server/container users receive the protected CLI/SSH handoff guide. A
remote backend refuses local callback setup instead of guessing a callback URL.
No credentials are accepted for upload through this dialog. Seven authored
language packs load one at a time; Arabic uses RTL. A missing connection module
can be dismissed or explicitly reloaded while the composer draft remains
governed by the storage rules above. This branch still needs integrated runtime
and release acceptance before these controls are part of a published release.

Automated checks use signed synthetic identities, owned HTTP fixtures,
encrypted storage, actual Windows ACLs and an owned PostgreSQL 17.10 server.
These connection checks do not establish successful human sign-in, paid inference
or a physical phone session. The separate offline Linux permission gate above
reports its own native scope; native macOS, enforced host policy and complete
container release acceptance remain open.
