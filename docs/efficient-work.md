# Efficient autonomous work

## From a brief to a useful result

Home and New project check the model catalog while you write. If this check fails, choose **Check again** to retry in place and keep your draft, or open **Connections** to review the setup. A failed refresh is shown even if an older catalog listed an available model. If no tool-capable model is configured, you can still submit a project to save it; model work needs a usable connection. The catalog check does not run a model prompt and does not prove a future call will succeed. Leaving or reloading an unsent form can still discard its draft.

After a focused retry, focus returns to the retry action if the check fails, the connection link if setup is needed, or the job draft if a usable model is listed. Choosing another field while the check runs keeps your chosen focus.

Home's default **Get it done** approach starts with a suitable existing agent. The product-building approach follows the same rule: complete small work with the current agent and bring in existing experts only for independent deliverables or necessary specialist work. Both approaches still require appropriate checks and a handoff of the result, evidence and remaining gaps. Choosing an approach does not change permissions, provider settings or spending limits.

The project's saved delivery summary is visible above the workspace in every view. **Review evidence** opens recorded activity and checks while preserving the project's other URL parameters. Recurring work shows the latest saved delivery; a saved summary does not mean the recurring responsibility has ended. Switching a completed one-off job to recurring work retains the previous delivery until a new one is saved. The interface does not infer a summary's cycle from the current work mode or an older cycle timestamp. A completed task with no recorded summary says so explicitly.

Summary text is the agent's saved report. It does not automatically establish independent verification. The conservative Markdown renderer displays raw HTML as text and excludes unsafe link schemes.

Small jobs start with the normal execution model. A task with repeated failures,
or a finite task with several steps and little progress, can use a stronger route.
An explicit model selection is preserved; a free selection never falls back to a paid model.

Task execution sends a small initial tool set. Other authorized tool schemas are
loaded on demand, at most eight at a time. Loading a schema grants no permission.
Skills are read when needed. Exclusive tool restrictions still take priority.

Parents wait without model calls while their finite children are active. By default,
a task family has at most four active tasks, including the parent, and 32 creations
per finite job or recurring cycle. Automatic hiring allows four active direct reports.
These limits are checked under the shared runtime control lock.

Recurring work runs once per scheduled cycle and sleeps between cycles. Admission
checks use current-cycle usage and a rolling 24-hour window, including review calls.
Defaults are 100,000 tokens / $1 reported cost per task or cycle, and 250,000 tokens /
$5 reported cost per recurring task over 24 hours. These are admission limits, not
a provider billing cap: in-flight calls may overshoot and missing cost is unknown.
The parent and all descendants also share 250,000 tokens / $3 reported cost per
finite job or recurring root cycle. Recurring families share 500,000 tokens / $8
reported cost over a rolling 24 hours. Execution, fallback and completion-review
admission use the same durable family ledger. A subtask cannot obtain a fresh
family allowance by delegating again. Each task's existing limits still apply.

On exhaustion, the affected task remains blocked with a reason identifying the
root job and shared limit. It is not marked complete. Finite budgets do not reset
when a task is resumed; after raising a limit, resume the blocked tasks. A recurring
cycle resets only when its root completes that cycle; rolling-day usage still
applies. Old lifetime counters do not stand in for current recurring-cycle spend.
Unknown provider cost remains unknown, and recorded token usage still counts.

These controls check recorded usage before each request; concurrent or in-flight
requests may overshoot. They do not reserve provider funds, cancel existing calls
or impose an account-wide wallet cap. Configure provider-side limits too.

Environment overrides: `MAX_TASK_FAMILY_ACTIVE`, `MAX_TASK_FAMILY_TOTAL`,
`MAX_AUTOMATIC_DIRECT_REPORTS`, `MAX_TASK_TOKENS`, `MAX_TASK_REPORTED_COST_USD`,
`MAX_RECURRING_DAILY_TOKENS`, `MAX_RECURRING_DAILY_REPORTED_COST_USD`,
`MAX_TASK_FAMILY_TOKENS`, `MAX_TASK_FAMILY_REPORTED_COST_USD`,
`MAX_RECURRING_FAMILY_DAILY_TOKENS`, `MAX_RECURRING_FAMILY_DAILY_REPORTED_COST_USD`.

## Resume after a usage pause

Open the paused project's page and choose **Check allowance and resume**. The
check makes no model request and does not increase an allowance or reset usage.
It queues eligible budget-paused tasks in that project family together; tasks
with exhausted individual limits, inactive owners, leases or unfinished actions
stay paused. Completed/cancelled tasks and other block reasons are not reopened.
The result reports how many tasks were queued and how many budget-paused tasks
remain. This action supports families of up to 1,000 stored tasks; larger
families are rejected as a whole, with no partial transition.

If the allowance is still exhausted:

1. Read the recorded reason to identify the task, family or rolling daily limit.
2. Wait for a rolling daily window to renew, or deliberately raise the named
   limit. For portable containers, use the installation directory's private
   `compose.env`; source installations use their environment configuration.
3. Restart the API and workers using the existing installation launcher so the
   changed environment is read. For a source Compose installation, run
   `docker compose up -d app worker-1 worker-2` from the checkout. Keep the existing database.
4. Choose **Check allowance and resume** again. Finite lifetime usage and current
   recurring-cycle usage are retained. Waiting alone does not reset a finite cap.

If the connection drops, choose **Inspect receipt**. Reloading keeps the pending
request in that browser tab. Inspection never sends it again. A missing receipt
does not prove that an in-flight request cannot finish; the offered **Retry the
same request** reuses its identity safely. After a confirmed rejection, another
explicit allowance check creates a fresh identity. If browser storage is
unavailable, nothing is sent until recovery details can be saved.

If only some family work resumed, the selected paused task keeps its check
available. A later budget pause on the same open page also permits a fresh
explicit check; the historical receipt never grants a new allowance.

The control does not grant permission for paid tools or other approved actions.
Resumed work can make the model calls already allowed by the installation, so
keep provider-side spend limits as well as these recorded-usage controls.

## Installation choices

The portable setup bundle requires Node.js 24 and a running Docker engine. It pulls
the release image by immutable digest and opens the same seven-language local
wizard as the source installation. Keep the extracted directory to resume.
Native installation remains available from source with Node, pnpm and PostgreSQL.
Each installation is for one operator. The public start page does not expose an
operator's tools, keys or computer. Phone access uses the existing private HTTPS
setup described in [mobile access](mobile-access.md).

Real-model availability and rate limits depend on the configured provider. A review
outage cannot certify work as complete; the scheduler backs off before retrying.
