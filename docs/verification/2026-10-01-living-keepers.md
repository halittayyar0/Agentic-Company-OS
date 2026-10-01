# Living Keepers checkpoint

This candidate starts from public main `12ccba9ea66c1f33802e11eb87618a2145a3de02`
(v0.3.9). It is isolated from the pending family-spend and endurance changes.

## User benefit

Ten original role mascots have colorful shells, gentle CSS body movement and
friendly profile guidance in English, Turkish, German, Russian, Arabic,
Simplified Chinese and Traditional Chinese. A keyboard-operated mascot or
conversation button opens the existing chat and focuses its input without
changing the draft or sending a message. The guidance is authored UI text;
it does not claim feelings or pretend to be a model response.

Idle, working and blocked states have different movement. Archived agents and
uncertain reads stay still and cannot open a new conversation from this card.
Uploaded images remain static. A global pause control persists locally and
synchronizes across tabs; unavailable browser storage still permits a change
in the current tab. System reduced-motion preferences take precedence.
Hidden documents and offscreen mascots pause their animations.

## Local evidence

- 108 of 108 browser tests passed in the final focused run: Living Keepers,
  expert profile locales, shell locale gates and access-surface text resizing.
  The suite covers seven languages, phone and desktop layouts, light and dark
  appearance, Arabic direction, keyboard chat focus, draft preservation,
  200 percent text sizing, custom portraits, failed reads, reduced motion,
  visibility, storage failure and cross-tab preference synchronization.
- A first regression failed because the existing avatar lacked the live state
  contract. Further runs caught a state-animation shorthand overriding the
  visibility pause and the new text control overflowing narrow screens at
  large text sizes. The final implementation and run include both fixes.
- The monorepo build and typechecks passed during implementation. Final
  frontend and scripts typechecks, frontend production build, dependency
  audit, dependency license checks and bundle budget passed after integration.
  The production audit reported no known dependency vulnerabilities.
- A separate clean v0.3.9 checkout passed the unchanged bundle checker. The
  feature allowance measures growth only in four integration assets and the
  largest selected profile locale pack, using level-9 gzip consistently.
  Feature growth is 8.4 KiB raw / 3.2 KiB gzip, within 10 KB / 4 KB limits.
  Existing base, total, language-family, asset and media ceilings remain fixed.
- The new image is 76,668 bytes. The original neutral atlas is retained as an
  edit reference and is no longer imported into the interface. Animation adds
  no dependency, backend write, service or model invocation.
- An independent source review found no actionable issue in these changes.

## Publication and limits

This is the v0.3.10 candidate. Local acceptance above does not establish a
physical-phone test, native-speaker review, provider-generated empathy or a
real 24-hour runtime soak. It is not a complete rerun of all repository tests.
The exact candidate must pass GitHub source, browser, security, native and
container checks before merging; distribution acceptance is separate.
Pending runtime failures in PRs #36 and #37 and issues #29 and #34 remain open.
