# Project meeting turns and recovery

A meeting turn is a bounded, tool-free text round for selected participants. Its record does not prove that a suggested decision, action or external task was executed. Meeting creation, manual decisions/actions and meeting completion are separate commands.

## Upgrade and request identity

Apply the checked-in migrations through `0024_project_meeting_commands` before starting the updated API. Deploy the matching frontend and generated clients. `POST /api/projects/:projectId/meetings/:meetingId/start` now **requires** a UUID `requestId`; a legacy request without it receives HTTP 400 and starts nothing. No automatic compatibility path creates an identity after a client has lost its response.

The identity binds the project, meeting, normalized prompt, ordered participant IDs and token limit. Changed input under an accepted ID receives HTTP 409. Save the UUID and exact input before sending. To observe it, use:

```text
GET /api/projects/:projectId/meetings/:meetingId/turn-requests/:requestId
```

This authenticated endpoint only reads. It never dispatches a model, resumes a round or changes an expired row. A missing scoped receipt returns 404; it does not establish whether a previously sent request is still on its way. Explicit retry therefore uses the **same** ID and input.

| Receipt state | Meaning                                                                                                                                              | Matching POST replay                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `running`     | The reservation is live; the outcome is not yet recorded.                                                                                            | HTTP 202, without another round.                                                 |
| `complete`    | A final turn outcome is stored, including skipped participants and failures. It does not mean all participants replied or the meeting was completed. | Returns the original HTTP status and body, including a recorded 409/503 failure. |
| `unconfirmed` | The reservation expired or the round lost its right to continue. Existing input/replies remain in the meeting.                                       | HTTP 409, without resuming the round.                                            |

An expired stored `running` row is exposed as `unconfirmed` using the database clock. A later claim may retire the row, but can never reuse its identity. After a process interruption, observing the receipt does not prove whether an in-flight provider call was billed or completed remotely.

## Execution rules

- API replicas sharing the database serialize claims through the runtime-control row. The same meeting has at most one live reservation, and `PROJECT_MEETING_MAX_CONCURRENT_STARTS` limits live reservations across those replicas. Use the same limit on all replicas.
- The founder transcript and new reservation commit in one transaction before provider work. Only the creator of that reservation dispatches the round.
- Admission and reply persistence check the live request owner, deadline, open meeting, active agent and agent lease against the database clock. Lock order is runtime controls, request, meeting, then agent.
- Cancellation/completion cannot be undone by a late response. Expired or replaced agent leases cannot write a late transcript or clear a replacement lease.
- Emergency stop invalidates live meeting reservations in the same transaction that releases execution leases. Removing the stop does not revive remaining participants of an old round.
- A stop or deadline prevents further admission and accepted transcript writes. An already dispatched remote model request may still finish and incur usage; this is not remote provider cancellation.

Durability across restarts requires the production PostgreSQL store. Development PGlite is process-lifetime storage and cannot provide restart recovery. The deterministic tests use separate API router instances over PGlite; native PostgreSQL multi-connection/process-restart acceptance is a separate release gate.

## Browser behavior

The frontend stores the original input under `acos.meeting-turn.v1:<projectId>:<meetingId>` in `sessionStorage` before POST. Storage failures block dispatch. The saved intent survives a reload in that tab. It is not a cross-device draft backup and can be lost when the tab/browser storage is cleared.

After an uncertain response, the project-level recovery inbox remains available even if its meeting is missing from the list or the list cannot load. It shows the original meeting/request identity, prompt, participant IDs and saved response limit. Nothing is dispatched on discovery, selection or reload. An explicit check reads the exact receipt; a complete result shows this turn's recorded expert replies, skipped-participant reasons and any recorded failure without relying on a current meeting detail. These are original turn results, not a current meeting view or proof that suggested actions were executed.

A 404 enables an explicit retry of the saved identity; running or unconfirmed accepted turns are never automatically retried. Recorded, unconfirmed and missing receipts also allow explicit review before clearing the local marker, so a deleted meeting does not trap the operator in endless retries. A missing receipt does not prove the request was never accepted. A new identity can repeat work and incur more model usage. Clearing the marker neither cancels server work nor deletes the server receipt. Acknowledgement compares the original complete intent; a late response cannot clear newer input even if the UUID was reused.

The inbox displays 20 local records per page and scans storage keys in explicit 1,000-key increments, with visible incomplete-scan and read-error states. Damaged keys/values are preserved and cannot dispatch a model. Their cancel-first review shows the original raw data, requires explicit confirmation and clears only the exact reviewed key/value; replacements and other projects survive. Successful clearing moves keyboard focus to the meeting heading. These recovery records remain local to the original tab, including when the operator also accesses the application on a phone.

