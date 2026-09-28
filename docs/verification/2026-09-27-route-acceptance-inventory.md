# Reachable route acceptance inventory

Status: combined local structural/interaction gate passed; representative visual
review recorded. Native language, device and assistive-technology acceptance
remains unverified. This inventory follows the current `App.tsx` registrations
and actual test files. Mapping a route to a file is not proof of every possible
visual/state combination.

The [28 September combined checkpoint](2026-09-28-full-release-gates.md) records
903/903 passing Chromium cases with no skips or flaky results, a frozen source/build manifest and inspected captures. It includes
the capability library, history repairs, primary/workspace matrices, access and
overlay checks, 32 px font cases, and focused recovery/keyboard scenarios. The
production build has 198 files; its exact hashes are recorded in that checkpoint.

| Reachable surface                                   | Automated evidence in the combined gate                                                                                                                                                                         | Visual/content focus                                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| First-run language choice and sign-in               | `language-setup.spec.ts`, `auth-locales.spec.ts`, `shell-locales.spec.ts`, `access-surfaces-text-resize.spec.ts`                                                                                                | All seven choices, initial chunk failure, auth failure, returning focus and RTL                                                                |
| `/` Home                                            | `home-locales.spec.ts`, `studio-onboarding.spec.ts`, `route-foundations.spec.ts`                                                                                                                                | Composer, real empty/error states, examples and phone hierarchy                                                                                |
| `/agents` directory                                 | `agent-directory-locales.spec.ts`, `studio-onboarding.spec.ts`, `route-foundations.spec.ts`                                                                                                                     | Search/filter/clear, source identity labels, pagination and stale roster                                                                       |
| `/agents/new`                                       | `new-agent-locales.spec.ts`, `authored-agent-locales.spec.ts`, `route-foundations.spec.ts`                                                                                                                      | Localized full role preview, edited draft, late/failed catalogs and validation focus                                                           |
| `/agents/:agentId` profile                          | `expert-detail-locales.spec.ts`, `authored-agent-locales.spec.ts`                                                                                                                                               | Current tab visible on phone, managed/custom distinction, language failure recovery, exact custom save, archive/portrait/model review          |
| Profile chat and computer tabs                      | `expert-chat-locales.spec.ts`, `computer-locales.spec.ts`, `browser-workbench.spec.ts`, `workspace-file-editing.spec.ts`, `file-editor-recovery.spec.ts`, `file-deletion.spec.ts`, `history-navigation.spec.ts` | Conversation/command/file recovery, source output, retained edits, authority, keyboard escape and scroll                                       |
| `/projects`                                         | `project-list-locales.spec.ts`, `history-navigation.spec.ts`, `route-foundations.spec.ts`                                                                                                                       | Search/status/owner labels, bounded list, empty/error recovery                                                                                 |
| `/projects/new`                                     | `new-project-locales.spec.ts`, `studio-onboarding.spec.ts`, `route-foundations.spec.ts`                                                                                                                         | Full validation, team availability, editable examples and successful/failed submission                                                         |
| `/projects/:projectId` Studio                       | `project-studio.spec.ts`, `task-resume.spec.ts`, `trace-locales.spec.ts`, `history-navigation.spec.ts`                                                                                                          | Conversation, team/task/delivery tabs, blocked answers, meetings, receipts, history boundaries and stop review                                 |
| `/projects/:projectId/operations` and `/operations` | `operations-room.spec.ts`, `project-studio.spec.ts`                                                                                                                                                             | Project scoping, evidence/unknown states, filters, reconciliation and local damaged-record recovery                                            |
| `/workforces`                                       | `workforce-locales.spec.ts`, `route-foundations.spec.ts`                                                                                                                                                        | Selected-language preview/installation, exact replay, source identities and safe permissions                                                   |
| `/skills`                                           | `skills-library.spec.ts`, `route-foundations.spec.ts`                                                                                                                                                           | All seven locales, RTL, keyboard disclosure, search/category filters, loading/error/empty states and editable project draft                    |
| `/approvals`                                        | `approval-locales.spec.ts`                                                                                                                                                                                      | Complete reviewed scope, current authority, note preservation, one-time decisions and uncertain outcomes                                       |
| `/company-chat`                                     | `company-room-locales.spec.ts`                                                                                                                                                                                  | Membership/mentions, source transcript, send/round recovery and history                                                                        |
| `/settings`                                         | `settings-locales.spec.ts`, `route-foundations.spec.ts`                                                                                                                                                         | Language/theme, configured versus tested credentials, conflict/removal/model-test recovery and original model metadata                         |
| Unknown route and legacy aliases                    | `release-smoke.spec.ts`, `shell-locales.spec.ts`                                                                                                                                                                | Localized 404, `/activity` redirect preserving query/hash/focus; `/tasks`, `/tasks/new`, `/tasks/:taskId`, `/tasks/:taskId/operations` aliases |
| Shared navigation/search/emergency controls         | `shared-ui-locales.spec.ts`, `emergency-control-locales.spec.ts`, `access-surfaces-text-resize.spec.ts`                                                                                                         | Focus trapping/restoration, small heights, correct direction, error handling and safety copy when a chunk is unavailable                       |

