# Reviewed workspace file edits

The Computer file editor must not save a preview over a complete file, silently replace a newer revision, or empty an existing file while creating a new one.

## API contract

`POST /api/agents/{agentId}/vm/files-list` returns a bounded directory observation. `total` is the number of returned entries, not a recursive or complete population count. The server examines at most 2,000 entries, reports `truncated` when enumeration continues beyond that limit, and counts unreadable, linked, special or noncanonical paths in `skipped`. A client may label the observation complete only when `truncated` is explicitly false and `skipped` is zero. Older responses without these fields are incomplete. This is not an atomic filesystem snapshot; host writers can change the directory during enumeration. The UI keeps last-loaded entries visible after a refresh failure and never labels an incomplete empty result as an empty directory.

`POST /api/agents/{agentId}/vm/file-read` returns the original text preview and:

- `version`: SHA-256 of the complete raw bytes, including the BOM and original line endings. It identifies content rather than an immutable filesystem object or historical revision.
- `editable`: true only when the complete file is valid UTF-8, has no NUL bytes, and fits within the 128 KiB editor limit.
- `truncated`: identifies a preview shortened to 128 KiB. Reads are bounded to a 256 KiB source file; larger or nonregular files are rejected. Invalid UTF-8 may be shown as a replacement-character preview, but cannot be saved through the reviewed editor contract.

An absent read target returns HTTP 404 with `VM_FILE_MISSING`. A missing current file does not establish whether a previous request ran.

`PUT /api/agents/{agentId}/vm/file-write` now **requires** `expectedVersion` in addition to `path` and `content`:

```json
{
  "path": "notes/result.txt",
  "content": "A new file.\n",
  "expectedVersion": "missing"
}
```

Use `missing` only to create without overwriting an existing target. To update, supply the exact 64-character version from the reviewed read. Unknown input fields are rejected. The complete new content must also be lossless UTF-8 without NUL bytes and fit within 128 KiB. A successful response returns the published content's version and byte count. Clients written against the earlier alpha contract must add this field; there is no blind-overwrite compatibility fallback on this HTTP endpoint.

`VM_FILE_CHANGED` returns HTTP 409 when the reviewed source no longer matches or a missing-only target already exists. `VM_FILE_NOT_EDITABLE` returns HTTP 422 for a preview or unsupported editor content. Malformed/missing versions are rejected before a write. A conflict requires a fresh read and a deliberate review of the new content; automatically replacing the version token and retrying would defeat the protection.

## Interrupted responses and UI behavior

The client validates the write response against the exact path, UTF-8 byte count and SHA-256 of the submitted content. A failed or inconsistent reply does not prove the file was unchanged. The draft remains visible and further saving is blocked until the operator compares a fresh server read with the draft and explicitly finishes review. If current content matches the draft, review can finish without another write. The interface does not claim that a matching read proves which request originally wrote those bytes.

The textarea displays normalized newlines, but the edit adapter applies the changed range to the original source. Untouched mixed line endings and BOM characters remain unchanged; newly inserted lines use the source's first line-ending style. Intentional replacement or deletion of text still changes those selected characters. Oversized drafts remain intact instead of being silently shortened.

The file list, creation and editor forms, comparison, local recovery and deletion flow use all seven selected-language packs with semantic light/dark themes, Arabic RTL, 16px source inputs and 44px controls. Filenames and content remain original source data. The create form submits the exact relative path shown, never silently trims it, and uses missing-only creation. Validation uses React Hook Form and Zod, inline messages and first-invalid-field focus.

Multiple drafts belong to the current agent and browser tab (`acos.file-editor.v1:<agentId>` in `sessionStorage`). Closing a dialog, switching profile tabs or navigating between routes preserves them. Reload restores them with a fresh-review requirement. The stored envelope is limited to 100 drafts and 1,000,000 serialized JSON characters; exceeding a limit or a browser quota blocks new writes without truncating visible input. In-memory recovery survives SPA route changes even when storage fails, and a native leave-page warning is requested while unstored work exists. A full reload or closing the tab can still lose unstored work; closing a tab can also remove its saved session data. Drafts are not shared with another browser or phone.

Before dispatch, the client stores the exact path, source, reviewed version and a local request UUID. Reload never resends it. Lost or malformed replies leave an unconfirmed warning; read-only comparison or explicit review of possible effects can clear local recovery. Clearing never repeats or cancels a server write. A late receipt merges only into its matching request, rebases any text typed after dispatch, and preserves a newer new-file path. It can update a remounted editor without replacing its newer draft. Damaged recovery data requires explicit local clearing. These UUIDs are not server deduplication keys; tab-local recovery is not a durable server receipt or cross-device outbox.

