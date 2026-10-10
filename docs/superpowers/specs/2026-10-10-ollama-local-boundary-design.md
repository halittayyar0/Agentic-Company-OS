# Ollama local execution, explicit cloud choice and final dispatch authority

## Intent and authority

Goal 7 prioritizes private, affordable installation and a reliable first useful outcome, with seven authored application languages. A person choosing a local model must understand where their prompts run. Cloud use must be an intentional choice, not an unnoticed fallback. The user authorized routine design, implementation, tests and protected GitHub publication without repeated approval. This is an architectural change to catalog contracts, saved provider consent and dispatch. Implement natively in one session; use one fresh whole-branch reviewer at completion. Do not spend money, authenticate a human account or send real prompts to cloud services.

The primary `D:\Agentic-Company-OS` remains untouched. The Windows corrective PR49 checkout and its live full-source test remain frozen. This work uses the separate managed `ollama-local-boundary` worktree from exact PR49 source `432186f85a23456827a57585951463721863b27f`. Rebase onto the ordinarily accepted main after PR49 admission; this branch is not independently publishable before its own full acceptance.

## Evidence

Unchanged production code was exercised through owned loopback peers. It labels a renamed remote alias local, admits it to a pinned local/free fallback plan, forwards its alias without enforcing locality, continues using a captured old endpoint after `beforeRequest` changes configuration, and follows an HTTP 307 to another origin. Three controlled fixture completions reproduced these defects with no external destination, paid inference or user data. Separate receipts proved owned cleanup and unchanged frozen source. These are defect reproductions, not remediation or evidence of a real external leak.

Pinned official Ollama v0.18.0 (`3980c0217d27e05a441808a446e7ee5ea7e04256`, published 2026-03-14) and v0.40.2 source support explicit local references on the compatibility chat route. The proxy middleware passes parsed local references to ChatHandler; ChatHandler rejects resolved remote aliases before inference proxying. Inspected v0.16.0 and v0.17.x source lack this enforcement. The support floor is **Ollama 0.18.0**; a real released-server privacy check remains required before claiming that floor works. Source references:

