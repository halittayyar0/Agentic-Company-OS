# Local models and cloud permission

Connect an existing Ollama server in **Connect a model → Local model**. You need
Ollama **0.18.0 or later** and an installed model that supports tools to run agent
jobs. Saving discovers the catalog; it does not download a model or test inference.
Review the model and permissions before pressing **Start**.

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

## What the privacy test proves

The native smoke verifies the full published Ollama 0.18.0 archive before executing
its daemon in a fresh private home. It creates one owned remote alias without model
weights, checks native and compatibility local-selector rejections, and checks that
cloud-disabled requests do not reach its owned remote/proxy peer. The receipt
records version, archive/binary digests, request outcomes and process/home cleanup.

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
