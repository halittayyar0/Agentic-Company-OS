# How task completion is reviewed

## Choose a result format

New projects default to **Free text**. To require a table, choose **Result format
→ Table** and edit two to eight different column headings. The preview shows
the exact order. Each heading accepts up to 80 UTF-16 code units; surrounding
spaces, control characters and duplicates are rejected. Incomplete edits stay
in the local draft and block starting until corrected. Choosing a format never
starts work or grants permissions.

The server saves this contract with the project. Before reserving completion
or asking the model judge, it checks the proposed result for an unfenced pipe
table with the exact headings, a separator row and one to 200 data rows of the
same width. Literal pipes and backslashes must be escaped. Separate following
prose with a blank line. Validation accepts CRLF and optional outer pipes, and
is bounded to 65,536 input characters. A mismatch returns corrective feedback
without a judge request or completion receipt. Existing step limits, usage
accounting, permissions and backoff still apply; repeated malformed results
cannot advance a regular-work cycle.

A matching saved result is displayed as a table with column headers and a
keyboard-focusable scroll region on narrow screens. Unselected or malformed
tables keep the existing text rendering; downloading preserves the saved text.

This verifies layout only. It does not prove that facts, dates, row completeness
or requested external effects are correct. Normal review still applies. The
format is visible on the saved project and persists through draft recovery,
exact submission retry, restart, backup and **Use brief again**. A different
format or column order conflicts with an existing submission identity. Personal
text guides contain instructions only. Delegated tasks default to free text;
an explicitly supplied child format is independent of the parent's contract.
Legacy tasks and requests without a format retain their previous behavior.

The chooser and saved layout are available in all seven supported languages.
Heading text stays in the language the operator entered. No paid service or
additional agent is required for the structure check.

## Choose completion conditions

When creating a project, expand **Completion conditions (Optional)** and choose
up to eight operations from the coordinator's current permitted tools. For
example, select **Calculate numbers** when the work must actually use the
calculator. Text-only work can leave this section empty.

These conditions are saved with the project and are included in the existing
agent context. They grant no permissions, activate no packs and perform no
operations. The agent cannot remove them. Before completion review starts, the
server checks exact persisted success for this task and cycle. Missing success
rejects completion without an additional model request or completion intent.
Terminal operations additionally require a recorded successful zero exit code.
Failed, pending, unknown or operator-reconciled outcomes do not satisfy a
condition. A Codex turn is not an eligible condition.

The project header shows current-cycle records and missing capabilities. If a
record cannot be refreshed, the panel does not keep advertising stale success.
Recurring work needs new success in every cycle. A successful tool call still
does not establish that its arguments or final answer meet the brief; the
ordinary semantic review remains necessary.

Selections survive draft reload and exact start recovery. If capability access
changes before admission, a request with a saved identity receives a persisted
permission rejection. Use **Prepare a new start**, review or remove the
condition, then explicitly start with a new identity. Retrying the rejected
identity cannot start work after permission changes. Requests without a recovery
identity return the existing unavailable-condition error without starting work.

**Use brief again** also prepares saved conditions for a new project, where they
can be reviewed before starting. Personal text guides preserve instructions
only; they do not silently add executable conditions.

The chooser and status panel are authored in English, Turkish, German, Russian,
Simplified Chinese, Traditional Chinese and Arabic. See the
[localized guide](completion-conditions-languages.md). This implementation does
not establish that a real local model reliably follows arbitrary briefs or that
ChatGPT account inference has been tested.

## Review the full result

Before an agent finishes a task or a recurring cycle, the existing economical
review model compares the task brief and completion report. It also receives a
short snapshot of the recorded work for that task and cycle.

