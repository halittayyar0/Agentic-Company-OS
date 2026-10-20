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

# Reviewed archive and actual GUI qualification

The later reviewed candidate `46a168460e084f0fcdcc11bcd0adfda37e85a14c`
was built from a clean checkout and extracted from its new Windows ZIP. Its
SHA-256 was `6616ab5b9b3ff00ff7b2e45655fb16c59576549527723fa7de73a2eb5cfa7b00`.
This is candidate evidence; it is not a published exact-main release claim.

A separately extracted public v0.5.5 archive completed a new genuine Qwen
`qwen3.5:2b-q4_K_M` task: calculate 58.5 + 14.5 and report 73 EUR. The actual
calculator arguments and returned runtime result were observed in the unmodified
model exchange. It used three model calls, no fallback, no new agents and no
remote provider requests. Restart and database backup/restore checks passed.

The reviewed candidate's shipped START check passed with developer tools removed
from PATH. Its real browser upgrade screen found this predecessor, displayed
0.5.5 → 0.5.6 and the correct data folder, then completed migration and startup.
The original database backup matched its full pre-upgrade inventory. The earlier
real task, preferences, provider connection, private keys, workspace files and
custom token limits were retained. The API and two scheduler workers were healthy,
with work durably paused. A normal restart passed.

After signing into that actual workspace and explicitly confirming **Resume
work** in its dialog, a new task, ID 2, completed through the same preserved local
connection. Qwen again called calculate and complete_task; three genuine model
calls used 7,858 reported tokens, with no fallback, new agents or remote provider
requests. The new result survived another normal restart. The package, database,
owned local-model runtime and loopback relay stopped cleanly. Model weights and
runtime files were checked against their retained SHA-256 provenance.

Visual inspection of the real success screen also found an obsolete instruction
to use the old START file. That instruction is now limited to an unstarted,
non-critical review; recovery, running and completed updates hide it. Nineteen
installer/browser tests passed after this copy-state correction. These later UI
bytes must be included in the final package and CI qualification.

The repaired migration entrypoint's checked-connection and parent-lifetime
transport tests are described in the companion
[UI and review verification](native-upgrade-ui-2026-10-20.md). Forced parent loss
with a pending database connection, final exact-main artifacts and public readback
remain separate gates. Native packages are unsigned; these checks do not certify
physical devices or a 24-hour run.