- [v0.18.0 routes](https://github.com/ollama/ollama/blob/3980c0217d27e05a441808a446e7ee5ea7e04256/server/routes.go)
- [v0.18.0 proxy](https://github.com/ollama/ollama/blob/3980c0217d27e05a441808a446e7ee5ea7e04256/server/cloud_proxy.go)
- [v0.18.0 model references](https://github.com/ollama/ollama/blob/3980c0217d27e05a441808a446e7ee5ea7e04256/server/model_resolver_test.go)

## Approaches and decision

Name filtering alone misses renamed aliases and stale metadata. Disabling every cloud provider would discard useful intentional provider choices. Choose structured catalog classification, endpoint-bound saved cloud consent, explicit model namespaces and final transport enforcement. This preserves existing local pins while making cloud use available deliberately.

## Catalog and namespaces

- Keep `ollama:<upstream>` as **local-only**. Existing saved agents, task pins and reusable/recurring work retain that meaning without a database migration.
- Add `ollama-cloud:<upstream>` for an explicitly cloud-backed Ollama choice. Both use provider `ollama`; the namespace determines the durable requested boundary. Never silently rewrite a saved local ID into a cloud ID.
- Add optional `executionLocation: "local" | "cloud" | "unknown"` to the model catalog contract for compatibility with old clients/fixtures. Actual discovered Ollama rows always carry a classification. Missing classification cannot qualify an Ollama model as local or free.
- Validate `remote_host` and `remote_model` in tags/show. Remote metadata and explicit cloud names identify cloud rows; inconsistent/malformed metadata is unknown. A locally reported tool-capable model on a supported server can qualify as local. Unknown is visible and unavailable for automatic local routing.
- With cloud consent off, skip show requests for known remote rows. Show for local discovery uses an explicit local reference on supported servers. Do not send inference in discovery. Do not expose remote URLs, untrusted upstream error bodies or control characters in catalog copy.
- Preserve the existing 100-row cap, four parallel show requests, five-second metadata deadlines, cache/retry limits and stale-generation fences. Stale/unreachable discovery does not expand a boundary.
- Expose sanitized server version, local enforcement support, cloud consent state and local/cloud/unknown counts in Ollama settings. Unsupported/unreadable server versions need an actionable upgrade or retry message; reachability is not inference readiness.

## Cloud consent and saved settings

Add optional `ollamaCloudOrigin: string | null` to encrypted/file-backed runtime config. This stores the canonical private origin the operator explicitly permitted, not a browser credential. Existing installations default to no consent.

The settings request accepts `ollamaCloudEnabled?: boolean`, under the existing strict expected revision and serialization. Enabling resolves and stores the effective address's canonical origin within that revision update. Disabling clears consent. Changing or restoring an address never carries consent to a different origin. An environment address change after restart also fails the stored-origin comparison. Never allow the browser to submit an arbitrary consent origin.

Bootstrap, desired config encryption/decryption, split API/worker application/acknowledgment, local file parsing and sanitization all preserve the new field. Invalid consent fails validation; no unknown result is treated as a successful write. Configuration consent changes invalidate both cached discovery and captured request authority. The ordinary save creates no job or inference. Existing already-authorized provider-waiting tasks may wake, but local/cloud task IDs and final admission still govern execution.

## Inference and routing

Introduce an explicit `OllamaInferenceRequest` snapshot: configured origin, generation, requested boundary, upstream model and guarded SDK client. `prepareOllamaInferenceRequest(modelId, signal?)` validates configuration, current version/local capability or explicit cloud consent without inference. The local wire model adds the server's local selector to a valid canonical upstream reference. Never append a conflicting selector blindly. The cloud namespace requires matching cloud consent and a known cloud route.

Preserve the host's `beforeRequest` callback exactly once and in its existing durable admission order. After it resolves, `assertOllamaRequestCurrent(snapshot)` checks the generation and origin. The actual SDK fetch repeats this check immediately before network dispatch, pins the destination to the snapshot's exact origin and forces `redirect: "error"`. All retry attempts use this guarded transport; no retry can silently adopt a new server. Metadata transport remains credential-free and disallows redirects. A source/server update after dispatch does not erase a response's real usage evidence.

Use a typed `OllamaBoundaryError` with static safe codes for missing setup, unsupported version, unknown locality, cloud consent missing and changed server. Integrate it into existing task failure/retry/wake behavior so pre-dispatch failures remain actionable, cannot invent consumed-usage receipts and do not trigger paid fallback.

Automatic Ollama selection and a local primary's fallback candidates include only verified local tool-capable rows. A local primary keeps this boundary even in automatic mode. Ollama cloud is not free, including aliases ending in `:free`; selecting it requires a manual cloud namespace and preserves that selected route instead of transparently adopting another billing boundary. Existing other-provider free pins and task-over-agent precedence remain intact.

## User experience and languages

Retain the existing composer, connection dialog, Settings and model picker layouts. Explain Local, Cloud, Unknown and tool support separately. Add an accessible cloud toggle with clear prompt/privacy and account-usage explanation in the Ollama connection section; it starts off, is bound to the observed address/revision, and resets when editing/restoring a different address. Show save/unknown/conflict handling through existing confirmed-write controls.

Author equivalent copy for `tr`, `en`, `de`, `ru`, `zh-CN`, `zh-TW`, `ar`; load one language pack at a time. Preserve Arabic RTL, explicit focus restoration, 44px controls and 390px no-overflow behavior. Model badges distinguish provider usage from local computation; never show an Ollama cloud alias as free. Update both model pickers, expert/agent creation and any active advanced settings connection controls so another entry point cannot contradict the same server contract.

Provide a short English operator guide with Ollama 0.18.0 requirement, update/retry steps, private native/container addresses, explicit cloud choice and limits. A private endpoint alone does not prove its model computes locally. Local computation consumes the user's own hardware; cloud models use the Ollama account's applicable usage/charges. No cloud quota, price or free allowance is invented. README links to this guide.

## Verification and completion

Use real owned HTTP transports for discovery, stale generation, final dispatch, redirects and alias replacement tests. Include source-generation changes in the host callback and before SDK fetch, malformed/partial metadata, supported/unsupported/prerelease versions, identical-origin consent and changed environment/worker revisions. Pin recurring/task IDs, local and free fallback plans and durable admission/accounting behavior. Existing local tests must be updated to advertise the actual support contract, never removed or weakened.

Add an actual pinned released-server privacy check with a credential-free owned model directory, owned loopback port and synthetic remote alias. Demonstrate that local selector rejects that remote alias before cloud dispatch; retain exact runtime/archive hashes and owned cleanup. No model download, cloud authentication or paid inference is needed for that check. A real local-model first useful outcome is a later explicit acceptance task, not implied by metadata or this privacy probe.

Run generated API parity, typecheck, formatting, security and relevant full source/UI/native release gates. Include all seven locale connection/model-selection flows at phone width. Rebase after PR49 accepted integration, commit exact tested source, publish a PR and use ordinary protected merge only after its own complete original acceptance. Verify resulting main/public source. No tests, expectations, branch protection, runtime containment, caller permissions or real-account boundaries may be waived. Keep 24-hour and physical-phone results separate.
