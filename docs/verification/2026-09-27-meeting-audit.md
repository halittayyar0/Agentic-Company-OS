# Project meeting reliability audit — 2026-09-27

This preserves the initial static audit, before the meeting-turn changes. Goal 7 remains active. The [meeting-turn checkpoint](./2026-09-27-meeting-turns.md) records subsequent fixes and verification; the findings below describe the original code rather than its current state.

## Observed code paths

1. `components/studio/project-meetings.tsx` captures mutable selected meeting state in mutation callbacks. Successful turn/decision/action callbacks clear shared form state and invalidate the currently selected meeting. A delayed response after selection changes can therefore affect a newer draft/context. Dispatch should bind the project, meeting, draft and input to an immutable intent; callbacks must only acknowledge that intent.
2. Creation automatically calls the start endpoint. A failed start response is treated as a saved draft that can be started again, although response loss does not establish that the first turn had no effect. Forms lack the question/chat flows' durable request identity and receipt lookup.
3. `routes/project-meetings.ts` uses a process-local active-meeting set and counter around `POST /start`. This does not provide a shared meeting fence across server replicas or after process loss. Existing per-agent leases reduce simultaneous agent use but do not deduplicate the operator's meeting turn.
4. The start handler writes the founder transcript before provider work, but without an operator request ID. Retrying a lost response can append it again and request another model response.
5. After provider work, the start handler can update a previously read draft meeting to `in_progress` using only meeting/task IDs. It does not condition that write on the meeting still being open or on ownership of the same turn.
6. `orchestrator/run-project-meeting.ts` checks agent lease ownership and meeting existence before persisting a reply, but does not check that the meeting remains open. The same transaction does not test lease expiration. A late reply therefore needs additional meeting/turn and live-lease checks.
7. The meeting UI still contains Turkish controls, ordinary state forms, missing/stale data ambiguities and shared drafts. It requires the seven-language, touched validation, pessimistic acknowledgement and recovery behavior established elsewhere.

## Required verification before closure

Use deterministic delayed-provider and lost-response fixtures before any paid provider run. Exercise two API instances, competing starts, crash/restart, exact same-intent replay, changed-intent rejection, late replies after close/cancel, expired or replaced agent/meeting leases, emergency stop, and navigation during pending saves. Test the UI at 320–390px in both themes, all seven languages, keyboard and Arabic RTL.

Keep original user text and participant scope immutable for each request. Receipt recovery must remain read-only until the operator explicitly retries an unrecorded intent. No replay may create a second provider turn for the same accepted request. Closed meetings must remain closed.

This audit does not authorize publishing, installation, credentials or paid provider calls.

## Follow-up scope

The durable start identity, shared reservation, closed-meeting/lease fences, emergency-stop invalidation and scoped callback changes address findings 1–6 for meeting starts. Creation itself and the other write commands still lack durable request recovery. Finding 7 remains open beyond the new seven-language recovery panel and in-memory separation of drafts. Refer to the checkpoint for tested boundaries; native PostgreSQL and crash/restart are not established by the PGlite fixtures.
