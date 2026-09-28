# Question-bound answers and recovery — 2026-09-27

Goal 7 remains active. This checkpoint replaces the generic blocked-task answer form with a question-bound, seven-language flow and adds durable server receipts. It does not close the remaining release work.

## Implementation and review

- The API now exposes the actual recorded question and issuing owner. Both task execution paths assign a fresh UUID. Answers require that UUID and a permanent request UUID. Admission, owner, approvals and task locks protect the current-question check. An old request can recover its receipt but cannot answer a later question.
- The answer activity, task scheduling change and receipt commit in one transaction. A forced receipt-write failure proved rollback of both the answer and resumed state. Emergency stop rejects new intents while previously committed receipts remain readable/replayable.
- Migration 0022 upgrades only recorded, still-unanswered questions from the current owner. Missing questions are not inferred from a generic error. An invalid latest question never falls back to an older question, and a legacy record at the previous UTF-16 truncation boundary is left unanswerable, including supplementary Unicode characters. Receipt rows survive task deletion.
- The form uses React Hook Form and Zod with touched validation. Tab-local drafts retain the question snapshot and answer. An uncertain POST locks that intent; GET recovery never resends. A missing receipt permits an explicit retry with the identical identity and text. A changed question requires explicit review, preserving the draft.
- Apple HIG principles are applied to the web form: `entering-data.md > Best practices`, “Be clear about the data you need,” informs the visible recorded question; `text-fields.md > Best practices`, “Show a hint in a text field,” informs a persistent label plus placeholder; `feedback.md > Best practices`, “Consider integrating status feedback into your interface,” informs inline recovery next to the saved answer. These references were read during this pass. No native-platform UI convention is claimed.
- Turkish, English, German, Russian, both Chinese variants and Arabic cover the form, validation and recovery. English dark and Arabic light phone captures were visually reviewed. Controls wrap at 320–390px, have at least 44px height, and source text uses its own writing direction. Source questions and answers are not automatically translated.

## Verification

| Check                                 | Observed result                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Complete root test run                | 806 tests: 801 passed, zero failed, five skipped; 626.0 seconds                                                |
| Final affected runtime/API files      | 44 tests passed, including the new invalid-question boundary test and independent local fixture initialization |
| Final migration test                  | Passed after strengthening legacy truncation/Unicode and latest-invalid-question guards                        |
| Complete production Chromium suite    | 262 passed, zero failed; 9.1 minutes                                                                           |
| Workspace types and production builds | Passed; final API build and type check repeated after the input validation change                              |
| PGlite migration chain                | Passed; rerun after the legacy-question migration guard                                                        |
| Production dependency audit           | No known vulnerabilities reported; not a proof of absence of vulnerabilities                                   |
| Production license policy             | Passed                                                                                                         |
| Locale parity                         | Seven packs, 109 nonempty fields, matching interpolation slots                                                 |
| Bundle                                | 1229.0 KiB raw / 360.6 KiB gzip; passed the explicitly revised 372,000-byte cap                                |
| Formatting / whitespace               | Repository formatting and git diff whitespace checks passed; final report rechecked after updating             |

The full root run began before the last input-boundary test and migration refinement. The final affected runtime/API files and migration test were then run separately against those corrections; their counts are not added to the root total. This is staged verification, not a claim that one final combined verify invocation passed. The five skips are four native PostgreSQL connection/ownership/receipt/file-lock checks and one Windows symlink test denied with EPERM. None is counted as a pass. The final full browser run used the final UI build, including the bounded storage parser and send/check state labels.

API code generation completed after a transient file-lock retry; a subsequent regeneration left all 228 generated files byte-for-byte unchanged. English dark and Arabic light captures from the final full browser run were inspected again.

Earlier focused evidence: 48 API/database/runtime tests passed, then 14 Chromium answer-flow tests passed. The first server test run found a test-fixture setup error: two DDL commands were sent in one prepared statement. Splitting the statements let the intended rollback test execute and pass. A first type check found an optional owner dereference; it was corrected and the workspace build passed. A transient formatter file-open error was corrected by retry. A filtered runtime test exposed an existing dependency on an earlier test to initialize the local model fixture; the selected test now starts its own local fixture, and the complete affected runtime/API files subsequently passed all 44 tests. A regeneration attempt hit a Windows file lock while cleaning a generated Zod type; a retry completed successfully. This was not counted as a passing first invocation.

The original 368,000-byte aggregate gzip gate failed after this feature. Storage validation initially pulled in unused numeric/UUID validator implementation; replacing it with explicit bounded storage parsing removed that payload while preserving form Zod validation. Several chunk regroupings did not provide sufficient savings and were reverted. The remaining measured increase is about 1.3 KB relative to the previous checkpoint. The aggregate selected-language gzip allowance is explicitly revised to 372,000 bytes for the new question/receipt flow; raw, per-asset and aggregate locale-pack ceilings remain unchanged. This is a budget revision, not a claim that the old limit passed.

Local evidence: `%TEMP%/acos-task-answer-root.log`, `acos-task-answer-full-ui.log`, `acos-task-answer-final-runtime.log`, `acos-task-answer-final-migration-test.log`, `acos-task-answer-final-types.log`, `acos-task-answer-final-build.log`, `acos-task-answer-final-api-build.log`, `acos-task-answer-final-migrate.log`, `acos-task-answer-audit.log`, `acos-task-answer-licenses.log`, `acos-task-answer-final-bundle.log`, `acos-task-answer-copy-parity.json`, `acos-task-answer-codegen-stability.json`, `acos-task-answer-final-format.log` and `test-results/task-answer-full-ui/`. These temporary/ignored files are local evidence, not portable release attestations.

## Remaining goal work

Project meetings, detailed run trace, delegation conversation and Operations still need their remaining localization/design work. The `?view=operations` workbench entry, other API/provider messages, authored playbooks and durable Browser/Terminal operator receipts remain outstanding. The project-stop marker remains local and must not be described as a server receipt.

Native PostgreSQL, Docker, physical-phone/private-HTTPS, Safari, native IME, screen-reader, native-speaker, POSIX and real 24-hour checks are not established by these fixtures. No paid provider call, installation, commit or publication was performed. See [answer recovery](../task-answer-recovery.md) for the public contract and limitations.
