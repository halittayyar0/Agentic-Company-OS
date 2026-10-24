# Local models and cloud permission

Connect an existing Ollama server in **Connect a model → Local model**. You need
Ollama **0.18.0 or later** and an installed model that supports tools to run agent
jobs. Saving discovers the catalog; it does not download a model or test inference.
Review the model and permissions before pressing **Start**.

## Get your first local model

The native application package includes its application runtime and private
database. Model weights and Ollama itself are separate downloads.

1. Open **Connect a model → Local model**. If Ollama is missing, use **Install
   or update Ollama** and choose the operating system of the computer or server
   that will run the model. These links open the official installation guides;
   the app does not install an OS service or a second model runtime.
2. Save the private address of that server and check the connection. The starter
   requires Ollama **0.40.3 or later**. A phone uses the app server's connection,
   not the phone's `localhost`.
3. Choose **Download model** to request `qwen3.5:2b-q4_K_M`. Allow about **2 GB**
   for model files, plus space for temporary files. The connected Ollama server
   downloads from its registry using that server's network and storage. The
   model name is a mutable registry tag; the completed receipt records the
   actual digest reported by the server.
4. Wait for the model check, then choose **Return to my job**. Your draft and
   existing model choice stay intact. Review them and choose when to start.

Downloading makes no inference request and creates no task or agent. Existing
jobs already waiting for this model may continue when it becomes available.
Observed byte counts describe reported layers, not an overall percentage or an
estimated finish time. A restarted layer can reduce the observed count.

You can close the dialog and reopen it to see the saved request. **Stop download**
stops this application's request; another client of the same Ollama server may
continue it. Partial files may remain. A missing acknowledgement is not a failed
download: use **Check download**, or explicitly stop that request before starting
a new one. The app never automatically repeats a download after reconnecting or
restarting. After an abrupt application stop, ownership can take up to 30 seconds
to expire before the saved transfer is marked interrupted.

Changing the saved connection interrupts the old request. A historical completed
receipt or a restored database does not establish that model files still exist;
current server metadata must pass again. Database backups do not include Ollama
weights. If a compatible local model is already available, you can use it without
downloading this starter.

