# Local connection readiness repair

Continue PR #80 inline under the operator's autonomous development and publication
authorization. Preserve the dirty primary checkout and all original failed runs.

## Evidence and scope

Candidate `2dcf668` was rejected by original Linux preparation and macOS ARM
first-job acceptance: the saved address read back as the default port instead of
the entered owned-peer port. The exact cause of those original failures remains
unconfirmed. Both original logs are retained privately with their job identities.

A separate deterministic browser regression holds the real lazy preparation
module. It demonstrates that the address is editable before preparation discovery
starts, then can be disabled by that first pending read. Keep the existing visual
design, locale strings, backend revision fencing and preparation authority.

## Implementation and checks

1. RED: hold the real preparation module; assert the address stays disabled until
   the existing preparation read completes. Release the gate in a finally block.
2. Start the local form in its existing preparation-busy state. The preparation
   owner releases it after discovery; API-key connection remains independent.
   Failed module/copy loading retains the existing visible reload recovery.
3. GREEN: verify module and snapshot loading, known active and unknown transfers,
   readiness errors, address editing and exact save payload on phone widths.
4. Extend native acceptance to assert the actual submitted address. Run the real
   PostgreSQL/API/two-worker journey, all seven languages and interrupted recovery.
   Do not infer resolution of the original failure until those original gates pass
   on a fresh candidate. Do not raise timeouts or relax assertions or security.
5. Run relevant source/UI, full build, unchanged bundle budgets, format and audit.
   Review, commit and push the repaired PR; require original cross-platform checks
   and strict release verification before merge. Verify actual-main and public
   artifacts before any release claim. Record remaining acceptance separately.
