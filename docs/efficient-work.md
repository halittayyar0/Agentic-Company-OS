# Efficient autonomous work

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
There is no shared family or account-wide wallet cap. Configure provider-side limits too.

Environment overrides: `MAX_TASK_FAMILY_ACTIVE`, `MAX_TASK_FAMILY_TOTAL`,
`MAX_AUTOMATIC_DIRECT_REPORTS`, `MAX_TASK_TOKENS`, `MAX_TASK_REPORTED_COST_USD`,
`MAX_RECURRING_DAILY_TOKENS`, `MAX_RECURRING_DAILY_REPORTED_COST_USD`.

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
