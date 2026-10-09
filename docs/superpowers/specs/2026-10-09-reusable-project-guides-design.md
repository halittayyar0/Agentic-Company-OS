# Reusable work through existing guides — design

Date: 9 October 2026
Status: implementation complete; final candidate and publication acceptance are in progress. See the execution plan for the remaining gates.
Source inspected: e494b7d26b3a7490dc3311847cba30b1624a7b48 / tree122fa57f3fa22f90b900bf37a23b79a481f81203, pending PR44. Ruling: develop independently in the reused, clean attached windows-helper-diagnosis worktree on codex/reusable-project-guides-20261009 at corrected dependency5f573ce/treebe1aeea. This preserves the frozen PR44 source and pending tests. Publish this feature only after PR44 is accepted, rebase onto actual public main, and verify its own exact head. This does not replace PR44 acceptance.

## Intent and authorization

The human wants a useful, modern open-source agent product with minimal technical setup and token cost, reliable completion, recurring work and reusable useful results. Their standing authorization says to make routine implementation decisions without asking again. Preserve their full objective: this cycle supplies reusable work, not a claim that the entire product is revolutionary, stable, fully isolated or complete. The original proposed follow-up was reusable briefs through the current skill/composer flows. Fresh source inspection identifies draft-conflict protection and guide-to-project handoff as necessary parts of that outcome.

Classification: architectural interaction/state change across the delivery, composer and guide editor. Use a written design and plan. The user's explicit standing instruction overrides the brainstorming skill's repeated approval gates; no paid inference, authentication or external message is authorized by that exception. Prepare and inspect the concrete design before product edits. Keep PR44 frozen while its existing CI producers run.

## Evidence that changes the design

- ProjectDeliverySummary renders saved agent-reported output and links to Evidence. A report is distinct from proof of success. ProjectWorkbench owns the delivery/plan/evidence area.
- NewProject accepts acosSkillDraft and uses useComposerDraft with preferInitial=true. Its mount effect consumes history and persists that seed. A controlled browser characterization on the frozen source really replaced "Unfinished source analysis" with "CSV quality report" after Use guide, without a draft-conflict choice. Source unchanged, zero task POSTs. Original observer first failed because its config used the wrong web-server cwd; corrected probe reached the intended failed assertion. Logs .tmp/reuse-characterization-cwd-observer-failure.log and .tmp/reuse-characterization-red.log; PNG/trace under .tmp/reuse-characterization-results. This is a deliberately tested new requirement, not a failure of PR44's receipt contract.
- Personal ExtensionLibrary supplies editor, explicit PUT save, optimistic revision, enable/disable and JSON export, but no project preparation action. GET /skills includes filtered built-ins, not personal guides. Runtime discovery separately exposes personal skills as untrusted guidance.
- ExtensionManifest supports a text skill with 120-character title, 2,000-character description, 8,000-character instructions and 16,000-character package ceiling. Its strict schema has no provenance field. Use existing fields rather than inventing another recipe store/API.
- Existing NewProject has finite/continuous cadence, model connection and receipt-backed start. It has no per-project budget override field. Do not describe a new budget picker as already available or invent provider balances; surface the current cost policy/link to its existing controls when it is authoritative.

## Approaches

1. Copy brief only: useful for a one-time repeat, but does not create a discoverable saved guide or resolve draft replacement.
2. Existing project and personal-guide flows: recommended. Add three explicit text-preparation actions plus conflict-aware draft handoff and skill-editor draft recovery. Existing execution, provider, permission and recurring gates remain authoritative.
3. New workflow engine/automatic learning: needs separate persistence, versioning and side-effect reconciliation. The full goal retains this future possibility; it is not needed to make this selected outcome complete.

## User experience

A root project with valid saved source text offers Use this brief again and Prepare a personal guide. Place these beside the brief/delivery context with the source record/status visible; call it a saved brief, never a verified reusable method. Preparation is a normal user action, not an execution action. A stale/error source retains its visible state and offers refresh before a new source snapshot is prepared. Never scrape raw activity, files, output, credentials or tool arguments into a guide.

