# Guided local model preparation

## Outcome

A person with little technical knowledge can connect an Ollama server, obtain a
small model through the application, and return to their existing job draft.
Someone without Ollama receives an official installation handoff for the machine
that will run it. They do not need a terminal command to download model weights.
Preparation makes no inference request and creates no agent or task.

The user authorized autonomous routine development, testing and publication and
explicitly requested no repeated approval questions. Execute this design inline;
human authentication, payments and new credential access remain human actions.

## Evidence and choice

- Baseline: released v0.5.7, main `ea9c571be0f81f4590453086e6675ff654ab1458`.
  Its original source/UI/native/security and public artifact checks passed.
- `guided-model-connection.tsx` currently offers an address and says to add a model
  elsewhere when none is available. No model-preparation endpoint exists.
- Ollama documents `POST /api/pull` with streamed status/digest/byte events:
  <https://docs.ollama.com/api/pull>. Its v0.40.3 PullHandler binds work to the
  request context: <https://github.com/ollama/ollama/blob/v0.40.3/server/routes.go>.
- Official runtime handoffs: <https://ollama.com/download>,
  <https://docs.ollama.com/windows>, <https://docs.ollama.com/macos>,
  <https://docs.ollama.com/linux>. A remote server's OS is not the browser's OS.
- The already tested starter is `qwen3.5:2b-q4_K_M`, requiring Ollama 0.40.3+.
  Its observed model layers total 1,945,782,446 bytes, approximately 2 GB. This is
  an estimate, not a fixed storage or hardware guarantee for future tag contents.

Alternatives: instructions alone leave the current dead end; a second managed
Ollama installation adds platform lifecycle/driver/update ownership and duplicate
runtime storage to every app installation. Use the existing Ollama server and its
model store, with official setup guidance and an explicit download action. This
serves native and container installations through their existing private endpoint
boundary. It does not install binaries, modify OS services or delete models.

## Boundaries

- Node `>=24 <25`, pnpm `>=10.17 <11`; no new package dependencies.
- Reuse the current Ollama private-address validation, origin-scoped cloud consent,
  model location and runtime compatibility rules. Reject redirects; never accept a
  download URL, arbitrary model name, cloud model or credentials in these inputs.
- One curated recipe: ID `qwen35-2b`, reference above, minimum runtime `0.40.3`.
  The actual returned digest is recorded; do not call a mutable tag pinned weights.
- Downloading uses the connected Ollama server's network and disk. Inference and
  model quality are unproven until a real task succeeds. Existing jobs waiting for
  this provider may resume under the unchanged scheduler when a model appears.
- One global active preparation, not one AI agent per download. No automatic POST
  retry, automatic restart after interruption, provider change or task creation.
- Stop closes this application's request. It does not delete partial files or
  claim that unrelated downloads on a shared Ollama server have stopped.

## Operator API and persistence

Use the authenticated Settings boundary and existing CSRF/origin protections:

- `GET /api/settings/ollama/preparations`: current revision, curated recipe,
  current availability and latest preparation. Metadata reads only.
- `POST` to the same path: `{requestId: UUID, expectedRevision: integer,
modelId: "qwen35-2b"}`. Return the durable preparation receipt.
- `GET /api/settings/ollama/preparations/:requestId`: receipt/status only.
- `POST /api/settings/ollama/preparations/:requestId/stop`: idempotent stop.

Add migration `0046_local_model_preparations.sql`, Drizzle schema and journal.
Store request ID/hash, recipe ID, provider revision, state, phase, safe counters,
owner runtime/epoch, lease timestamps, dispatch marker, typed failure, result model
ID/digest and timestamps. Do not store prompts, secrets, endpoint URLs or raw
upstream text. Bigint number-mode counters are bounded below safe-integer limits.

States: `requested -> downloading -> verifying -> ready`; active work can enter
`stopping -> interrupted`, or `failed`. A partial unique index permits one active
row across requested/downloading/verifying/stopping. Replaying an ID with the same
body reads its receipt; a different body conflicts. Concurrent IDs return the
existing active receipt. Mark the dispatch boundary before the single POST.

The API runtime owns the request, with a UUID owner epoch, 30-second lease and
5-second heartbeat. Stale owners cannot update or complete a fenced row. Startup
reconciles expired/dead-owner rows to interrupted; it never resends a pull.
Connection revision changes abort the old request and prevent a current Ready
claim. Bound lock order to provider configuration before the preparation row.
Durable provider targets are read through `readProviderRuntimeConfigSnapshot`.

