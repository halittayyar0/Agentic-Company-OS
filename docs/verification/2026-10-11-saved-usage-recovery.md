# Recover saved usage without repeating work

## User benefit

An operator can apply trusted usage evidence that arrived after an interrupted
model call. Accounting is corrected without another inference or automatic task
restart. An eligible task can then be resumed through its separate explicit retry
action. Missing evidence continues to pause new calls.

## Contract and authority

- The authenticated POST binds the task or agent scope and exact inference UUID.
  It accepts only `acknowledge: true`, never user-supplied token totals.
- The transaction locks the attempt and rechecks its current scope, original
  receipt and invocation-bound saved response. Conflicting evidence retains its
  durable accounting fence. An availability hint does not authorize execution.
- Concurrent application writes one correction. The original usage receipt,
  task, leases, budgets and effect receipts are preserved. Reapplying the same
  already-accounted record is idempotent within the observed scope.
- Accounting-blocked task retry requires clear accounting and the existing
  runtime, lease, owner, cycle, approval and spend admission checks. An accepted
  retry retains the original logical execution and previous effect receipts.
- Lost or foreign acknowledgements show uncertainty. A verified readback of clear
  accounting refreshes retry eligibility, without another automatic POST.
- Turkish, English, German, Russian, both Chinese variants and Arabic include
  authored action and recovery text. The private locale tuple has named entries;
  selected-language lazy loading remains intact. Action labels are short enough
  to remain readable with large text on narrow screens.

## Passed checks

The tested runtime source contained 2,100 public files, fingerprint
`8d9eb37965dc2b4e943f266a5d7e1d43d78015a264131b134354f61c2b237a34`.
Documentation was added afterward; it does not replace runtime qualification.

| Check                              | Measured result                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disposable native PostgreSQL 17.10 | 36 tests passed across five complete modules; no failures or skips; owned service stopped                                                                |
| Current production preview         | 36 browser tests passed; no retries, flakes, failures or skips                                                                                           |
| Languages and layout               | Seven languages, 320px phone and 1280px desktop; recovery buttons at 200% text and at least 44px height; Arabic keyboard disclosure and light appearance |
| Recovery uncertainty               | English and Arabic lost and foreign acknowledgements; one usage POST, explicit separate retry, no automatic resend                                       |
| Build                              | Full formatting, workspace typechecks, production build and original bundle checker passed                                                               |
| Usage feature budget               | 7,960 raw / 3,306 gzip bytes; seven language packs total 7,671 raw / 3,894 gzip bytes; existing ceilings unchanged                                       |

The native database source fingerprint was
`3a89f1a7fae8c7320577835ab8548e71d756ee4a327fc0fcf8eed2ce0a189275`.
An exact source comparison confirmed that all backend, database, provider and API
contract bytes remain identical to that tested source. Subsequent changes were
confined to the browser implementation, language data and browser tests. English
and Arabic large-text recovery screenshots were inspected; shortened Arabic
action text no longer splits the long usage word inside the button.

Earlier failures remain recorded: the missing availability hint and POST route,
accounting retry eligibility, stale retry UI after lost acknowledgement, package
size overruns, two test typing errors, and disposable database fixture isolation
mistakes. The first lost-ack UI assertion incorrectly expected a disabled button
where the current UI hides an ineligible action; the corrected test reproduced
the stale action after verified accounting readback before the fix. These failed
runs are not release acceptance. Security and generated-file inventories are
recorded separately against the final source.

## Remaining limits

The latest real CPU-model task still failed: Ollama rejected malformed generated
tool XML and returned no usage. This feature cannot fabricate the missing receipt
or make that job successful. Original model, task and 20s readiness / 120s inference
/ 180s task deadlines remain unchanged in that retained experiment.

These checks use controlled browser fixtures and owned local databases. They do
not prove physical-phone behavior, real ChatGPT sign-in and plan allowance,
complete current source/UI coverage, all native platforms or a 24-hour run.
Corrupt response-retry browser storage still lacks a repair action, and its storage
error copy needs a dedicated message. Current full CI and release requirements
must pass before main-branch integration or a stable-release claim. Prior green
checks on an older commit cannot qualify this source.

Next: qualify the current full source and platform gates, repair retry-storage
recovery, and obtain a reproducible first useful result with genuine model usage
and review evidence. Human account authentication remains a separate requirement.
