# Complete acceptance within the existing CI boundaries

The original PR candidate `33c5d901bdce57f09867db25fda2fff97b28d87c`
did not qualify. Linux job `120644894919` exceeded its original 75-minute
deadline during the UI suite. It started case 1,385 of 1,465; these indices
are not passed counts. Four already-started cases also failed because two
Playwright specs dynamically imported frontend TypeScript modules and the
Linux transform emitted CommonJS `exports` into an ES module context.

Preserve that failure. The ordinary merge and qualification waiters were
stopped before any merge, and PR 81 returned to draft. The original Windows
runtime job may continue; it must not be represented as stopped or passing
without a fresh job read. No original producer will be rerun.

## Decision

Use static copy-loader imports in the two affected specs, matching the
existing test modules. Keep their browser assertions, downloads, locales and
case counts. A repository-wide module-system change is unnecessary.

Move the existing Linux reusable-guide native acceptance command and its
separate evidence upload from the 75-minute source/UI job into the existing
25-minute local-model-preparation job. That job already installs PostgreSQL
and a browser and previously completed in about nine minutes. The guide
acceptance took about eight minutes. Run them sequentially, preserving the
separate artifact names and collecting model-preparation evidence before
the guide fixture creates additional native-installation directories.
This moves work onto an already allocated runner; it does not create a new
job, omit coverage or enlarge a deadline. The UI job gains that time.

The release verifier must bind the preparation/guide producer to the same
original CI run, candidate, attempt-one checkout and successful mandatory
steps. Missing, duplicate, skipped, failed, unbound or restarted evidence
must reject both PR and main qualification. A green unrelated job must not
replace the required proof.

## Constraints

- Keep Linux source/UI timeout 75 minutes, preparation timeout 25 minutes,
  Windows runtime timeout 90 minutes, all Mac/native timeouts, and two UI
  workers unchanged. Keep retries zero and all 1,465 UI cases.
- Preserve source skip sets. Increase source census only by reviewed new
  release-verifier regression cases; never lower a floor.
- Preserve all required Actions contexts, security checks, native/archive,
  exact-main and public-delivery gates. No admin/force merge or producer rerun.
- No application behavior, database schema, package dependency or locale
  changes are required for this recovery.
- Keep accepted development-model proofs under their original `33c5d901`
  identities. Do not relabel them as a new head or an actual-main archive.
  Actual-main archive/model/browser verification remains required.

The user delegated routine implementation choices in Goal 7, so this scoped
recovery proceeds without another design approval request.