Use this brief again opens existing NewProject with exact source title/brief and narrow local source attribution. Finite mode and normal priority are the new-draft defaults. Source recurring state, owner, provider, budget usage, permissions, approvals and creation UUID are not new authorization. An existing editable draft produces an inline Keep current draft / Use this brief decision; neither navigation nor reload silently replaces it. The incoming seed remains recoverable until resolved, then is consumed once. Later edits and an unresolved PR44 request remain intact. Every deliberate Start uses the established verified-save/new-UUID/receipt path; preparation never submits work.

Prepare a personal guide opens existing Skills/ExtensionLibrary with a fresh stable user-namespace ID, source-attributed description and the original brief as editable instructions. The operator reviews and explicitly saves. Generate ID once and preserve it with the draft; an unconfirmed PUT cannot generate a second ID or silently replay. Existing list/read and revision checks establish saved outcomes separately. A project title longer than120characters must be shortened explicitly; do not silently truncate title, brief or instructions. Show the original source and the title limit. Attribution in a saved description is text referring to the originating installation, not an authenticated record link after portable import.

Skill editor recovery preserves an existing skill draft before an incoming seed can replace it. A damaged/unavailable tab store reports the actual recovery limit and retains the current editable text; no invented save/restore guarantee. The detailed plan must define verified persistence before dispatch for seeded guides, matching-record clearing and explicit reconciliation of an unconfirmed save against the same stable ID/revision. Existing tool/program editing remains supported; do not accidentally reinterpret those manifests as text guides.

Personal text-guide rows offer Prepare a project using the same conflict-aware handoff. Disabled rows do not silently enable themselves or grant tool access; any allowed text preparation is visibly separate from runtime capability enablement. Old approval tokens, spending evidence and execution identity are never transported. The existing import/export and optimistic revision UI continue to work.

## Boundaries and economics

- Preparation, saving/reading text, selecting a guide and resolving conflicts need no model call or worker dispatch. Prove that at the actual HTTP boundary.
- A fresh execution follows current admission, selected connection, provider capability, emergency stop, token/cost and family/recurring limits. Past success or cost is not a forecast or permission.
- Validate history/session seeds as bounded text-only records. Reject malformed or oversized state before changing any current draft. Source IDs/status are attribution, not authority; do not send them as TaskInput permissions or inject source result text into the new task.
- No new workflow engine, automatic extraction model, external telemetry, public server, account sign-in or dependency is required for this cycle.
- Native portable distribution remains source-required in0.4.0; easier native installation and physical-phone/assistive/native-speaker/long-duration acceptance remain explicit broader-goal requirements, not dropped by this feature.

## Design references

Apple references are applied as web interaction principles: generative-ai.md (Keep people in control; Transparency), feedback.md (Best practices, unexpected data-loss feedback), buttons.md (Best practices, spacing/hit region), plus accessibility/layout/typography/color and desktop/mobile foundation references. Use existing semantic colors,44px CSS targets, wrapped labels, keyboard/focus recovery, light/dark and Arabic RTL200%. Do not claim native Apple conformance or add decorative movement to this task.

## Acceptance before publication

1. Convert the actual displaced-draft characterization into a retained real browser RED/GREEN case in the feature workspace. Cover current-draft Keep/Replace, reload before/after choice, failed persistence, malformed seeds, late source outcomes, existing pending start identity and exact Unicode/whitespace within form limits.
2. Use existing guides in all7languages and verify root-project reuse, guide preparation/save/revision conflict/export/import, personal-guide use, long-title correction, disabled status and keyboard focus at390px, light/dark, Arabic200%; no task/inference during preparation.
3. Exercise a real local API/worker/owned-Postgres result-to-guide-to-new-job journey with controlled inference. Confirm guide preparation0calls, explicit new start using a fresh UUID, one project/receipt, narrow GET recovery, completed evidence and current permissions/budgets. Keep this distinct from browser response fixtures and from live model/account quality.
4. Add independent exact bundle measurement for this feature and its copy/wiring. One-locale aggregate credit is max(current)-max(control), not the sum of all seven packs; retain separate disk/copy caps and original route/vendor/global ceilings. Measure before assigning any allowance; no blanket constant to make a failure green.
5. Whole codegen/type/build/source/UI/security/license and mandatory exact-head platform gates, independent final review of any architectural state changes, then focused PR merge only at accepted head/base/tree. Verify actual main and its own distribution/release afterward. Goal7 remains active for its full scope.