| Recorded information                             | How it helps                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Tool name, execution state and command exit code | A failed operation can contradict a claim that every check passed.              |
| Approved action versus approval request          | Asking permission does not establish that the action ran.                       |
| Operator reconciliation decision                 | A recovered uncertain outcome remains distinguishable from automatic success.   |
| Child task states                                | Failed or unfinished delegated work is visible to the reviewer.                 |
| Full state counts and truncation flags           | A short sample cannot hide that additional failed records exist.                |
| Bounded calculator inputs and actual result      | The reviewer can compare the requested arithmetic with the operation's numbers. |

The snapshot includes up to 12 recent operation receipts and eight child tasks,
plus counts across the scoped records. Task-step receipts use the durable attempt's
cycle number. Approved effects and child tasks use the current cycle boundary.
Earlier cycles, unrelated tasks, chat operations and the completion request itself
are excluded. Counts and samples come from one read-only database snapshot.

No extra model call is added. The selected review route, free/local boundaries,
usage accounting, ownership checks and existing approval rules still apply.
The existing activity review retains the same snapshot for later inspection.

## Inspect the recorded review

Open the project's **Plan and trace** view and expand its review activity.
The **Review basis** section shows the reviewed cycle, full operation and child
task counts, sampled states, reported command exit codes and operator
reconciliation decisions. It distinguishes task operations from approved actions.
The labels follow the selected application language.
The additional panel downloads only when you expand a review. If that download
fails, activity controls stay available and a retry control reloads the page.

These are the records available at review time, not the task's current live
state. A count can exceed the short displayed sample; the section states how
many records are shown. Old activities without a stored snapshot do not acquire
invented counts. Invalid or inconsistent snapshots are not displayed.
An empty recorded snapshot explicitly allows text-only work without artificial
tool use.

The ordinary activity JSON export includes the same typed projection. Raw
commands, generic tool arguments/output and child reports remain excluded from this
projection. Successful bounded calculator calls deliberately include the numeric
inputs and result described below. Original activity summaries remain in that ordinary export, so
review it before sharing. The separate shareable evidence export retains its
existing narrow schema and does not include the review samples.

## Privacy and limits

### Bounded calculator evidence

For a successful built-in `calculate` task-step operation with at most **eight
finite numeric operands**, the runtime deliberately stores its operation, ordered
operands, actual result and `IEEE-754` arithmetic label in the receipt. Those
numbers also enter the existing completion review and its saved activity snapshot.
They can contain sensitive inputs; they are retained calculation data.

The producer compares the actual emitted result with an independent recomputation
and binds the operands to the receipt's argument hash. The reviewer snapshot
requires successful, unreconciled, read-only execution with valid timestamps and
the exact task/cycle/attempt, agent and logical execution identity. It validates
and recomputes the numeric projection again. It does not copy arbitrary saved
result objects, presentation text or extra metadata.

`bounded_calculation` establishes approximate arithmetic on supplied numbers. It
does not establish that quantities, prices, units, source data or the final report
are correct. Calls with more than eight operands still execute under the existing
calculator limit; this numeric evidence is omitted. The original twelve-receipt
sample still applies, so earlier calculations may also be absent. Old receipts
do not acquire invented values. The Review basis panel continues to show operation
metadata; the full saved activity JSON contains the retained numeric fields.

### Other review data

The additional snapshot excludes commands, generic arguments, URLs, raw output, file
contents, task text, child reports and saved error messages. Only selected typed
result fields are included. The task brief and agent's proposed report continue
to be sent to the configured reviewer as before. A cloud reviewer therefore still
receives those texts and any retained numeric calculation data; choose a local
model if they must stay on your machine. Protect the local database and backups
according to your retention needs.

Execution metadata does not establish file quality, complete test coverage,
delivery to an external recipient or that every possible task requirement was
met. Text-only tasks do not require artificial tool use. A failed attempt can be
followed by a successful retry; the reviewer is instructed to consider recovery
and disclose missing coverage. Its verdict remains model-dependent.

An unavailable or malformed completion review blocks completion. Local acceptance
uses a controlled reviewer and proves evidence delivery, isolation and existing
verdict handling; it does not certify every live model's judgment.
