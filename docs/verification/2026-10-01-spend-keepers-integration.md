# Spend controls and Living Keepers integration

The pending v0.3.11 candidate combines PR #37's family-spend controls and
physical invocation ownership evidence with the merged Living Keepers source.
The mascot main commit is `f9de129958d7b4d20369ae87f671905de5f5220e`, source
tree `329ee774859f24893fe1134b26f00ffcc3f8d4f2`. Pending runtime changes before
this merge were `f2722e92f82e6c35da87fccdb7bc959f6229e1c6`.

## Conflict resolutions

- Root package version stays 0.3.11. Family-spend and endurance changes are
  consolidated under 0.3.11. The published 0.3.10-and-earlier changelog remains
  intact.
- Both feature caps remain fixed. Keeper measurement includes shared entry,
  CSS, expert profile and UI controls against the clean v0.3.9 build. The
  additional growth in those same assets since the merged mascot tree is
  removed from budget resume's bounded integration allowance before applying
  any base or total transfer credits. Shared growth is never exempted twice.
- The measured overlap is 379 raw / 73 level-9 gzip bytes. Independent review
  checked the built assets and all three affected global comparisons.
  Existing base, total, asset, language-family and media ceilings are unchanged.

## Local acceptance

- Monorepo build and typechecks passed on the combined tree.
- Scripts typecheck, formatting of conflict resolutions and diff checks passed
  after the bundle accounting adjustment.
- Combined production bundle passed: budget recovery is 11.6 KiB raw / 4.1 KiB
  gzip within its 13 KB / 4.5 KB cap; Keeper integration is 8.8 KiB raw / 3.3 KiB
  gzip within its 10 KB / 4 KB cap. Media is 149.8 KiB.
- 49 of 49 focused Chromium checks passed in 1.8 minutes: Living Keepers,
  task resume and runtime status locales. Coverage includes seven languages,
  phone layouts, keyboard chat focus, unchanged drafts, motion controls,
  uncertain acknowledgements, budget checks and pending request recovery.
- Independent conflict-resolution review found no actionable issue.

## Scope limits

These local checks are not a full repository rerun. This exact combined commit
must pass GitHub platform, source, browser, container and security checks before
merging. Portable distribution acceptance is separate.

The independently accepted ten-minute native proof belongs only to
`d2632703dbd910d569c7b4837e124eabb9df10c0`; it does not certify this integrated
source. Physical invocation ownership requires matching runtime evidence.
No real 24-hour acceptance is claimed. Phone-width Chromium checks are not
physical-phone acceptance, and translated guidance is not native-speaker review.
