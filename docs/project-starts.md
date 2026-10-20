# Recover a project start

Home and New project save a start request in this browser tab before sending it.
The server records that request with the created project. A matching saved
receipt is required before the screen opens the project or clears its submitted
draft. Creating a workspace does not mean its work has finished.

## If the response is lost

- Keep the tab. **Check request** reads the saved result without submitting
  another job or making a model request. The original job may already be running.
- If a project was created, choose **Open project** to inspect its current work.
- If no receipt was found, **Retry same request** sends the original request ID
  and original instructions. Later edits are kept for another job. The server
  serializes matching replays so they do not create a second project.
- If the request was rejected, resolve its displayed reason, then choose
  **Prepare a new start**. This creates no job by itself.

Reloading or changing between Home and New project does not submit anything.
An unresolved request blocks a fresh start on both screens. A late response after
leaving the composer cannot navigate back or clear its saved request. A response
with a different request ID cannot open a project.

The brief and approach remain editable while an uncertain request is at rest.
Opening an older request preserves a later draft. Home also keeps its draft when
recovering after reload or opening a request from New project, because that
request cannot acknowledge the current Home draft. If you submit that retained
text again after recovery, you are explicitly creating another job.

## Storage and permissions

The tab's session storage retains the request ID and submitted brief until
recovery clears the matching record. This is local tab recovery, not a backup or
cross-device inbox. Keep a separate copy of important instructions before closing
the tab. Separate new requests from other tabs or devices remain separate jobs.

If a saved identity cannot be written and read back, no new request is sent.
Malformed saved records remain intact for recovery. A rejected request exposes
the existing emergency-stop, team, capacity or execution-policy reason. Recovery
does not grant permissions, restart a stopped task, or bypass approvals and usage
limits.

Only the selected language's recovery copy is loaded. All seven languages use
the same recovery controls as the detailed project composer. A failed control
or language download keeps the Home text editable and start disabled.
