# Authored agent instructions in seven languages

## Intended outcome

Goal 7 already authorizes complete localization and autonomous local implementation. The current audit found 15 stock role playbooks and shared workforce handoff rules still authored only in Turkish. Provide their full equivalents in `tr`, `en`, `de`, `ru`, `zh-CN`, `zh-TW`, and `ar`, preserving every acceptance/evidence/approval obligation. This is an interface and runtime integration change, so the design and implementation sequence are recorded here. Local reversible changes proceed under the existing goal; publication, installation, spending and credentials remain user-controlled.

## Design

Use the existing Turkish template catalog as the authority for identity, department and permission presets. Six independent static language catalogs supply names, role labels, descriptions, complete playbook bodies, manager/specialist rules and the workforce prompt wrapper. Never send instructions or user data to a translation service and never translate using a paid model call.

Expose `getLocalizedAgentTemplates(locale)` and `getLocalizedAgentTemplate(key, locale)` as pure functions returning detached template objects. Unknown locales or keys must not silently substitute another role. Turkish output stays byte-identical to the existing catalog. Localized bodies append the matching full common rules once. Translation must not change canonical keys, roles' authority class, default permissions, blueprint versions, hierarchy or handoff modes.

The template-list endpoint accepts a validated optional locale; omitted locale keeps its existing Turkish contract. Agent creation accepts the explicit locale for template selection, and preserves a supplied custom prompt exactly. Any explicitly supplied prompt is custom even when a template key is present, so startup cannot overwrite it. New-agent UI binds its query and submitted locale to the reviewed language, does not overwrite edited fields after a refresh or language change, and blocks stale/unavailable catalog submission.

Workforce creation uses localized base playbooks and wrapper text in its already immutable request locale. Existing installation replay returns its original result. Default seeded prompts and runtime role assembly use the selected workspace/turn locale only for known, non-custom templates. Existing custom/installed instructions, identities, permissions and historical messages remain source content. Template defaults shown in the profile should be distinguishable from editable custom instructions; no localization response may overwrite an in-progress edit.

The first-run workspace preference must reach future stock-agent turns, including when the organization was seeded before the browser chose a language. Do not depend on renaming existing agents or migrating custom instruction text. The existing `isCustomPrompt` provenance distinguishes managed role instructions from operator-authored content; do not guess from string equality.

## Verification

- Catalog parity: all 15 keys in each locale, exact authority/permissions/department parity, independent Chinese scripts, original Turkish bytes, detached results, invalid input rejection, no mutation of existing catalogs.
- HTTP/seed/runtime: explicit locale, omitted-locale compatibility, invalid locale, custom text with template key, stock versus custom startup behavior, selected-language future turn, workforce locale/replay and permission invariants.
- UI: all seven languages, language changes and stale catalogs, exact custom Unicode/whitespace, no late-response draft replacement, first-run/profile/new-agent flows, phone RTL and keyboard focus.
- One fresh integrated review and one Important/Critical RED-to-GREEN repair pass, then full local gates and honest native/physical-device/native-speaker exclusions.

## Scope boundaries

This work closes authored role/workforce instruction localization. Application-authored Terminal/tool output, older-history browsing, remaining route/visual/accessibility acceptance and external deployment/public-candidate checks stay in Goal 7 and are not declared complete by these catalogs. Native-speaker acceptance is distinct from structural tests and source comparison.
