# Completion review inspector checkpoint

The existing activity inspector omitted the newly stored completion snapshot.
A regression test first failed because a failed command's exit code never
reached the projected activity. The inspector now displays a bounded typed
review basis inside the existing keyboard-operated activity disclosure.

## User benefit and boundaries

All seven application languages describe full state counts, sampled operations
and children, the reviewed cycle, approved effects, operator reconciliation and
sample limits. Counts include records outside the short samples. The display
describes recorded review context, not live status or output quality assurance.
No additional model call, network request, permission or backend write is added.

The projection rejects other tasks, unknown source markers, invalid counters,
duplicate count groups and samples that contradict the counts. A second
regression caught contradictory sample states before the guard was added.
Only explicit typed fields cross into display and ordinary activity JSON;
commands, tool arguments, raw output, child reports and arbitrary nested data
are excluded. The shareable evidence schema remains unchanged.

## Local evidence

- Fifteen focused projection, trace and language-contract tests passed.
- The final complete 25-case trace browser suite passed, covering all seven
  languages, 320/390-pixel phone widths, light/dark appearance, keyboard
  disclosure, stale/failed requests, language asset recovery and export privacy.
  English and Arabic also exercised desktop width and 200 percent text sizing.
- The final run includes the sample/count consistency guard and verifies that
  the review panel's asset is not requested until a record is expanded. An
  aborted panel download first failed acceptance; the final loader retains
  activity controls and recovers with a fresh document load.
- Final frontend typecheck, production build and bundle budget passed. The
  first build exceeded the existing total budget. Two bounded assets and
  selected trace-pack growth now have a separate 10 KB raw / 4 KB gzip feature
  cap, including 500 raw / 250 gzip bytes for route integration. All earlier
  base, total, language-family, single-asset and media ceilings remain fixed.
  Measured feature transfer is 9.2 KiB raw / 3.2 KiB gzip. Its trace-pack baseline
  comes from passing PR #32 job 110097988903; the 0.3.8 parent has identical
  trace-pack sources. Repository formatting and diff checks passed.

## Publication gate

This change is a local candidate atop PR #33's combined 0.3.8 source. It is not
published or merged. Submit it after that parent passes and is released, then
require the complete source/UI, security and platform gates on its final source.
The 25-case run does not establish physical-phone acceptance,
native-speaker review or a real 24-hour soak. Issues #29 and #34 remain open.
