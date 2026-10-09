# Connect a model and keep your first job

[English](./model-connections.md) · [Türkçe](./model-connections.tr.md) · [Deutsch](./model-connections.de.md) · [Русский](./model-connections.ru.md) · [简体中文](./model-connections.zh-CN.md) · [繁體中文](./model-connections.zh-TW.md) · [العربية](./model-connections.ar.md)

> For v0.4.0 and later. Earlier setup bundles do not include this flow.

## Start with the result you want

Write your job on Home or New project, then open **Connect a model**. Closing
setup, cancelling sign-in or changing the interface language does not submit
the job. Only **Start** submits it. If browser storage is unavailable, a warning
explains what a full reload can lose.

| Choose      | What you need                                                  | What saving confirms                                                                     |
| ----------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Local model | An existing Ollama server with an installed tool-capable model | Saved address and discovered catalog; no download or inference test                      |
| ChatGPT     | An eligible account and plan permission                        | Reviewed registration and separate account selection; availability and quota still apply |
| API key     | Your own OpenAI or OpenRouter key                              | Saved configuration; provider charges may apply                                          |

The **backend** must reach the Ollama address. Your phone's `localhost` points
at the phone; a container's points at the container. Use a private address
reachable from the installed runtime. **Use installation default** removes the
saved override; an environment connection can remain.

## Review before starting

Discovered, connected and tested are different states. The explicit model test
in advanced Settings sends a request; saving does not. Existing jobs already
waiting for a provider may continue after saving. If a save is unconfirmed,
inspect the current connection before trying again.

ChatGPT account saving and selection are separate actions. Identity-only sign-in
cannot run models. For a server or container, use the [protected handoff guide](./chatgpt-connection.md#on-a-server-or-in-a-container)
from your own computer. A phone cannot complete the server's loopback callback.
Never paste transferred credentials into the browser.

Return to your job, review permissions and output requirements, then press
**Start**. [Private phone access](./mobile-access.md) uses the same web interface.
Optional native Codex coding has [separate platform requirements](./chatgpt-connection.md#optional-governed-coding-runtime);
connecting a model does not enable it automatically.

If a model does not report token usage, the job and its subtasks pause before
further calls. The recorded work is kept. Review the calls and start a new job
with a provider that reports usage; missing dollar prices remain unknown even
when token usage is complete.

## Optional coding installation

The container installer has a separate, unchecked **Codex coding worker** option. It requires a Linux x64 engine, Compose 2.24.4 or later and terminal permission. Selecting the Code tool pack does not enable it. Connect an eligible account after setup; other tasks retain your chosen provider. AppArmor hosts require the bundled profile to be loaded by an administrator. See the [installation requirements](./self-hosting.md#optional-coding-workers).