Stop and runtime shutdown abort the owned stream and join cleanup within the
existing shutdown budget. A lost acknowledgement reconciles with GET, not another
POST. Explicit retry uses a new ID only after the previous request settles; check
whether the model already exists before another dispatch. Backups retain receipts,
not external Ollama model files. Restore/reopen must show live model availability,
not infer it from an old ready row.

## Transport and progress

Send only `{model: "qwen3.5:2b-q4_K_M", stream: true, insecure: false}` to the
validated origin's `/api/pull`. Require a reachable compatible server first.
Use a two-hour request deadline and no SDK/network retries. Start is rate-limited
to six requests/minute/client/process; the database active slot is cross-process.

The reusable reader consumes a `ReadableStream<Uint8Array>` and yields
`OllamaPullProgress {phase, observedCompletedBytes, observedTotalBytes,
progressReset, pullComplete}`. Phases are preparing/downloading/checking/downloaded.
Downloaded is the upstream acknowledgement, not application Ready.

- UTF-8 and JSON frames must be valid objects; accept split chunks, CRLF and a
  final JSON frame without newline. Empty whitespace frames are ignored.
- A frame is at most 64 KiB, at most 32 content digests are tracked, and observed
  aggregate size is at most 3 GiB. These bound this application's parser/request;
  they are not a global disk or shared-server bandwidth quota.
- Byte counters are finite safe nonnegative integers, completed <= total. Digest
  format is `sha256:` plus 64 lowercase hex characters. A digest's total is stable.
  A decreased completed counter is represented honestly with progressReset.
- No overall percentage is inferred from a partially observed layer set.
- A success event is required; EOF alone is not success. Reject events after
  success. Upstream errors and invalid data become fixed error codes, never copied
  into UI/log messages. Release the reader on completion or failure.
- After success, re-check the bound server's model metadata: actual local location,
  tools capability, runtime compatibility and current provider revision. Store its
  actual catalog ID/digest. Only then mark ready and invalidate the model catalog.

## UI and ownership

Extend the existing Local model view in `GuidedModelConnection`; reuse its Dialog,
Button, Input, `LanguagePackStatus`, locale provider and draft/focus restoration.
The new preparation section owns its selected-locale copy through one lazy family.
No preparation code, copy request or metadata request enters initial composer load.
No new palette, typography, mascot, nested dialog or global navigation is needed.

When no compatible local model is available, explain the next action: save/check
the server, install/start Ollama if unavailable, then download the starter. A new
section binds to confirmed settings; unsaved addresses cannot start a download.
Show approximate size/server storage ownership before the explicit Download action.
Show observed phase/bytes and an accessible progress status, not an invented percent.
Close preserves the background request and job draft; reopening reads its receipt.
Stop and retry show honest interrupted/unknown outcomes. Disable local connection
mutations while its request is active; still guard external revision changes.

Current live catalog availability takes precedence over historical ready receipts.
Success offers Return to my job; it does not submit a job or overwrite an existing
model choice. Mention unchanged provider-waiting work behavior. A missing/stale
module or language pack preserves the connection view and offers explicit recovery.

All seven locales: en, tr, de, ru, zh-CN, zh-TW, ar. Use logical spacing, LTR model
identifiers, 44px actions, one parent-dialog scroller, phone width, 200% text,
keyboard focus and reduced motion. Update the maintained UX contract for this flow.
Existing bundle caps remain unchanged. New exclusive preparation UI has a 12 KiB
raw/4 KiB gzip cap; all seven new copy packs together have 32 KiB raw/16 KiB gzip.
Measure only hash-bound exclusive new modules; give no credit for existing code.

## Acceptance

Prove protocol bounds and interruption, durable duplicate/revision/lease behavior,
operator authorization, no inference/task creation, seven-locale narrow/desktop
flows, failure recovery, module budgets, source/build/license/security gates and
matching-host native installation. Use controlled peers for failure/locale cases.
Separately exercise the actual Ollama pull API into an empty owned model store and
complete a first task with the resulting genuine local model, without a paid
provider. Label any cached-only or unexecuted check honestly.

Only publish a new version after reviewed code, original required checks, actual
main artifact/model acceptance and anonymous release readback. Do not overwrite
v0.5.7 or claim general model quality, every OS, physical phones or 24h reliability.