For Qwen3.5 thinking models, use Ollama **0.40.3 or later**. Earlier runtimes
can ignore structured-output constraints when thinking is disabled. Local
reviews request an explicit verdict/reasoning schema; this constrains the reply
format, not the verdict or the quality of the completed work. A failed review
does not certify completion. See the [upstream runtime fix](https://github.com/ollama/ollama/pull/15901).

Local tool calls and structured reviews request deterministic sampling. This
reduces variation; it does not establish that a selected operation or answer is
correct. Plain text and cloud requests keep their existing sampling settings.

A real Windows CPU installation from the public **v0.5.6** native archive completed
`58.5 + 14.5 = 73` through `calculate` using `qwen3.5:2b-q4_K_M`, with no remote
request or paid provider. Fresh installation, backup/restore and restart passed.
A separate GUI upgrade retained the previous task and settings, stayed paused,
and completed a new local task after explicit resume. The
[release verification](https://github.com/halittayyar0/Agentic-Company-OS/releases/download/v0.5.6/VERIFICATION.json)
binds those checks to the exact published archive. They are bounded integration
checks, not a guarantee of future task quality or continuous operation.

Earlier development trials on a smaller CPU model did not complete. Their
recorded-usage, review-format and task-context investigations remain historical
evidence. See the
[response-recovery record](./verification/2026-10-11-incomplete-response-recovery.md)
for the context-capacity evidence. A subsequent trial reduced organization data
without removing facts, but the runner rejected the model's malformed tool output.
See the [latest verification record](./verification/2026-10-11-compact-organization-context.md)
for that historical failure. Use the versioned release verification above for
the v0.5.6 installation evidence.

If the runner returns an error without usage, the task can pause for accounting
recovery. A displayed recorded-token count of zero does not establish that the
model consumed no tokens. Checking the connection does not resolve an outstanding
usage receipt, and the cut-short-response retry is not an accounting reset.

## Apply saved usage, then choose whether to resume

Open **Model usage records** on the task or agent. **Check saved records** only
reads the current state. When trusted usage evidence has already been saved for
that exact call, **Apply usage** becomes available. It corrects accounting once;
it does not call a model or start work. Repeated clicks cannot duplicate usage.
The original receipt remains unchanged.

After a task's usage block clears, an eligible **Retry this task** action can
appear separately. Review its explanation before clicking: retry can consume
tokens and still requires the existing permissions, approvals and spend limits.
Existing execution evidence is retained. Updating usage alone is not task success.

If the application response is lost or belongs to another task, the interface
reports uncertainty and reads the saved state again. It does not automatically
repeat the write or resume the task. Without genuine saved usage evidence, the
accounting block stays in place; there is no zero-token reset or manual override.
In particular, that historical local model parser failure did not report usage and
cannot be recovered by this action. See the
[saved-usage recovery verification](./verification/2026-10-11-saved-usage-recovery.md)
for measured tests and remaining limits.

## When a response is cut short

The app prevents partial responses from executing tools. For a local task, it
can remove earlier model narration once while retaining policy, the task and
tool evidence, within the existing round limit. Continued truncation pauses the
task. This recovery does not enlarge your server's context or guarantee model
quality.

Check the current Ollama model's context and response limits, then open the task
page. Its explicit retry retains usage limits and any saved model selection;
automatic routing is checked again. Checking state or inspecting a saved retry
receipt uses no model tokens. Continuing work can consume tokens. A retry does
not clear budgets, approvals or unresolved operations.

If the connection drops after sending, inspect the saved receipt or retry the
same request. Reloading the page never sends that request automatically.

## Use an address the backend can reach

| Installation                                         | Ollama address                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| App and Ollama on the same computer                  | `http://127.0.0.1:11434`                                                                                                   |
| App in a container, Ollama on its host               | A private host address reachable from that container; Docker Desktop commonly provides `http://host.docker.internal:11434` |
| App and Ollama in the same private container network | The Ollama container’s private IP address reachable from the backend                                                       |
| App on a server                                      | A private address reachable from that server                                                                               |

The app accepts `localhost`, `host.docker.internal`, private IPv4 literals and
IPv6 ULA/loopback literals. Container service names such as `ollama` are rejected.
For a shared private container network, use the Ollama container’s assigned private
IP address and update the app connection if that address changes.

Ollama must listen on the selected interface. Host aliases vary by engine;
`host.docker.internal` is not guaranteed on Linux. Avoid exposing the Ollama port
to the public internet. The phone connects to the authenticated **app**, not
directly to Ollama: [private phone access](./mobile-access.md).

## What the model labels mean

- **Local:** the server reports local model metadata. The app uses Ollama's local
  selector to prevent that selection from silently dispatching to a cloud model.
- **Cloud:** the server reports a remote model. Requests use that server's cloud
  account and may consume its allowance or incur charges.
- **Unverified location:** metadata is missing, conflicting or unavailable. The
  model cannot be selected for a new request until its location is verified.

Tool capability describes reported support; it does not prove that the model will
complete your job. Local models use your hardware, memory, storage and electricity.
A cloud model with `:free` in its name is not treated as free. Automatic local
selection and fallback only use verified local models.

An explicit Ollama selection also applies to completion and approval reviews,
including a saved task selection, a message override, or a manually selected
agent model. Those reviews cannot fall back to OpenRouter, direct OpenAI, or
the Replit integration. If local review is unavailable, completion stays blocked;
an approval warning still requires the separate human approval. A review receipt
does not prove that the model understood the source document or completed the job.

If a completion review genuinely rejects a result supported by bounded local
file observations, the task can pause for **operator result review**. Open the
request in Approvals, inspect the exact proposed output, acknowledge the review,
and choose Confirm result or Reject. This requires configured operator credential
authentication and a signed-in operator; disabling API authentication does not
enable this confirmation. The app does not configure credentials for you.

Confirmation makes no model call and executes no command. It saves only the
reviewed result for the current task or recurring cycle, with operator
provenance. The original model rejection remains in the activity history. Saved
format, required successful operations, settled children, unchanged task/owner
settings, absence of active workers, and emergency stop are checked again before
confirmation. Changed or expired proposals cannot be confirmed. A continuous
task schedules its next cycle from the confirmation time.

The pending exact output is retained in the application database and its backups
for at most 24 hours while the app's expiry maintenance runs; rejection,
confirmation, cancellation or owner deactivation clears the proposal payload.
An offline backup still contains its earlier snapshot. Requested extracted facts
can therefore be present in the proposed output. Original private review-source
observations are not added to the proposal, activities or backups. Approval lists
contain only review metadata; the full output is downloaded after opening the
review and requires operator authentication.

This recovery path is assisted completion. It does not demonstrate that a small
model reliably completes the same task autonomously, and unavailable or malformed
model reviews cannot create a confirmable proposal.

## Cloud use is a separate permission

Cloud use is **off by default**. The connection screen has an explicit checkbox
for allowing cloud models through the displayed Ollama server. Saving that choice
does not itself run a model. Existing tasks waiting for a provider can resume when
their selected model becomes available.

Permission belongs to the exact server origin: scheme, host and port. Editing the
address or choosing **Use installation default** clears the saved cloud permission;
review the new server before enabling it. A lost or contradictory save response
requires refreshing the current connection before another write.

For a server that should never use cloud, set `OLLAMA_NO_CLOUD=1` in the environment
of the **Ollama server process** and restart it. This adds a server-side restriction;
the app still keeps its local/cloud labels and consent checks. See
[Ollama's cloud settings](https://docs.ollama.com/faq#how-do-i-disable-ollama-cloud-features).

## Upgrade or recover a connection

If the app reports an unsupported version, update Ollama using its official
installation instructions, restart the server and retry discovery. The backend
checks the running server version; the version printed by a different CLI does
not establish which daemon it reached. The supported floor is 0.18.0.

If discovery fails, check the address, listener and private network access. A
previously selected model stays visible as unavailable; the app does not silently
replace it with a paid provider. Refresh discovery and review the selection before
resuming a paused task.

## Check the model's required Ollama version

The local-selector floor (0.18.0) establishes the execution boundary. Individual
models can require a newer runner. Discovery reads the running server's
`/api/version` and the model's `/api/show` `requires` field without running inference.
For example, a model requiring 0.30.0 cannot run on a 0.18.0 server even when it
reports tool support.

The connection screen shows the required version separately from tool support in
all seven application languages. Update the **server serving this address**, then
check the connection again. Automatic routing excludes incompatible or unverified
local models. An explicit local selection keeps its local boundary and refuses
inference before dispatch; it does not switch to a paid or cloud provider.

Requirements and versions must be bounded stable versions. Missing or empty model
requirements follow the legacy server contract; malformed declared requirements
remain unverified. Discovery results are cached for up to five minutes. Checking
the connection again refreshes them. A compatible result establishes version
admission, not model quality, available memory, successful tool use or task completion.
An explicitly allowed cloud model's remote runner requirement is not compared with
the local gateway version.

## What the privacy test proves

The native smoke verifies the full published Ollama 0.18.0 archive before executing
its daemon in a fresh private home. It creates one owned remote alias without model
weights, checks native and compatibility local-selector rejections, and checks that
cloud-disabled requests do not reach its owned remote/proxy peer. The receipt
records version, archive/binary digests, request outcomes and process/home cleanup.

A failed startup also records the daemon's observed running/exit state before
cleanup and fixed startup milestones: listener announcement, GPU discovery,
runner start and completed GPU discovery. Raw process output, environment values
and private home paths are excluded. A listener announcement alone does not prove
that HTTP requests succeeded. The original error, readiness deadline and failed
result are preserved; these milestones help investigate a failure without
declaring its cause or treating it as a successful privacy test.

It does not use a person's Ollama profile or credentials. It does not prove a
successful model completion, third-party cloud account usage, system-wide network
isolation, physical-phone behavior or a 24-hour run. CI runs the smoke in the
existing Windows, Linux and macOS native gates; each platform needs its own passed
receipt before claiming native acceptance.

For maintainers with an already downloaded, pinned release archive:

```sh
ACOS_OLLAMA_BOUNDARY_SMOKE=1 pnpm test:ollama:native /absolute/pinned-archive /absolute/new-receipt.json
```

On PowerShell, set `$env:ACOS_OLLAMA_BOUNDARY_SMOKE = "1"` first. No installer,
model download or account inference is performed by this command.
