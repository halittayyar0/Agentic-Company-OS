# Guided model connection and first useful job

Status: implementation design, not a released capability. Baseline: v0.3.13.

## Intended outcome

A person with basic technical knowledge writes a useful job, connects an existing
local model or an eligible ChatGPT account, and returns to that same editable job.
Only their explicit Start submits it. The product earns adoption through a useful
finished result, visible evidence, understandable permissions and recurring work.
Feature counts and viral reach are not acceptance criteria.

The operator has authorized routine implementation, tests and publication after
the required gates. Use native execution to avoid unnecessary agent contexts;
one independent whole-branch review follows implementation. Human authentication
and any paid model call remain separate from fixture verification.

## Chosen architecture

Extend the existing provider routing, revision coordination, task scheduler,
permissions and delivery ledger. Introduce an app-owned ChatGPT registration
store and a distinct Responses transport. Use Codex App Server only for explicitly
selected coding work, with the same ownership, permission and cancellation rules.
Do not replace the existing runtime for ordinary tasks.

Alternatives considered: importing another complete agent framework duplicates
the existing durable runtime; a provider-only Settings page leaves the unsent
first job behind. A focused connection flow plus adapters addresses both gaps.

## 1. Local model connection

- Persist optional `ollamaBaseUrl` alongside existing provider configuration in
  combined mode and in the encrypted, revision-guarded split configuration.
- Reuse `validateOllamaBaseUrl`; accept only its current private/loopback targets,
  no embedded credentials, query, fragment, metadata address or arbitrary proxy.
  Store its canonical OpenAI-compatible `/v1` address, maximum 2048 characters.
- Missing/null restores environment configuration, matching existing provider
  semantics. Explain when an environment connection remains active.
- Apply the accepted revision to API and workers before their next provider call;
  invalidate stale catalog data. Reject stale edits without replacing valid data.
- Explain that the endpoint is reached by the installed server. A phone's
  localhost and a container's localhost are not the host model server.
- Discover installed models without downloading models or sending inference.
  A real connection test is a separate explicitly requested operation.

## 2. ChatGPT registration

Implement the official OSS/local-app flow rather than reading Codex's credentials.
Keep a stable UUID URN host identity and the issued client ID. Every attempt gets
fresh state, nonce and PKCE and an exact 127.0.0.1 callback. Validate the signed
identity token and show the proposed account before activating a replacement.
Identity-only consent must not enable plan inference.

Credentials never enter browser storage, public APIs, logs, exported workflows,
or repositories. Combined storage requires owner-only Unix permissions or Windows
ACLs; split storage uses authenticated encryption and durable revision authority.
Failures must preserve a previously working registration.

Account status and inference capability are separate. Refresh token rotation is
serialized with a durable registration lock and compare-and-swap revision, not
just an in-process mutex. Retain returned expiry and refresh timing. Temporary
failures keep valid registrations; revoked registrations require sign-in using
their existing client ID. Sign-out distinguishes local removal from confirmed
remote revocation.

Official reference (checked 2026-10-03):
[Registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

## 3. Plan inference and usage

Discover account-specific models and preserve supported IDs, labels and order.
Use a distinct streamed Responses adapter with explicit history and `store:false`.
Normalize completed text and local function calls into the existing turn contract;
preserve tool-call IDs. Unsupported controls and hosted tools are rejected before
network traffic. A text delta, EOF or process exit alone never proves completion.

Only a terminal completed response succeeds. Incomplete, failed, quota-limited,
cancelled and interrupted streams retain truthful states and reported usage when
available. Missing usage or monetary cost is unknown, never zero. Existing task
and family spend admission limits subsequent calls after recorded usage; it does
not guarantee upstream in-flight billing caps. Never silently switch a selected
plan/local provider to a paid API.

Official reference:
[Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[preview constraints](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## 4. Coding harness

Use the Apache-2.0 Codex App Server protocol through a child owned by the current
task attempt. Initialize, start/resume a thread, start/steer/interrupt a turn and
accept only its terminal outcome. Preserve lease and account revision fencing.
Process stderr and transcripts are bounded and redacted. Never inherit the user's
personal Codex login, home, extensions or broader approval policy.

Map workspace reads/writes and approval requests into our existing permissions.
When an effect cannot be governed with the selected permissions, reject that
capability before starting the child. A task cancellation or lost lease stops the
owned process. Returning text does not prove a patch built or tests passed.

Official reference:
[App Server](https://learn.chatgpt.com/docs/app-server),
[plan token integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).

## 5. First-job interaction and server handoff

Home and New project keep their text, mode, title, priority, project type and
cadence through connection setup and denied/cancelled sign-in. Prefer a focused
connection dialog that leaves the composer mounted. When navigation is needed,
use a size-bounded, versioned, validated tab-local draft with no credentials.
Storage failure retains editable in-memory input; malformed storage never
overwrites a valid draft. A callback cannot start a job.

Local sign-in applies only when the browser and callback listener share the same
computer. For remote servers, offer the official local CLI/SSH handoff; transfer
only the selected protected registration and let the target own subsequent
refreshes. No HTTP credential-upload route or misleading mobile callback button.
Normal phone access continues through the existing private responsive web app.

Apply Apple Design principles to this web flow: explicit hierarchy, inline
feedback, keyboard focus restoration, 44px phone actions, 320px layout, reduced
motion, and authored tr/en/de/ru/zh-CN/zh-TW/ar text with Arabic RTL. Use the
approved Continue with ChatGPT action. Connected, discovered and tested are
different states. Current provider evidence remains visible after a failed save.

## Acceptance and publication

- Local-file and split-worker endpoint updates survive restart, conflict safely,
  reject unsafe endpoints, and invalidate old catalog state before inference.
- OAuth fixture tests cover denial, cancellation, expired/replayed attempts,
  wrong state/nonce/audience/issuer/signature, identity-only permission and account
  switching. Concurrent refresh cannot overwrite newer credentials.
- Real streamed fixture tests cover tool history, partial output then quota/error,
  cancellation, timeout, missing final event, missing usage and unknown cost.
- Codex fixtures cover initialized/thread/turn protocol, approvals, lost ownership,
  child crash, cancellation and unverified deliverable states on all platforms.
- Browser tests cover seven locales, narrow/RTL layouts, keyboard recovery,
  draft preservation and no automatic job submission across connection failures.
- Generated API types, security/license checks, build and bundle budgets pass.
  One fresh review and the exact-head required CI gates precede publication.
- Live human sign-in, live provider quality, measured cost savings and physical
  phone checks are reported separately; fixtures cannot establish them.

After this flow ships, evaluate turning one verified finished result into a
portable recurring workflow. Reuse current recurring jobs and delivery evidence;
never export secrets or auto-import broader permissions. This is the next product
cycle, not a substitute for completing the connection flow above.
