# Shareable evidence from a task

Open a project, choose **Activity records**, then select **Download shareable evidence**. The download contains the **currently loaded activity page** only. Use the older/newer controls before downloading if you need a different page.

The packet includes task and record IDs, status, stage markers, timestamps and counts. It excludes the task title and brief, result text, activity summaries, agent names, command text, tool arguments and raw output. It also excludes receipt details and files. The original **Download activity JSON** remains available for private debugging and may contain sensitive summaries; review that file before sharing it.

To check that the downloaded packet has not changed accidentally, run from a source checkout:

```text
pnpm run evidence:verify -- /path/to/task-123-evidence.json
```

On Windows, use a full Windows path. A valid packet prints `Evidence packet checksum and shape: valid` and exits with code zero. An invalid or edited packet exits nonzero. The SHA-256 value is stored inside the file, so someone who can edit the file can also recompute it. **This is a checksum, not a signature or proof of authorship.** A recorded stage or completed status also does not prove the underlying work succeeded. Confirm the final artifact and any external effect separately.

No model request or paid service is used to create or verify a packet. The file is prepared in the operator's browser and verified locally. The export has a stable `agentic-company-os/evidence-window@1` schema for downstream tooling.
