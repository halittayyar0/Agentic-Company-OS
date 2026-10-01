# Resume budget-paused work

## Intent and current evidence

The operator should understand why work paused and continue it after its
allowance becomes available, without editing database rows or recreating a job.
Shared family admission is implemented and locally verified. The current task
page only has a question-answer resume form; a budget block has no equivalent
control. The shared spend change stays unreleased until this gap is closed.

This extends the existing authenticated task, durable request, runtime-control
and uncertain-response flows. User instructions authorize routine design and
implementation decisions; paid services and credentials remain excluded.

## Chosen flow

Show a compact budget-paused section below the project brief, with the recorded
reason and a **Check allowance and resume** action. Checking must not spend model
tokens, change an allowance or reset usage. Keep the existing reason when the
allowance is still exhausted. Explain that an operator may need to change the
configured limits or wait for the rolling window; resuming does not grant a
fresh allowance. A root-oriented action should make eligible budget-paused work
in that family usable without requiring the operator to find every descendant.

Only authenticated operator intent can request the transition. It cannot reopen
completed/cancelled work, other block reasons, inactive owners, leased tasks or
uncertain physical operations. Existing emergency-stop checks stay authoritative.
Each affected task must pass both its individual and family admission checks.
Tasks still exhausted remain blocked and are counted in the compact result.

## Durable request and result

Use a saved UUID request identity and an immutable database receipt committed
with the accepted queue transitions. Bind it to the selected task/root scope;
reuse under a different scope conflicts. Identical accepted replay returns the
original result and never queues another model turn. Provide a task-scoped GET
receipt lookup for uncertain responses. Do not reuse question-answer receipts:
their identity and exact question binding serve a different action.

The result records the root ID, accepted time, affected task IDs and counts of
queued/still-paused work. Exclude provider keys, briefs, arguments, raw output
and arbitrary error objects. Keep stored results bounded and validate them on
read. The original recorded counters and usage events remain unchanged.

The browser saves the UUID before POST. If saving fails, it sends nothing. An
uncertain response switches to receipt inspection and preserves that identity
through navigation/reload. Do not automatically repeat POST. A missing receipt
permits a clearly offered retry with the same identity; a successful receipt
updates/refetches the selected task and family state. Maintain keyboard focus,
phone widths, RTL, light/dark and seven selected-language packs.

## Implementation sequence and acceptance

1. Add a transaction-compatible spend-reader client so queue admission reads
   the locked candidate graph and ledger inside the mutation transaction.
2. Add the bounded budget-resume receipt schema and checked-in migration.
3. Implement authenticated POST and GET routes with control/row locks, request
   binding, eligible budget-only transitions and localized result/error copy.
4. Add OpenAPI definitions, regenerate clients/validators and verify no remaining
   generation diff. Do not allow arbitrary task status changes through this flow.
5. Add the recoverable UI control and selected-language instructions. Measure
   its transfer, keep existing budgets and load recovery code only when needed.
6. Verify spent allowance, rolling-window renewal, retained usage, mixed block
   reasons, inactive owners, leases, emergency stop, cancellation races,
   concurrent replay, cross-scope reuse, lost acknowledgement/reload, failed
   storage, seven languages and phone/RTL/keyboard rendering. Use real native
   PostgreSQL for transaction/replay acceptance as well as local tests.
7. Synchronize with checked PR #35; only then set the final candidate version
   and release record. Run generation, format, audit/licenses, relevant/full
   source, build/type, full UI and all native/container/security gates.
8. Merge the passing source, compare source trees, build the immutable image,
   prove published-image installation/resume/restore, package and anonymously
   verify the installer/tag/checksum and AMD64/ARM64 image before release.

This design does not introduce account billing guarantees or automatic spend
permission. Independent real-phone, native-speaker and 24-hour acceptance are
still required for claims at those scopes.
