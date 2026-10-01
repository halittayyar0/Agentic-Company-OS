# How task completion is reviewed

Before an agent finishes a task or a recurring cycle, the existing economical
review model compares the task brief and completion report. It also receives a
short snapshot of the recorded work for that task and cycle.

| Recorded information                             | How it helps                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Tool name, execution state and command exit code | A failed operation can contradict a claim that every check passed.            |
| Approved action versus approval request          | Asking permission does not establish that the action ran.                     |
| Operator reconciliation decision                 | A recovered uncertain outcome remains distinguishable from automatic success. |
| Child task states                                | Failed or unfinished delegated work is visible to the reviewer.               |
| Full state counts and truncation flags           | A short sample cannot hide that additional failed records exist.              |

The snapshot includes up to 12 recent operation receipts and eight child tasks,
plus counts across the scoped records. Task-step receipts use the durable attempt's
cycle number. Approved effects and child tasks use the current cycle boundary.
Earlier cycles, unrelated tasks, chat operations and the completion request itself
are excluded. Counts and samples come from one read-only database snapshot.

No extra model call is added. The selected review route, free/local boundaries,
usage accounting, ownership checks and existing approval rules still apply.
The existing activity review retains the same snapshot for later inspection.

## Privacy and limits

The additional snapshot excludes commands, arguments, URLs, raw output, file
contents, task text, child reports and saved error messages. Only selected typed
result fields are included. The task brief and agent's proposed report continue
to be sent to the configured reviewer as before. A cloud reviewer therefore still
receives those texts; choose a local model if they must stay on your machine.

Execution metadata does not establish file quality, complete test coverage,
delivery to an external recipient or that every possible task requirement was
met. Text-only tasks do not require artificial tool use. A failed attempt can be
followed by a successful retry; the reviewer is instructed to consider recovery
and disclose missing coverage. Its verdict remains model-dependent.

An unavailable or malformed completion review blocks completion. Local acceptance
uses a controlled reviewer and proves evidence delivery, isolation and existing
verdict handling; it does not certify every live model's judgment.