## Reviewed deletion

`POST /api/agents/{agentId}/vm/file-delete-preview` accepts only `{ "path": "folder" }`. It reads the complete target scope without deleting, returning `path`, an opaque `version`, `entryCount`, `totalBytes`, and every entry's relative `path`, `type` and file `sizeBytes`. The target itself and empty directories count as entries. No file contents or host paths are returned. There is no truncated or sampled success response.

Inspection rejects symlinks/junctions, special files, the workspace root, scopes above 1,000 entries or 64 MiB of total file content, nesting above 32 levels beneath the target, relative paths over 2,048 characters, and scans exceeding a five-second work deadline. Directory iteration and file hashing are bounded; the deadline is checked between filesystem calls and cannot interrupt a hung underlying filesystem. Operator management on the host remains necessary for scopes that cannot be inspected here.

`DELETE /api/agents/{agentId}/vm/file-delete` requires `{ "path": "folder", "expectedVersion": "<version from preview>" }`; missing versions and unknown fields are rejected. Its version covers the exact agent/path scope, every directory, full raw file bytes and filesystem object metadata. Replacing a file with identical content also requires another review. Deletion re-inspects the complete scope while holding the same cooperative file-operation lock used by writes. HTTP 409 / `VM_DELETE_CHANGED` means the reviewed scope changed, 404 / `VM_DELETE_MISSING` means the target is now absent, and 422 / `VM_DELETE_NOT_REVIEWABLE` means inspection could not produce a complete supported scope. An absent target is not reported as a newly successful deletion. Internal agent `rm`/delete tools retain their separately authorized semantics; this is an operator HTTP contract change.

The dialog lists the complete scope with counts and exact original paths, requires explicit confirmation, and renders seven selected languages with semantic themes and RTL. The client verifies manifest structure, parent relationships, unique paths and exact totals before enabling confirmation. It stores the exact pending request locally before sending; unavailable storage blocks dispatch. Failed or inconsistent replies become unconfirmed, including when partial filesystem effects are possible. A reload restores the warning and never sends the request again. The operator can inspect the current scope, review possible effects, clear the local warning and deliberately begin a new inspection. Missing content alone does not identify which request or actor removed it.

Deletion recovery belongs to this browser tab (`sessionStorage`), not a durable server receipt or shared-device history. Closing the tab may remove it. Its UUID only identifies the local record; it is not a server deduplication key. A late reply only updates the matching local record. Clearing a warning neither cancels nor repeats a server request. Deletion has no filesystem rollback or trash recovery; partial removal can precede a failed response.

## Filesystem publication and concurrency

Text and binary writes use a unique temporary file in the destination directory, flush it, then replace the target by rename. Missing-only creation publishes by a hard link so a concurrently created target cannot be overwritten. The temporary link is removed on ordinary completion or error; a process crash may leave an orphan `.acos-write-*.tmp` file. Cleanup never removes the destination. POSIX replacements retain ordinary permission bits and flush the parent directory; platform ACL preservation and power-loss recovery require deployment-specific verification. The filesystem must support same-directory rename and hard-link publication (for example NTFS or a suitable POSIX filesystem). Unsupported publication fails rather than falling back to blind overwrite.

Built-in text/binary writes, deletion, directory creation and `touch` share an agent-level queue. `touch` updates a regular file's timestamps or creates it, preserving existing contents. Native PostgreSQL additionally provides a transaction-scoped advisory lock for cooperating API and worker processes, with a five-second lock wait limit. All such processes must share the same PostgreSQL database and workspace filesystem. Development PGlite uses the in-process queue only; separate in-memory development servers are not a distributed file store.

Tool admission hooks run before the file lock is acquired and are not called again inside its database transaction. Operator file write/delete endpoints now check the persisted emergency-stop state at admission, including when another process set it, and the local emergency epoch is rechecked before effects. A stop becoming active on a different replica after admission still depends on propagation of that replica's local stop state; this is not a cross-process atomic stop-versus-filesystem transaction. PostgreSQL protects cooperating operations while the connection and lock remain valid; it does not make the external filesystem part of the database transaction. A database/transport failure can occur after filesystem publication. Treat that result as unconfirmed and read before deliberately proceeding; do not claim rollback or exactly-once execution.

Host editors, explicitly enabled arbitrary processes and other writers that bypass this protocol do not participate in its lock. They can race between inspection and the filesystem effect; suspend those writers before deleting shared content. Agent tool/terminal commands that explicitly replace content retain their own semantics; they do not automatically gain reviewed-version enforcement from the editor endpoint. Privileged host operations need separate safeguards. These workspaces are path-constrained directories, not an operating-system isolation boundary.
