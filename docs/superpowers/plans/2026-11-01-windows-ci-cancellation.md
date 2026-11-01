# Release obsolete Windows CI without weakening acceptance

PR97 CI run41287251108 remains pending behind obsolete run41284887159, whose Windows runtime job continues after its source checks have already failed. The job-level `always()` condition prevents cancellation from releasing that workflow's concurrency slot. GitHub documents this cancellation behavior: <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation>.

Change only that job's condition to `!cancelled()`. Keep its installation dependency and unconditional first installation-result guard: only `success` permits workloads; failed, cancelled, skipped, empty or unknown dependency results still fail the guard if it runs. Keep artifact preservation, deadlines, source census3121, original skip lists, UI counts, workers and zero retries unchanged.

The existing producer regression now requires the cancellation-aware condition and executes the real first guard for all six dependency results. Before the workflow correction it reports26 tests,25 passed and one failed at the old condition. Re-run after correction, inspect the YAML and review the exact diff before committing.

Preserve the obsolete original source failures and their logs. After publishing the real correction, request normal cancellation only for obsolete run41284887159. If it remains unresponsive because of `always()`, use the documented force-cancel endpoint for that same obsolete run: <https://docs.github.com/en/rest/actions/workflow-runs#force-cancel-a-workflow-run>. Record the result; never rerun it, delete it or count cancellation as acceptance. The new head must pass its own complete original checks before ordinary protected integration and fresh actual-main release qualification.

This change fixes cancellation responsiveness. The older intermittent Windows private-helper startup timeout remains unexplained; its timeout and security checks are unchanged.
