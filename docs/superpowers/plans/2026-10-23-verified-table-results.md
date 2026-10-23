# Verify an explicitly requested table before task completion

## Problem and decision

The genuine Qwen file task read the held notes and produced the correct facts,
but omitted the requested pipe-separated rows. Its model judge incorrectly
claimed the format matched. The independent test rejected the result. Exact
request replays reproduced the defect; replacing one task-mode sentence did not
resolve it. Do not weaken that test or infer output contracts from arbitrary
natural-language text.

Add an optional, explicit task result format: `{kind: "table", columns: string[]}`.
Plain text remains the default. The operator chooses the table and its headings;
the app previews the required header. This validates layout, not factual truth,
row completeness or external actions. No JSON mode or new agent is needed.

Keep PR80's frozen main/package delivery workspace unchanged. Work here while
the original PR81 candidate remains on GitHub; do not push another candidate
until the complete change is reviewable. Preserve original checks/failures.

## Contract

- Two to eight unique, nonempty, canonical heading strings, each at most 80
  UTF-16 code units. Reject extra fields, control characters, leading/trailing
  whitespace and malformed values. Column order is meaningful.
- A matching unfenced pipe table must contain the selected header, separator row
  and one to 200 data rows with the exact column count. Support ordinary optional
  outer pipes, escaped pipes/backslashes and CRLF. Require a blank line before a
  narrative footer, so malformed rows cannot silently become prose.
- Bound verification to 65,536 input characters. Do not execute or fetch anything,
  interpret source content as instructions, rewrite the result or store raw
  result text in new audit metadata. No new dependencies are required.
- Validation happens before lifecycle reservation or model review. A mismatch
  yields localized correction feedback, no completion, no review call and no
  progress credit. The existing bounded retry/backoff remains in control.
- Missing/legacy format keeps existing behavior. Preserve the existing task
  creation digest for legacy requests; a nonempty format receives a new identity
  version. Never let retries, reuse, scheduling or restart drop the chosen format.

## Implementation sequence

1. TDD the strict format parser and bounded table checker, including the exact
   failed bullet result, seven-script headings, malformed rows, escapes, fences,
   oversized data and unchanged legacy behavior.
2. Add a nullable `result_format` task column and migration/check. Extend OpenAPI,
   generated clients/validators and create/reuse/idempotency paths. Creation owns
   the immutable contract; delegation may specify a separate child contract but
   does not silently inherit a parent's layout.
3. Gate `complete_task` using the saved contract and actual proposed summary,
   before the judge. Include bounded contract data in task prompts. Keep leases,
   required tool evidence, receipts, accounting and approvals unchanged. Reject
   malformed non-string completion summaries explicitly.
4. Add a small optional result-format control to existing project creation and
   preparation/reuse. Preserve drafts and chosen headers across failures. Show
   the saved format near the result without claiming factual verification.
   Author seven language packs; retain Arabic RTL, LTR machine values and 44px
   controls. Follow existing DESIGN.md; no restyle.
5. Test API and database rejection, lost-ack retries, parameter conflicts, reuse,
   recurring cycles, restart and backup preservation. Verify that malformed
   results make no review/model request and cannot finish even if a fake judge
   would return pass. Verify real file reading separately from formatting.
6. Run the original held-note task with the same factual and scope checks and an
   explicitly selected matching table contract. Capture original real requests
   and responses; require all three correct owner/action/ISO-date rows and the
   unresolved launch decision. No paid provider, extra agents or external action.
   Preserve failures and do not call one passing sample general model quality.
7. Run seven-language phone, security, build/types, budgets, licenses and audit
   checks. Update only genuinely added test counts. Rewrite PR81 around the final
   change, push a fresh candidate and require its original checks. Do not merge
   ahead of unresolved PR80 delivery. Verify actual-main packages and public
   readback before release; leave the broader Goal active.
