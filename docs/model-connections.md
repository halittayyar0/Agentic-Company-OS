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

Ollama requires 0.18.0 or later. Local, cloud and unverified models have separate
labels; cloud permission is off by default and resets when the server address
changes. [Local models, private addresses and cloud permission](./local-models.md).

## Review before starting

Task workflows initially send only calculation, completion and tool loading schemas.
Other authorized tools, including guides, questions and approval requests, load
with their full schemas when needed. Loading grants no permission. This reduces
the initial request size; some workflows need an extra model call, and small
local models still require a real task test.

In the development branch, local thinking models receive `reasoning_effort: none` by default during tool
workflows, to preserve the output budget for actions. Advanced API callers can
set `localReasoningEffort` explicitly. Plain chat without tools keeps the model
default; cloud models keep their existing behavior. Support and results depend
on the model. Shared internal policy is concise English; your selected language
and complete localized/custom role playbook remain in the request.

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

## Completion review (development branch)

The completion reviewer checks each required action against recorded tool use for this task cycle. A correct answer does not replace a requested action. It reads bounded counts across the cycle as well as recent receipts; truncated records cannot prove an action never happened. This uses the existing review call. Metadata and a model verdict do not guarantee the quality of files, tests or results.

## Clear damaged retry details (development branch)

If a paused task reports damaged retry details, choose **Clear damaged details**. This first checks the current task on the server, then removes only the unchanged damaged entry in this browser tab. It sends no model request and does not resume work. Review the task and choose **Retry this task** separately; retry can use tokens.

A valid unresolved request cannot be cleared this way: use **Inspect retry receipt**. If storage is unavailable or the entry changes during checking, repair remains unconfirmed. Check the task state and browser storage, then reload. A storage warning after accepted or rejected retry does not reverse the server’s result.
