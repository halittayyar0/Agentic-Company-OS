# Preserve the private-storage import boundary and exact census

Original revised PR97 Intel job124784080568/run41284887035/attempt1 rejects head8efc33b with3121 tests:3078 passed, two failed,41 existing skips. The failures are deterministic compatibility omissions in the new diagnostic change, not evidence about the older Windows startup timeout:

1. The standalone diagnostic module appears in the migration-only bundle's exact source allowlist. The upgrade entrypoint must keep its existing narrow storage/database graph, without API, scheduler, provider or agent runtime imports.
2. `producers.test.ts` also reviews the exact source census. Its two3112 literals were missed when the nine real diagnostic cases raised the manifest to3121.

Both failures reproduce locally before correction. Preserve the original failed job/log; never count it as acceptance.

## Correction

- Keep the tracker in the already admitted `owner-private-storage.ts` module and remove the new standalone production module. Point its nine tests at that existing module. Preserve the tracker behavior, encoded protection script, original child arguments/environment/deadline/output bound and filesystem guards. Do not widen the migration import allowlist.
- Set both reviewed census assertions to the actual3121 cases. Retain exact passed/skip arithmetic, four source stages, all old skip lists,1488 Linux UI cases, two UI workers and zero retries. Do not add, remove or skip test cases for this compatibility repair.
- Run the two missed suites and the diagnostic cases together:39 passed, no skips after the correction. Then run relevant private-storage/handoff, type/build/format/security checks and inspect the final source graph before an ordinary corrective commit.

Head8efc33b is already rejected by its retained original source failures. A real corrective commit may supersede its remaining obsolete work through the existing workflow concurrency policy; any resulting cancellations stay visible and are not passing evidence. No workflow rerun or failure relabeling is permitted. The corrected head needs its own complete original PR and actual-main acceptance plus new final-source runtime/release qualification.

The intermittent Windows private-helper startup cause remains unproven. This correction fixes the two verified import/census integration omissions; it does not change or explain that older15-second failure.