## Remaining design rulings for the plan

Specify typed handoff fields and one-time consumption order; distinguish source preparation from current draft restoration. Define guide-editor persistence/reconciliation states and the stable new-ID rule before coding. Choose whether cached source preparation is disabled or explicitly attributed as a snapshot. Define the cost-policy visibility using existing authoritative APIs, including unknown values. Assess all form/raw-package size bounds and avoid auto truncation. These are routine decisions for the agent under standing authorization, not user approval questions.

## Source-informed rulings after inspection

- Read the exact stored title/brief, never infer the original user-only text with splitProjectBrief: that helper trims and interprets localized approach markers. Attribution is an installation-local snapshot of the selected record. Prepare actions must have a successful current source read; retained data after an error is shown but cannot silently become a fresh snapshot. A later source change does not rewrite an already prepared draft.
- Restore the existing composer through useComposerDraft before offering incoming text. Keep history seed until explicit Keep/Use choice has settled; applying text and consuming the seed are separate steps. Report failed tab persistence, retain editable memory and recoverable seed, and preserve the existing pending start request. Do not modify PR44 request UUID/input or clear it because a new seed arrived.
- A saved project brief can contain user-entered sensitive text. The narrow payload is its exact editable title/brief and bounded source attribution; no separate credential, output, activity, permission, approval or connection fields are extracted. Do not claim automatic detection or redaction of secrets within the operator's own text.
- Preparing a personal guide generates one user-UUID identifier and preserves it through edits, reload and outcome uncertainty. The editor may retain a project title up to300characters as editable preparation, but explicit Save requires the existing120-character title limit and16,000-character JSON.stringify package limit. Show validation without truncating text. The server measures UTF-16 string length here, not UTF-8 bytes.
- Existing saveExtension serializes under the global control lock and compares expectedRevision. It is not a command-receipt API. A readonly no-store refresh can say the current row matches the frozen submitted manifest, enabled flag and expectedRevision+1; it cannot claim to have found an original request receipt. A higher/different revision needs explicit review. Missing/old row permits only a deliberate same-ID, same-expectedRevision retry; a delayed first commit then conflicts rather than producing a second guide. No automatic retry or second ID.
- Separate capability-pack/toggle saves from editor completion: their success must not close an unrelated unsaved guide/tool/program editor. Preserve raw invalid defaults text as editor input rather than losing it to JSON parsing. A successful explicit guide save clears only the matching submitted draft; later edits remain visible with a reviewed current revision before another Save.
- Model/agent limits remain the existing execution policy. The incoming draft defaults to finite/normal and does not inherit recurrence, owner permissions, old spend or approval. Any displayed costs must come from current authoritative data; unknown provider price/usage stays unknown. Do not invent a per-project budget selector or an estimated savings claim.

These rulings require the adjacent implementation plan and RED/GREEN acceptance in this separate feature workspace. PR44 acceptance is a publication dependency, not a reason to stop independent local implementation. They are not completed features.

Task1 implementation ruling: preparation resolves in its own lazy component; fresh Start remains blocked until it has checked incoming state. Late edits are read before automatic prefill. Source timestamps retain valid ISO offsets and calendar dates within64characters; oversized/malformed attribution is rejected, never truncated. Exact original and final acceptance scopes remain in the plan ledger.
