# Reusable Project Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The human's standing authorization permits routine implementation without another approval question.

**Goal:** Let people reuse a saved project brief, prepare it as a personal guide, and prepare another project from that guide without losing drafts or starting work during preparation.

**Architecture:** Use existing project creation and personal-capability storage. Text preparation is separate from explicit Save and Start. Preserve incoming history state, editable drafts and frozen uncertain requests independently; current execution policy remains authoritative.

**Tech Stack:** Node 24, pnpm 10.17.1, React, Wouter, TanStack Query, Zod mini, Express, Drizzle/PostgreSQL, Playwright. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-09-reusable-project-guides-design.md`

## Global Constraints

- Worktree: reused attached `windows-helper-diagnosis/Agentic-Company-OS`; branch `codex/reusable-project-guides-20261009`, dependency `5f573ce22c2e0198e3973f1f26db1d3a6765acfb`. Preserve frozen PR44 and primary local changes.
- Publish only after PR44 acceptance and rebasing onto actual main; this feature requires its own mandatory checks and actual main/distribution validation.
- Seven authored locales: tr, en, de, ru, zh-CN, zh-TW, ar; 390px, light/dark, Arabic 200%, 44px controls, keyboard focus, no horizontal overflow.
- Exact text only: title300/brief8000; guide title120/description2000/instructions8000; server package cap16000 JSON.stringify characters. Do not truncate.
- No source output/activity/files, connection secrets, permissions, prior approvals, budgets or creation identity in the text handoff. Text provenance is attribution, never authority.
- Preparation, editor Save, conflict resolution and reconciliation cause zero model calls and zero task creation. Only explicit Start invokes existing project admission.
- Incoming projects default finite/normal/3600 cadence. Retain existing pending PR44 request identity and later editable drafts.
- No automatic Save retry, automatic Start, second guide ID after uncertainty, invented command receipt, numeric cost forecast or new workflow engine.
- No paid inference, account authentication, external messaging or public service is part of local acceptance.

## Review Focus

- Existing input survives incoming seed, reload and a denied/corrupt store; cover in Task1.
- A late reconciliation must not clear later edits or navigate after unmount; cover in Task2.
- Existing tool/program/import editors and pack/toggle mutations must preserve unrelated input; cover in Task2.
- Overlong titles, Unicode/escaped JSON near the package cap and stale project reads need visible correction, not silent loss; cover in Task3.
- Historical status, permissions, recurring settings, price or source links must not become new authorization or invented success evidence; cover in Task3 and Task4.

## Files and responsibilities

- `src/lib/project-preparation.ts` and `.test.ts`: bounded text/source handoff and matching history consumption. Paths here are under `artifacts/agentic-company-os/` unless explicitly prefixed otherwise.
- `src/hooks/use-composer-draft.ts`: expose whether restored input has information and return verified persistence from change, preserving existing callers.
- `src/pages/tasks/new.tsx`: incoming text choice and existing receipt-backed Start.
- `src/components/studio/project-preparation-choice.tsx`: lazy localized inline Keep/Use decision, load/error recovery and no dispatch.
- `src/lib/reusable-work-copy.ts` plus `src/lib/reusable-work-copy/reuse-{locale}.ts`: independently loaded authored copy for preparation/recovery.
- `src/lib/extension-editor-draft.ts` and `.test.ts`, `src/hooks/use-extension-editor.ts`: editable manifest/defaults state, immutable pending Save, strict persistence and matching reconciliation.
- `src/components/extension-library.tsx`: preserve editor independently of pack/toggle state; explicit guide Save/Check/Retry and personal-guide preparation.
- `src/components/studio/project-reuse-actions.tsx`, `src/pages/tasks/detail.tsx`: current successful root-project snapshot preparation, beside saved brief context.
- `tests/ui/project-preparation.spec.ts`, `tests/ui/reusable-project-guides.spec.ts`: actual rendered draft choice and complete controlled browser journey.
- `scripts/src/testing/reusable-project-guides-smoke.ts`: actual local API/worker/PostgreSQL journey using owned controlled inference.
- `scripts/src/reusable-work-bundle-budget.ts` and `.test.ts`, `scripts/src/check-bundle-budget.ts`: source-identified exclusive feature/copy budget; existing ceilings remain.
- `README.md`, `docs/skills-and-tools.md`, `CHANGELOG.md`: concise useful workflow and its actual limits; do not promise proven learned methods.

### Task 1: Preserve existing project drafts during text preparation

**Interfaces:**

- `ProjectPreparation = { title: string; brief: string; source?: { kind: "project"; id: number; status: string; updatedAt: string } | { kind: "guide"; id: string; revision: number; enabled: boolean } }`.
- `readProjectPreparation(state: unknown): ProjectPreparation | null`; accept legacy `acosSkillDraft` title/brief, reject invalid bounded source fields; source never enters TaskInput.
- `consumeProjectPreparation(expected: ProjectPreparation, history: Pick<History,"state"|"replaceState">): boolean`; remove only a matching seed and preserve other history keys.
- `useComposerDraft.change(next): boolean` reports verified tab save, retaining current editable memory on failure. Return `hasRestoredInput: boolean` for nonempty strings or nondefault project controls.
- `ReusableWorkCopy` contains named preparation/conflict/editor/action strings and `loadReusableWorkCopy(locale: Locale): Promise<ReusableWorkCopy>`.
- Task1 copy keys: `incomingTitle`, `incomingHelp`, `keepCurrent`, `useIncoming`, `choiceError`, `preparationOnly`. Later tasks extend all seven packs together; no implicit English fallback. Choice load failure retains input/history and offers a real reload action.

- [ ] Retain the real incoming-guide browser characterization as `tests/ui/project-preparation.spec.ts`: create title `Unfinished source analysis` and exact two-line brief, choose csv-quality, assert old text remains and zero task POST; run and observe the actual RED before product edits.

```ts
await expect(
  page.getByRole("textbox", { name: c.projectName, exact: true }),
).toHaveValue("Unfinished source analysis");
expect(harness.requests).toHaveLength(0);
```

- [ ] Add history helper tests: old seed compatibility, bounds300/8000, malformed source, preserved sibling history keys, changed seed refused, Unicode/whitespace retained. Run `pnpm exec tsx --test artifacts/agentic-company-os/src/lib/project-preparation.test.ts` and observe RED.
- [ ] Implement helpers/copy and composer interface. In NewTaskForm restore current input first; an incoming seed with existing information shows Keep current draft / Use incoming brief. Empty healthy input may apply a valid seed once. A denied/corrupt store retains history and editable text with recovery-limit feedback. Only consume a matching seed after verified application or explicit Keep. Do not autoapply again on edits or locale reload.
- [ ] Disable fresh Start while a choice is unresolved; existing request inspection/open/retry retains its frozen scope. Apply explicit Use with finite/normal/3600, focus the title/brief, preserve later edits and matching clear rules.
- [ ] Expand retained browser cases for Keep/Use, before/after-choice reload, storage denial/corruption, old seed/new source metadata, pending start, late edits, no repeated prefill and keyboard focus; run actual GREEN. Run existing composer/skill/start state tests and project-start-recovery browser suite for regressions.
- [ ] Commit Task1 runtime/copy/tests/docs with `feat: preserve project drafts when preparing reusable work`. Record passed commands, failures, scope and BASE in ledger; later tasks remain incomplete.

### Task 2: Recover personal-guide editing and uncertain Save

**Interfaces:**

- Export `EditableManifest` as the existing ExtensionLibrary Manifest discriminated union (skill instructions / program code+terminal tuple / tool name+defaults object), with editable strings allowed to be temporarily invalid. The backend remains authoritative for allowed tool names.
- `ExtensionEditorDraft = { version: 1; manifest: EditableManifest; revision: number; defaults: string; enabled: boolean }`; editable text can be temporarily invalid within a65536-character recovery record. Validate common/text/package server limits separately before dispatch; keep raw invalid defaults for editing.
- `ExtensionSaveRequest = { version: 1; submittedDraft: ExtensionEditorDraft; manifest: EditableManifest; expectedRevision: number; enabled: boolean }`; ID and submission are immutable while uncertain; pending record ceiling131072characters.
- `DraftStore = Pick<Storage,"getItem"|"setItem"|"removeItem">`.
- `readExtensionEditor(store: DraftStore): {draft: ExtensionEditorDraft|null; error: boolean}`, `writeExtensionEditor(draft: ExtensionEditorDraft,store: DraftStore): boolean`, `clearExtensionEditor(expected: ExtensionEditorDraft,store: DraftStore): boolean`; pending equivalents are `readExtensionSave(store): {request:ExtensionSaveRequest|null;error:boolean}`, `beginExtensionSave(request,store): boolean`, `clearExtensionSave(expected,store): boolean`. Clear only matching records. Keys: `acos.extension-editor.v1`, `acos.extension-save.v1`.
- `classifyExtensionSave(request, rows: unknown): "matching" | "missing" | "changed" | "invalid"`; matching means same ID, expectedRevision+1, canonical manifest and enabled flag. It confirms current stored contents, not an original command receipt.
- `useExtensionEditor()` exposes draft/revision/defaults/dirty/storage status/pending/busy, edit/change/save/check/retry/discard methods and mounted/current guards.

- [ ] Add state tests and real browser RED: leave an unsaved guide, change pack selection, then navigate away/back; input remains. Simulate PUT commit with response loss and reload; same ID/submission is recoverable and no automatic PUT occurs. Cover later edits, malformed records, capacity/revision conflict, invalid defaults and tool/program import.
- [ ] Implement checked draft persistence and mounted/current identity guards. Before Save persist verified immutable request; reject dispatch if persistence fails. Check performs explicit no-store GET only. Missing permits manual same frozen body/ID/revision retry; changed requires review. A matching current row permits explicit continuation with observed revision, preserving later draft edits.
- [ ] Integrate hook into ExtensionLibrary. Pack/toggle completion must not clear an editor; explicit Save clears only its matching submission. Keep existing create/edit/import/export/program/tool behavior. New guide ID is generated once and restored, never replaced after uncertainty. Editable invalid text remains visible.
- [ ] Prove RED/GREEN cases and existing extension-store/backend + customization UI regressions. Preparation/check/save causes zero task/provider calls. Commit with `feat: recover personal guide drafts and uncertain saves` and ledger exact results.

### Task 3: Connect saved projects, personal guides and fresh work

**Interfaces:**

- `prepareProjectText(project: unknown): ProjectPreparation | null` copies exact valid saved title/brief and narrow source snapshot, no splitProjectBrief trimming.
- `preparePersonalGuide(project: unknown, id: string, description: string): editableManifest | null` produces text skill with exact title/instructions. ID must already be generated and persisted with the incoming `acosGuideDraft` seed; title120 validation happens at explicit Save without truncation.
- `ProjectReuseActions({project,sourceUnavailable}:{project:Task;sourceUnavailable:boolean})` offers Use brief again / Prepare personal guide only for valid root records and successful current reads.
- Incoming guide conflicts use the existing editor-preservation decision, not silent replacement. Personal skill rows prepare NewProject through Task1; tools/programs are not reinterpreted, and disabled guides retain their status without enabling capabilities.

- [ ] Add browser RED for completed/current root-project text reuse, incoming editor conflict, guide save and guide-to-project use. Assert source result/output, provider, owner, approvals, recurring controls and UUID are absent; initial guide preparation has zero PUT/POST/model calls.
- [ ] Implement ProjectReuseActions and strict typed handoff. Source error/fetch prevents preparation from retained stale data; current successful record is explicitly a snapshot. No async response may navigate after unmount. Place actions beside saved brief context; title/status is not proof of success. NewProject shows current-runtime connection/limit guidance and a Settings link; do not invent budget picker, price or balance.
- [ ] A prepared new personal guide defaults disabled, with a visible operator choice to make it available to agents at Save. Text-only Prepare project remains available while disabled and explains that status. Existing guide enabled state is retained. This avoids changing guidance discovery for already running work just by preparing text; enabled guidance never grants tools.
- [ ] Cover source failure/change after preparation, long title300 corrected explicitly to120, instructions8000, escaped package16000 boundaries, all seven languages at390px/light/dark/Arabic200%, keyboard and reduced motion, disabled guide handling and import/export. Run GREEN and meaningful existing studio/customization/start regressions.
- [ ] Implement/run `pnpm exec tsx scripts/src/testing/reusable-project-guides-smoke.ts` under an explicitly owned disposable PostgreSQL with fail-if-unavailable. Use an owned loopback inference fixture and actual API/worker execution: saved result -> text preparation/save -> fresh UUID Start -> single new root/receipt/completion. Assert zero inference during preparation/save/check and bounded calls only after explicit Start; exact source hash stable, cleanup proved, evidence saved. This is controlled inference, not live-model quality or physical phone proof.
- [ ] Document actual workflow and limitations, commit with `feat: reuse saved project briefs through personal guides`, and ledger exact acceptance scope.

### Task 4: Verify, review and publish the complete workflow

**Interfaces:**

- `measureReusableWorkBundle(assets,sourceDirectory)` identifies exclusive chunks and source-authored copy; returns exclusive/copy/selected raw+gzip plus control differences.
- One-locale aggregate credit is independent `max(current)-max(control)` raw/gzip, never sum of all locale additions. Keep all-language disk/copy caps and original route/vendor/global ceilings.

- [ ] Record actual build measurement before assigning narrowly measured feature limits. Add RED/GREEN budget tests for locale maxima, shared-parent wiring, missing/ambiguous source mapping and exclusion of unrelated code. Do not raise a failing old ceiling or strip features to obtain green.
- [ ] Run whole format/audits/licenses/codegen/source/type/build/UI/bundle gates on frozen feature bytes; inspect every failure. Request one fresh whole-branch read-only review per executing-plans; fix important issues with actual RED/GREEN and affected/whole acceptance. Preserve evidence and scope for controlled browser/native/physical/long-duration tests.
- [ ] After PR44 accepts, fetch authoritative main, rebase, confirm tree/diff and immutable candidate source bridge, scan secrets and publish a focused PR. Attach it. Require every exact-head mandatory gate/current main/base/tree before merge; no stale or cancelled checks.
- [ ] Validate actual main and original source-bound distribution artifacts, publish the appropriate next release with honest notes and verify anonymous assets. Record user benefit, exact tests, remaining limits and next highest-value Goal7 work. Do not mark the broad goal complete from this feature.