Ordinary unsent fields use the separate `acos.meeting-drafts.v1:<projectId>` session record. It preserves the open creation form, title, agenda, selected participants, selected meeting, and each meeting's message, decision, action, owners and closing summary across view changes and reloads in the same tab. Draft text retains its original whitespace and script. Only a confirmed mutation clears the matching submitted draft; a delayed response cannot clear another meeting's input. These are browser drafts, not cross-device or server backups.

Malformed drafts remain untouched until an explicit review and clear. Storage write failures keep the editable in-memory text, warn before leaving the page and block mutations until storage works. The review dialog defaults to keeping drafts, restores focus on cancel, and clears only ordinary drafts for that project. It does not remove pending turn or manual-command identities or server records. Copy needed text before clearing local drafts.

The meeting interface and turn recovery use seven selected-language packs, including separate Simplified and Traditional Chinese and Arabic RTL. Source names, transcripts and proposed decisions/actions remain original content; they are not translated records or proof that a proposed action happened. Dates show the selected locale and explicit `Europe/Istanbul` timezone. Native-speaker acceptance remains outstanding.

Creation, message, decision, action and summary forms use the shared RHF/Zod boundary, field-associated errors and first-error focus. Owner selection is limited to meeting participants. A saved unavailable owner remains visible and must be explicitly replaced or removed; it is not silently reassigned. Enter/composition edits multiline text. Pending submissions block duplicates in the mounted form, await acknowledgment and preserve values on failure. Manual commands and model turns use separate durable identity protocols.

Failed background list/detail reads keep the last loaded records and visible drafts, show the last load timestamp, and block mutations until a read-only retry succeeds. The form and recovery language files must both load before meeting controls become available; a failed file offers a localized page reload. No fallback request creates a meeting or runs a model.

## Manual meeting commands

All seven manual writes require a client-generated UUID `requestId`: create meeting, update metadata/roster/cancellation, append founder transcript, add decision, add action, update action and complete meeting. Older callers receive HTTP 400 before any write. Deploy the matching generated client and API together after migration 0024. Update forms need at least one changed field in addition to the identity.

Their success responses are compact `ProjectMeetingCommandResult` values, not meeting details or the created row. Use `meetingId` and `entityId` to identify the outcome, then read current records through the ordinary GET endpoints. Creation returns a saved draft; starting the first model round is a separate explicit button. Action tracking remains available after the meeting closes.

`GET /api/projects/:projectId/meeting-commands/:requestId` returns the immutable compact outcome and original HTTP status. It only reads, including after the meeting/project is deleted. A missing receipt is 404 and may mean the first transaction has not yet committed; explicitly retry the same identity and exact input. Reusing that identity for another kind, scope or normalized input returns 409.

The runtime-control database lock serializes these transactions with model-turn admission and closure checks. Domain writes and receipt insert commit together. A database failure rolls back both, so a retry cannot duplicate the partially created record. Accepted business rejections (400/404/409) are also recorded and replayed unchanged; after correcting the input or state, use a new identity. Schema/path validation and identity conflicts occur before accepting a new command; they do not create a receipt.

The browser saves one exact pending manual command per project under `acos.meeting-command.v1:<projectId>` before dispatch. New changes pause until its outcome is confirmed. The project-level recovery panel remains visible without a listed meeting. It checks the receipt without sending a command, and offers same-identity retry only after a missing result. A recorded success or rejection requires review; matching success clears only the original submitted draft, while newer edits and failed drafts remain. Storage failures block sending. Corrupt records remain untouched until the operator reviews/copies the original data and explicitly clears them. No retry is automatic; pending input is local to that browser tab, not shared with a phone or another device.

## Retention and remaining limits

Both receipt tables deliberately have no project/meeting foreign-key cascade: deleting domain records must not make accepted identities reusable. New manual-command receipts are bounded to 2048 bytes and contain IDs, kind, status and fixed rejection messages, with no copied meeting text. Model-turn receipts still contain a snapshot of the response, including meeting text, and remain in database backups after meeting deletion. Keep backups private. Automated retention/purge and paged history are not implemented; large, long-running meetings can accumulate repeated model-turn snapshots.

The project inbox now covers damaged and unlisted model-turn intents independently of the manual-command protocol. Native PostgreSQL multi-process/restart testing, physical phone/private HTTPS, Safari, native input methods and native-speaker review remain separate release gates. Do not describe the complete product or every locale as fully verified.
