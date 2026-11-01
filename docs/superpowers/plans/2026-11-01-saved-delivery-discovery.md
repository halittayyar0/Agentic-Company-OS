# Saved Delivery Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach the existing saved delivery directly from its project heading.

**Architecture:** Reuse the current task read model, selected studio language pack,
shared Button styles on a native anchor and existing delivery heading. Native
fragment history is enhanced by scoped in-memory scroll restoration and deferred
destination focus; no backend or agent state mutation is added.

**Tech Stack:** React, Wouter, Radix Button adapter, TypeScript, Playwright,
Node.js 24.22.1, pnpm 10.17.1.

**Spec:** `docs/superpowers/specs/2026-11-01-saved-delivery-discovery-design.md`

## Global constraints

- Seven locales: en, tr, de, ru, zh-CN, zh-TW, ar.
- 320px and 1024px; 200% text, RTL, keyboard, 44px touch controls.
- No new API, permission, inference, work write or automatic retry.
- Preserve existing authority labels, tab/query/history and unsent drafts.
- Keep native release v0.5.9 evidence bound to its original source commit.
- Commits use Halit Tayyar, without AI/Replit coauthor trailers.

## Review focus

- A completed task with no saved output must not have a dead delivery link.
- A recurring/stopped task with an earlier output must not imply new completion.
- A cached result after a refresh failure keeps its stale warning.
- Jump/back/reload retain the exact project, tab, query and conversation draft.
- Target focus and long localized labels remain usable at phone width/200% text.

### Task 1: Direct saved-result navigation

**Files:**

- Modify `artifacts/agentic-company-os/src/pages/tasks/detail.tsx`.
- Modify `artifacts/agentic-company-os/src/components/studio/project-delivery-summary.tsx`.
- Modify `artifacts/agentic-company-os/src/lib/project-studio-copy.ts` and its seven `project-studio-copy/studio-*.ts` packs.
- Test `tests/ui/project-studio.spec.ts`.
- Document `docs/delivery-summary.md` and `UX-CONTRACT.md`.

**Interfaces:** Existing `Task.resultSummary`, `ProjectStudioCopy`, shared
`buttonVariants` styles, and `#project-delivery-heading`. Add one localized studio copy field
for the navigation label; make the existing heading a focusable fragment target.

- [x] Add browser cases for all seven locales at 320/1024px, with actual initial
      screenshots. Assert a header link, Enter navigation to the saved heading,
      visible/focused target, unchanged query/tab, preserved draft and zero work writes.
- [x] Run a focused English case against the existing build; record the expected
      failure on the missing navigation link and retain the baseline screenshot.
- [x] Add the localized header anchor only for trimmed saved output; add focus and
      scroll clearance to the existing heading. Use shared controls and no server mutation.
- [x] Cover no/whitespace output, recurring/failed output, stale refresh and
      cross-project navigation; verify Back/Forward/reload and no duplicate results.
- [x] Run relevant browser/source checks, inspect real 320/1024px images, run the
      strict premium audit and triage exact findings without weakening scanner rules.
- [x] Update saved-delivery usage/UX contract, run formatter/typecheck/build and
      dependency/security checks, then independently review the final change.
- [ ] Commit as Halit Tayyar, push `codex/saved-delivery-discovery`, open a PR and
      retain original required CI/platform/security identities. Merge only after all
      required checks pass. Verify the actual deployed artifact separately from
      source merge; report any release/device scope still pending.

## Execution rulings and evidence

- The actual 1024px baseline showed a squeezed title and delivery beside chat.
  The compact-laptop regression first failed on the side-by-side layout; the
  heading-link regression first failed on the missing action.
- Native fragment navigation alone did not restore the desktop contained scroller
  on Back/Forward. Keep ancestor scroll offsets in memory for the exact originating
  URL, cancel deferred focus and remove listeners on unmount, and preserve a newer
  draft's focus if optional behavior arrives late. These failures were observed
  before each correction; no API, storage record or permission was added.
- Keep one stable native anchor styled by the canonical Button factory. Load only
  its optional behavior lazily; failed or delayed code cannot replace the focused
  link or hide the existing report. Slow/failure browser regressions cover this.
- The original complete strict premium audit produced no report before being
  stopped after 953 seconds. An observed retry stalled on the unchanged
  `tests/ui/home-start-recovery.spec.ts`. Product-only strict diagnostics complete
  with the same 65 pre-existing rule/file/message/source-line findings as a fresh
  Git archive of source N. There are zero new product findings. This is a scoped
  comparison, not a clean full-project audit; the committed audit scope is unchanged.
- New navigation bytes need explicit source/hash-owned accounting, rather than
  credit against older recovery/composer features. Existing caps and the pinned
  reader runtime digest remain fixed; compiler export alias changes must prove
  the same underlying frozen helper before normalization.
- The complete project-studio browser run passed 75 cases. Subsequent layout
  checks passed 22 representative cases and seven corrected media-query cases.
  A fresh review found early clicks could lose their return point before lazy
  behavior loaded. Two failing regressions reproduced this before eager capture
  fixed it. The final single-origin-ref implementation passed seven targeted
  navigation/slow-load/focus cases and the full workspace typecheck; 320px result
  and 1024px initial screenshots were inspected again.
- Final source/hash-owned bundle accounting passes on manifest
  `fec78f76e8de21a201e20bd7a67a65750cd4287bc12f03f1b9c4c6c3a3be4c92`.
  The new scope is 2408 raw / 925 gzip bytes, within its 3000 / 1500 caps.
  Existing caps and the pinned reader runtime digest are unchanged. Dependency
  audit found zero known vulnerabilities; the staged secret scan is repeated
  after final staging. CI and platform results belong to the eventual PR head.
