# Global README and capability expansion

## Scope

- Seven separate welcome READMEs: English remains the default, with native-language links to Turkish, German, Russian, Simplified Chinese, Traditional Chinese and Arabic. Arabic uses RTL presentation.
- 50 built-in guides, including 20 new task-specific guides translated into all seven application locales. Existing guide IDs remain stable; catalog version is 2.
- 34 capability tools, including ten new bounded processors. Existing browser, terminal and task runtime tools remain separate.
- Personal utility selection, pack revocation and lazy schema discovery include the new tools. No dependency, subscription, permission or database migration was added.

## Local evidence

Environment: Windows, Node 24.19.0, pnpm 10.17.1, isolated publication checkout.

| Check                                     | Result                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| README destinations and language switches | Seven files, 217 local Markdown destinations exist; every edition links all seven languages and has the same eight main sections.                                                                                                                                                                                                                                  |
| Focused runtime integration               | 27 tests passed across advanced tools, catalog, production dispatcher and authenticated HTTP catalog route. All 34 capability tools execute through the dispatcher in all seven locales.                                                                                                                                                                           |
| Expanded catalog checks                   | Five tests passed, covering 140 new translations, stable IDs, localized discovery, read/draft content, missing access and disabled packs.                                                                                                                                                                                                                          |
| Browser library checks                    | 19 Chromium tests passed against the production frontend build: seven-language phone search and old/new guide draft handoff, desktop filtering, personal package persistence/export, executable package editing and new CSV preset creation/reload. HTTP responses in these UI tests use fixtures; the runtime tests above exercise the real dispatcher and route. |
| Frontend bundle budget                    | Passed without raising the existing limits.                                                                                                                                                                                                                                                                                                                        |
| Formatting                                | Whole-repository Prettier check passed.                                                                                                                                                                                                                                                                                                                            |

The first integrated source run exposed a circular module initialization failure
in guide authoring. The parser was moved into an independent module, and the
catalog/runtime checks above passed afterward. Independent review also found
that a lone surrogate could match inside an emoji; search/replacement now reject
malformed Unicode, with failing-before/passing-after regression coverage.

These are scoped implementation checks. Full source and protected platform CI
results are reported on the associated pull request and must be read separately.
No new live-model task acceptance, native-speaker review, physical-phone test or
24-hour endurance result is claimed by this document. This is an unreleased
source change until separately packaged and released.
