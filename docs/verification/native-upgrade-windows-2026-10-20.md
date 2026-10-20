# Native upgrade qualification: Windows milestone

This records a Windows development milestone for the upcoming 0.5.6 upgrade
flow. It is not a release qualification or a cross-platform certification.

## Source and scope

- Predecessor: public v0.5.5, commit
  `8946dea16eeb314e66b078995b98d0e43a631fdc`.
- Target: a clean native build of commit
  `d1722debcb532a4a0dc2fae7c517c089d46d7370`, with 2,288 inventoried files,
  bundled Node 24.21.0 and PostgreSQL 17.10.
- Completed: 2026-10-20 at 15:40 UTC.
- The predecessor instance already contained a completed real local-model task
  whose arithmetic result was 73. This experiment did not run a new model task.
- The experiment used the native builder's output directory. Extraction and
  public readback of the final release archives remain release gates.

## Observed results

| Check                                                                        | Result                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Full build and type checks                                                   | Passed                                                |
| Combined upgrade, installer, migration and session tests                     | 124 passed; no failures or skips                      |
| Copied database verification                                                 | 47 public tables and 12 sequences checked             |
| Interruption after guarding metadata, before retaining the original database | Recovered                                             |
| Old launcher during interruption                                             | Refused the changed package identity                  |
| New normal launcher during interruption                                      | Refused the incomplete upgrade journal                |
| Recovery to application startup                                              | Same live installation lease handed to the executor   |
| Application topology                                                         | One healthy API and two healthy scheduler workers     |
| Durable execution pause                                                      | Enabled after upgrade and still enabled after restart |
| Existing local-model result                                                  | Result 73 retained                                    |
| Original database backup and metadata/pointer backups                        | Exact original bytes retained                         |
| Secret files and existing workspace files                                    | Unchanged                                             |
| Installation settings and custom token-budget overrides                      | Retained                                              |
| Database write accepted after upgrade                                        | Survived completed recovery and normal restart        |
| Final shutdown                                                               | Owned application and database processes stopped      |

The unit failure suite also covers all 15 before/after promotion interruption
boundaries, changed package/data/receipt files, missing original data, migration
or shutdown failure, cancellation and preparation retry. Its coordinator fixtures
use simulated PostgreSQL commands with real filesystem transitions and leases;
the separate Windows experiment above uses actual bundled PostgreSQL and the API.

## Remaining release gates

- The guided upgrade screen, its seven translations, keyboard use and phone-width
  layouts.
- A new real local-model task after the final upgrade.
- Final Windows, macOS Intel/Apple Silicon and Linux x64/ARM64 package gates.
- Whole-branch review, required source/security/browser checks and exact-main
  packaging after merge.
- Final archive extraction, anonymous download/hash readback and published
  instructions.

Separate ordinary-user WSL/Linux lifecycle experiments showed that a direct
PostgreSQL child could survive a terminated parent; the staging IPC child closed
it cleanly. Forced Windows termination can leave an unclean staging copy even
when its processes are gone. Interrupted preparation therefore always requires
a new cold copy; retained partial migrations are never reused as a new baseline.
