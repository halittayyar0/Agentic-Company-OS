# Direct access to a saved project delivery

## Intent

A person reopening a project should find its saved result from the project
heading, without searching through the goal, team, usage and workbench panels.
The current server-provided result remains the only source of content and
completion authority. This improves the first useful result and phone journey.

## Decision and alternatives

The operator delegated routine product decisions and implementation. Choose a
localized, read-only in-page link below the project title. The link goes to the
existing delivery heading and moves keyboard focus there. Keep the current tab,
query, conversation draft and browser history. Auto-selecting the evidence tab
would unexpectedly change the current view; duplicating the result in the header
would create two competing delivery surfaces.

## Contract

- Show the link only for a non-whitespace saved `resultSummary`, including a
  recurring or stopped task with an earlier saved result. The label says saved
  delivery, never claims current completion or model acceptance.
- Reuse the shared Button style factory on a native anchor, `ProjectDeliverySummary`, the selected
  `ProjectStudioCopy` pack and existing project data. No new API, permission,
  provider, inference, write request, tool dispatch or automatic retry.
- The target heading remains visible below the app bar, receives focus, and
  preserves ordinary Back/Forward and reload/deep-link behavior.
- Keep the native anchor stable while optional navigation behavior loads or
  fails. Its scoped behavior stores only in-memory ancestor scroll positions,
  restores them for the exact same-page history entry, and cleans up on unmount.
  Delayed behavior startup must not steal focus from a newer user action.
- Preserve stale-data warnings, operator/agent provenance, no-result states and
  URL-backed tabs. A failed refresh must not invent a new result.
- Preserve the established DESIGN.md palette, IBM Plex typography, document
  scroll owner, shared focus rings and 44px touch controls. Verify 320px and
  1024px, Arabic RTL, long labels, 200% text, keyboard and both color schemes.
- The observed 1024px baseline squeezes the title beside a mostly empty team
  column and the result beside chat. Keep these panels in one reading column
  below the existing 1280px `xl` breakpoint; wide screens retain two columns.
- Backend task read authorization, result acceptance, completion requirements,
  budgets and agent permissions remain authoritative and unchanged.

## Verification and limits

Browser regressions must first fail on the missing link, then prove focus,
visible destination, history/query/tab/draft preservation and zero work writes
in all seven locales. Cover empty/whitespace results, recurring saved results,
stale refresh and cross-project navigation. Inspect actual initial and delivery
screenshots; reproduce any title-layout problem before changing that layout.
Run relevant source, localization/accessibility, format, typecheck, build,
security and protected CI/platform checks. Keep physical-phone/Safari gaps
explicit. Publishing source or a deployed preview is distinct from rebuilding
and releasing new native application archives.