## Historical focused checkpoints included in the current full gate

- [History and route audit](2026-09-28-history-and-route-audit.md): API pagination,
  placeholder contrast and Older/Newer/Latest controls. Its 22 source checks,
  143 Chromium scenarios and four final inspected captures were focused evidence.
- [Primary route foundations](2026-09-28-route-foundations.md): 224 default route
  states across seven locales, two themes and two viewports. Sixteen captures
  were inspected; Home's undersized View all target was repaired.
- [Workspace foundations](2026-09-28-workspace-route-foundations.md): 504 initial
  measured states. Inspection found collapsed operation identity text and an
  incorrectly scoped Studio fixture; stronger affected regressions passed.
- [Primary text resizing](2026-09-28-text-resize.md): primary routes plus open
  expert settings and a guide at a 32 px default font. Toolbar, intrinsic-width,
  label and selected-value clipping findings were repaired.
- [Access and overlay text resizing](2026-09-28-access-text-resize.md): 201 states
  in 34 cases; seven phone languages in both themes and three desktop variants.
  Twelve final images were inspected. Readable expert names and selected search
  results after viewport reduction have explicit checks.
- [Workspace text resizing](2026-09-28-workspace-text-resize.md): 306 initial
  states, actual visual findings and stronger assertions. Final affected coverage
  was 85 enlarged-text cases across two runs plus 263 normal-size regressions;
  the final focused runner passed 280/280, including 17 repeated file variants.
  Twenty-six images were inspected. This closes the previously pending local
  workspace large-text checkpoint; native zoom/input behavior remains separate.
- [Capability library](2026-09-28-capability-library.md): 30 guides, ten additional
  tools and draft handoff. Its focused 49-source / 27-browser pass preceded the
  combined gate; independent review findings and fixes are retained.

The new full gate supersedes the old outstanding combined-run requirement.
Historical counts are not added to its test count. Visual inspection remains
representative; large-text fixtures and synthetic composition events do not
establish physical-device zoom, native input methods or screen-reader results.

## Evidence discipline and remaining limits

- Record the exact build and output directory for captures. Current feature
  captures alone do not prove every route or state.
- Inspect the rendered result. Screenshot existence and DOM overflow assertions
  do not establish hierarchy, legibility, contrast or translation quality.
- Trace untranslated strings to their producer. Preserve names, operator/model
  prose, commands, file contents, external output and historical receipt text.
  Localize newly authored application prose without rewriting source evidence.
- Confirm pagination and recovery when older records are part of the flow.
  Bounded statistics must name their sample scope and not claim lifetime totals.
- Treat intentional, labeled keyboard-scroll regions and accessible long-dialog
  scrolling separately from clipped controls or unreadable stacked text.
- Keep native-language, physical-phone HTTPS/mobile-data, Safari/native input and
  assistive-technology exclusions explicit. A Chromium phone viewport is a
  browser fixture. See [release readiness](2026-09-27-release-readiness.md) for
  exact-candidate, disclosure and environment gates still open.
