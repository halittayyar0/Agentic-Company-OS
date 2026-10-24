# Recover an authorized tool schema after a rejected proposal

The held meeting-note probe on candidate c702102 showed three proposals for an
optional file tool before its schema was loaded. All three were correctly
blocked. A later explicit schema load enabled the real file read. The overall
probe still failed to complete its requested outcome; this change must not be
described as fixing general model quality or task-scope fidelity.

Keep PR80 and its automatic delivery workspace unchanged. Implement here on the
same source tree; rebase onto verified main before integration.

1. Write and run failing catalog and task-step regressions. After rejecting a
   known authorized but unadvertised optional tool, expose its original schema
   on the next request without another explicit model discovery call. Preserve
   same-response rejection, all usage, the original task and lease boundaries.
2. Add bounded catalog recovery. Only the already authorized map may supply
   schemas; preserve selected schemas and the eight-optional-tool ceiling.
   Unknown tools, full catalogs and exclusive task allowlists remain closed.
3. Localize the recovery explanation in all seven languages and retain a durable
   audit flag distinguishing a rejected action from next-request schema recovery.
   Do not change permissions, execute the rejected arguments, or count schema
   discovery as task progress.
4. Run focused source/security/type/format checks. Then run a fresh owned native
   file-to-actions task with full original request/response capture, unchanged
   local inference and strict fact/scope/completion checks. Preserve failures;
   no claim that a model proposal or file read alone completes a task.
5. Document observed benefit and limits, update the exact source census only for
   genuinely added tests, and review the diff. Push a separate PR. Merge only
   after original required checks and after PR80 delivery is resolved; verify
   actual-main packages and public readback through the ordinary release path.

No paid services, new agents, user authentication, public secrets or unrelated
working-tree changes are authorized by this implementation.
