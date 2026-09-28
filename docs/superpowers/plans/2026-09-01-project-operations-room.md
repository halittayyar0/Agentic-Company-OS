# Project Operations Room Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. REQUIRED DESIGN SKILLS: Read and apply both frontend-design and frontend-design-premium before changing visual code. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every active project into a truthful, polished, entertaining Operations Room and turn the global Çalışmalar route into a cross-project command center.

**Architecture:** Generated snapshot queries provide the initial operational truth; a small hand-written EventSource hook applies durable SSE deltas and explicitly models connecting, live, stale, and disconnected transport states. Pure view-model functions keep health labels, sample windows, agent lanes, incidents, and evidence milestones testable outside React. Presentation components share the existing calm Atoms-inspired shell while using motion only to reinforce persisted handoffs, recoveries, and state changes.

**Tech Stack:** React 19, TypeScript, TanStack Query, generated Orval client, native EventSource, Tailwind CSS, Framer Motion, Wouter, Playwright

**Spec:** `docs/superpowers/specs/2026-09-01-24-hour-agent-operations-design.md`

**Design contracts:** `DESIGN.md`, `UX-CONTRACT.md`, `premium-ui.json`

## Global Constraints

- Implement after `2026-09-01-operations-observability.md`; do not invent client-only health or presence.
- “Canlı”, “sağlıklı”, and “24 saat doğrulandı” come only from API-derived state and persisted minute samples.
- A disconnected stream immediately stops claiming live delivery; the last snapshot remains visible with its age.
- Project conversations, meetings, and messages remain project-scoped and are never merged into global operational summaries.
- Essential meaning is available as text, icon/shape, and accessible names; color and motion are supplementary.
- Respect the canonical ownership map, keyboard tab semantics, `prefers-reduced-motion`, 320 px layout, and contrast-tested dark/light theme tokens.
- Transport state and backend runtime truth are separate. Preserve the last-good snapshot and its age during stale/disconnected states.
- Attempt IDs are UUID strings. Bounded API windows disclose their limit/truncation and never claim to be a complete audit history.
- The project workbench has one vertical scroll owner. Workstream/timeline horizontal scroll remains visible and keyboard reachable.
- Do not add a charting or state-management dependency for this surface.

---

### Task 0: Canonical design foundation and drift gate

**Files:**

- Maintain: `DESIGN.md`
- Maintain: `UX-CONTRACT.md`
- Maintain: `premium-ui.json`
- Modify: `artifacts/agentic-company-os/src/index.css`
- Modify: `artifacts/agentic-company-os/src/lib/theme.ts`
- Modify: `artifacts/agentic-company-os/src/components/ui/button.tsx`
- Create: `artifacts/agentic-company-os/src/components/ui/icon-button.tsx`
- Modify: `artifacts/agentic-company-os/src/components/ui/tabs.tsx`
- Modify: `artifacts/agentic-company-os/src/components/ui/dialog.tsx`
- Modify: `artifacts/agentic-company-os/src/components/ui/alert-dialog.tsx`
- Modify: `artifacts/agentic-company-os/src/components/ui/sheet.tsx`
- Modify: `artifacts/agentic-company-os/src/components/ui/select.tsx`
- Modify: `artifacts/agentic-company-os/src/components/ui/toast.tsx`
- Modify: `artifacts/agentic-company-os/src/components/ui/toaster.tsx`
- Modify: `artifacts/agentic-company-os/src/hooks/use-toast.ts`
- Modify: `artifacts/agentic-company-os/src/components/ui/spinner.tsx`
- Modify: `artifacts/agentic-company-os/src/components/ui/textarea.tsx`
- Modify: `artifacts/agentic-company-os/src/components/ui/form.tsx`
- Modify: `artifacts/agentic-company-os/src/components/ui/field.tsx`
- Create: `artifacts/agentic-company-os/src/components/ui/validated-form.tsx`
- Create: `artifacts/agentic-company-os/src/components/operations/operations-state-panel.tsx`
- Create: `artifacts/agentic-company-os/src/components/ui/design-contract.test.ts`
- Create: `tests/ui/design-contract.spec.ts`
- Create: `scripts/src/check-premium-audit.ts`
- Create: `scripts/src/check-premium-audit.test.ts`
- Modify: `docs/product-studio-v2.md`

**Interfaces:**

- Produces: a single token/layer owner, contrast-safe light/dark command colors, `intent × emphasis` actions with a legacy adapter, busy controls, accessible icon controls, `ValidatedForm`, localized and correctly stacked overlays/toasts/selects, visible global scrollbars, fixed/auto-growing textarea, exact audit-fingerprint triage, and the shared Operations state matrix.
- Consumes: the existing runtime CSS/Tailwind v4 layer and Radix primitives; no second theme/token system.

- [ ] **Step 1: Write failing shared-component and token tests before changing production UI.**

Split evidence by capability. In pure Node tests, assert that `theme.ts` does not inline mode-sensitive `--primary`/`--ring`/sidebar values; light primary and state text meet 4.5:1; verified/attention/scrollbar/shadow/layer aliases exist in both modes; Button resolves `intent × emphasis` while legacy variants remain compatible; busy and Textarea state props are deterministic; and the audit triage accepts only exact configured fingerprints. In a failing Playwright fixture, exercise busy click blocking, IconButton name/tooltip, `ValidatedForm` first-error focus/value preservation, Select collision/keyboard behavior inside AlertDialog, pending dialog close/focus rules, Toast dedupe/duration/stacking, Turkish `Kapat`/`Yükleniyor`, scrollbar behavior, and every Operations state-panel state.

- [ ] **Step 2: Run the focused test and premium report; capture the expected RED/drift baseline.**

Run: `node --import tsx --test artifacts/agentic-company-os/src/components/ui/design-contract.test.ts scripts/src/check-premium-audit.test.ts`
Run: `pnpm exec playwright test tests/ui/design-contract.spec.ts --config playwright.config.ts`
Run: `python <frontend-design-premium>/scripts/audit_project.py . --mode report --no-write --config premium-ui.json`
Expected: focused test FAIL; premium report records every existing violation and zero unresolved canonical owners. Record the baseline classification (real foundation, later touched scope, unrelated legacy, known auditor false positive) rather than treating the raw count as truth.

- [ ] **Step 3: Fix the canonical foundation without screen-local overrides.**

Keep `src/index.css` authoritative and make `theme.ts` select only theme/mode. Implement the exact foreground/border, scrollbar, raised/overlay shadow, and z-layer values from `DESIGN.md`; add standards + WebKit scrollbar properties, forced-colors behavior, and `scrollbar-gutter`. Remove fake/legacy infinite activity animation from mounted canonical primitives. Implement Button `intent × emphasis` with a backward-compatible `variant` adapter. Textarea is resize-none and uses bounded `autoGrow`/`expanded`, never user drag-resize. Establish `ValidatedForm`; align Select, AlertDialog, Dialog, Sheet, Toast, and Toaster with the canonical focus/pending/layer contract.

- [ ] **Step 4: Reconcile the retired visual spec and drift ledger.**

Update `docs/product-studio-v2.md` so `DESIGN.md` and runtime tokens are explicitly canonical. Mark only resolved rows in the DESIGN drift ledger; leave untouched legacy screens visible as staged debt.

- [ ] **Step 5: Run foundation, typecheck, build, formatter, and premium report.**

Run: `node --import tsx --test artifacts/agentic-company-os/src/components/ui/design-contract.test.ts scripts/src/check-premium-audit.test.ts`
Run: `pnpm exec playwright test tests/ui/design-contract.spec.ts --config playwright.config.ts`
Run: `pnpm --filter @workspace/agentic-company-os run typecheck`
Run: `pnpm --filter @workspace/agentic-company-os run build`
Run: `pnpm exec prettier --check DESIGN.md UX-CONTRACT.md premium-ui.json artifacts/agentic-company-os/src/index.css artifacts/agentic-company-os/src/lib/theme.ts artifacts/agentic-company-os/src/components/ui`
Run: `pnpm --package=@google/design.md dlx designmd lint DESIGN.md`
Run the premium auditor with `--output premium-audit.json`, then `node --import tsx scripts/src/check-premium-audit.ts premium-audit.json premium-ui.json`.
Expected: tests/typecheck/build/format/design lint PASS with zero designmd errors; premium report has zero unresolved owners, all touched real findings are gone, and exact fingerprint triage rejects every new/moved finding. Do not add redundant JSX props to silence the auditor's documented component-name false positives.

- [ ] **Step 6: Commit.**

```bash
git add DESIGN.md UX-CONTRACT.md premium-ui.json docs/product-studio-v2.md artifacts/agentic-company-os/src/index.css artifacts/agentic-company-os/src/lib/theme.ts artifacts/agentic-company-os/src/components/ui/button.tsx artifacts/agentic-company-os/src/components/ui/icon-button.tsx artifacts/agentic-company-os/src/components/ui/tabs.tsx artifacts/agentic-company-os/src/components/ui/dialog.tsx artifacts/agentic-company-os/src/components/ui/alert-dialog.tsx artifacts/agentic-company-os/src/components/ui/sheet.tsx artifacts/agentic-company-os/src/components/ui/select.tsx artifacts/agentic-company-os/src/components/ui/toast.tsx artifacts/agentic-company-os/src/components/ui/toaster.tsx artifacts/agentic-company-os/src/hooks/use-toast.ts artifacts/agentic-company-os/src/components/ui/spinner.tsx artifacts/agentic-company-os/src/components/ui/textarea.tsx artifacts/agentic-company-os/src/components/ui/form.tsx artifacts/agentic-company-os/src/components/ui/field.tsx artifacts/agentic-company-os/src/components/ui/validated-form.tsx artifacts/agentic-company-os/src/components/operations/operations-state-panel.tsx artifacts/agentic-company-os/src/components/ui/design-contract.test.ts tests/ui/design-contract.spec.ts scripts/src/check-premium-audit.ts scripts/src/check-premium-audit.test.ts
git commit -m "feat(ui): establish canonical operations design system"
```

---

### Task 1: Pure Operations Room view model

**Files:**

- Create: `artifacts/agentic-company-os/src/lib/operations-view-model.ts`
- Create: `artifacts/agentic-company-os/src/lib/operations-view-model.test.ts`

**Interfaces:**

- Produces: `buildOperationsRoomModel`, `buildTwentyFourHourRing`, `groupAgentLanes`, `buildMissionLog`, and presentation-safe types.
- Consumes: generated `ProjectOperationsSnapshot`, current time, and stream transport state.

- [ ] **Step 1: Write failing table-driven tests for 1,440 sample buckets, sparse windows, visible-heartbeat transport freshness versus durable-data age, lane ordering, incident resolution, and evidence-only milestones.**

```ts
const model = buildOperationsRoomModel(snapshot, {
  now: new Date("2026-09-01T12:00:00.000Z"),
  stream: {
    state: "disconnected",
    transportLastFrameAt: "2026-09-01T11:59:32.000Z",
    lastDurableEventAt: "2026-09-01T11:58:00.000Z",
  },
});

assert.equal(model.truth.live, false);
assert.equal(model.truth.label, "Bağlantı koptu · son veri 28 sn önce");
assert.equal(model.healthRing.totalBuckets, 1_440);
assert.equal(
  model.missions.every((entry) => entry.evidenceId !== null),
  true,
);
```

- [ ] **Step 2: Run the focused test and verify the module is missing.**

Run: `node --import tsx --test artifacts/agentic-company-os/src/lib/operations-view-model.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement deterministic projection with explicit unknown states.**

Use fixed view-state order `working`, `waiting_approval`, `recovering`, `blocked`, `idle`, `offline`, `unknown`. Queue/sleep/wake details remain evidence fields inside `idle`; the UI must not substitute the agent table's generic status for operational presence. Never interpolate absent health samples as healthy. A 24-hour mission appears only when all 1,440 persisted minute buckets exist and all are healthy.

- [ ] **Step 4: Run focused tests and frontend typecheck.**

Run: `node --import tsx --test artifacts/agentic-company-os/src/lib/operations-view-model.test.ts`  
Run: `pnpm --filter @workspace/agentic-company-os run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/agentic-company-os/src/lib/operations-view-model.ts artifacts/agentic-company-os/src/lib/operations-view-model.test.ts
git commit -m "feat(ui): derive truthful operations room state"
```

---

### Task 2: Reconnectable scoped operations stream hook

**Files:**

- Create: `artifacts/agentic-company-os/src/hooks/use-operations-stream.ts`
- Create: `artifacts/agentic-company-os/src/lib/operations-event-stream.ts`
- Create: `artifacts/agentic-company-os/src/lib/operations-event-stream.test.ts`

**Interfaces:**

- Produces: `createOperationsStreamClient(...)` plus `useOperationsStream({ scope, enabled })` returning `{ state, transportLastFrameAt, lastEventId, lastEventAt, reconnectCount }`.
- Consumes: tagged scope `{ scope: "project", taskId } | { scope: "global" }`, `/api/ops/stream?taskId=` or authorized global `/api/ops/stream`, an injectable `EventSourceLike`, `useQueryClient`, generated project/global query keys, visible heartbeat frames, and durable event IDs.

- [ ] **Step 1: Write failing stream-client tests with a controllable EventSource fake.**

Cover initial `connecting`, first snapshot to `live`, idle connection kept transport-live by `event: heartbeat` without an ID, separation of `transportLastFrameAt` from durable change time, canonical `BigInt` sequence parsing beyond `2^53`, duplicate/out-of-order suppression, query-cache replacement, native reconnect behavior, stale timer, bounded transition to disconnected, project/global isolation, scope change, unmount cleanup, and disabled mode. Preserve the last-good snapshot and its age through every transport failure.

```ts
const snapshots: ProjectOperationsSnapshot[] = [];
const client = createOperationsStreamClient({
  scope: { scope: "project", taskId: 101 },
  eventSourceFactory,
  onSnapshot: (snapshot) => snapshots.push(snapshot),
});
assert.equal(client.getSnapshot().state, "connecting");
source.emit("snapshot", { id: "41", data: projectSnapshot });
assert.equal(client.getSnapshot().state, "live");
assert.deepEqual(snapshots, [projectSnapshot]);
```

- [ ] **Step 2: Run the focused test and verify the hook is missing.**

Run: `node --import tsx --test artifacts/agentic-company-os/src/lib/operations-event-stream.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement one EventSource per mounted project and cache-safe handlers.**

Build the same-origin URL from the tagged scope and URL-encode project IDs. Process visible `heartbeat` frames before durable-ID validation; they refresh transport time only and carry no `id`. Validate durable IDs as canonical base-10 strings, compare with `BigInt` while retaining the original string, reject non-monotonic frames, and close the source plus owned timers in every final cleanup path. Let native EventSource reconnect after transient `error`; do not close/recreate it for every automatic reconnect signal. Do not place credentials, event IDs, or prompt content in query parameters. The thin React hook subscribes with `useSyncExternalStore`, updates only the matching generated project/global query key, and owns one client per enabled scope. If global SSE is unavailable/unauthorized, the global view remains explicit polling/manual refresh and never claims live delivery.

- [ ] **Step 4: Run stream-client tests and frontend typecheck.**

Run: `node --import tsx --test artifacts/agentic-company-os/src/lib/operations-event-stream.test.ts`  
Run: `pnpm --filter @workspace/agentic-company-os run typecheck`  
Expected: PASS with no open-handle warning.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/agentic-company-os/src/hooks/use-operations-stream.ts artifacts/agentic-company-os/src/lib/operations-event-stream.ts artifacts/agentic-company-os/src/lib/operations-event-stream.test.ts
git commit -m "feat(ui): reconnect project operations stream"
```

---

### Task 3: Truth strip and 24-hour health ring

**Files:**

- Create: `artifacts/agentic-company-os/src/components/operations/runtime-truth-badge.tsx`
- Create: `artifacts/agentic-company-os/src/components/operations/twenty-four-hour-ring.tsx`
- Create: `artifacts/agentic-company-os/src/components/operations/operations-summary-strip.tsx`

**Interfaces:**

- Produces: the no-scroll five-question summary strip plus Nöbet İzi contiguous segments and `onSelectWindow({ from, to })` filtering intent.
- Consumes: `OperationsRoomModel` only; components do not re-derive backend truth.

- [ ] **Step 1: Add Playwright assertions to `tests/ui/project-studio.spec.ts` for local-demo, live, stale, and recovery fixtures before implementing components.**

Assertions must prove local-demo/live/stale/recovery copy, sparse unknown windows, segment keyboard selection, and the resulting attempt-window filter without creating 1,440 focus targets:

```ts
await expect(page.getByText("Yerel demo · scheduler kapalı")).toBeVisible();
await expect(page.getByLabel(/24 saatlik sağlık penceresi/)).toContainText(
  "1.320 sağlıklı dakika",
);
await expect(page.getByText("En eski bekleyen iş")).toBeVisible();
await expect(page.getByText("Sonraki uyanış")).toBeVisible();
```

- [ ] **Step 2: Run the project studio spec and verify the new summary assertions fail.**

Run: `pnpm exec playwright test tests/ui/project-studio.spec.ts --config playwright.config.ts --grep "operasyon"`  
Expected: FAIL.

- [ ] **Step 3: Implement the summary components with the established visual direction.**

Use a restrained 1 px border grid, tabular numerals, and an SVG or equivalent semantic ring built from contiguous healthy/degraded/unknown/incident ranges. Expose one focus target per meaningful segment plus an accessible ordered segment list; selection calls `onSelectWindow` and filters matching lanes/attempts. Never generate 1,440 focus targets and never interpolate sparse windows. `RuntimeTruthBadge` is static even when live. A newly persisted heartbeat/recovery/handoff may trigger one evidence-backed highlight for at most 1.8 seconds; no status indicator uses an infinite animation. Reduced motion presents the identical state with fixed notches, labels, timestamps, and selection.

- [ ] **Step 4: Verify the focused UI path at desktop and 390 px.**

Run: `pnpm exec playwright test tests/ui/project-studio.spec.ts --config playwright.config.ts --grep "operasyon"`  
Expected: PASS with no horizontal overflow.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/agentic-company-os/src/components/operations tests/ui/project-studio.spec.ts
git commit -m "feat(ui): show truthful 24-hour project health"
```

---

### Task 4: Team constellation and durable workstream

**Files:**

- Create: `artifacts/agentic-company-os/src/components/operations/team-constellation.tsx`
- Create: `artifacts/agentic-company-os/src/components/operations/agent-presence-card.tsx`
- Create: `artifacts/agentic-company-os/src/components/operations/workstream-lanes.tsx`
- Create: `artifacts/agentic-company-os/src/components/operations/attempt-detail-drawer.tsx`
- Modify: `artifacts/agentic-company-os/src/components/tasks/run-inspector.tsx`
- Modify: `artifacts/agentic-company-os/src/lib/run-trace.ts`
- Modify: `tests/ui/project-studio.spec.ts`

**Interfaces:**

- Produces: all-member agent lanes, persisted handoff animation, UUID attempt selection, and selected-attempt Run Inspector with durable receipt/invocation evidence.
- Consumes: view-model agent presence, bounded attempts/handoffs, agent records, and an exact attempt-scoped projection; unrelated ActivityEvents are never treated as evidence.

- [ ] **Step 1: Add failing browser assertions for all seven presence lanes, agent heartbeat age, next wake, selected attempt, keyboard navigation, and handoff text equivalent.**

The fixture must include at least working, idle-with-next-wake, waiting approval, recovering, offline, blocked, and unknown agents. Test `Tab`, `Enter`, and `Escape`; assert the selected attempt’s durable receipt and physical invocation appear in Run Inspector.

- [ ] **Step 2: Run the focused project test and verify constellation/workstream controls are absent.**

Run: `pnpm exec playwright test tests/ui/project-studio.spec.ts --config playwright.config.ts --grep "ekip koreografisi"`  
Expected: FAIL.

- [ ] **Step 3: Implement compact presence cards and a horizontally scrollable time axis.**

Agent cards expose current action, heartbeat age, attempt number, next wake, and state text. Animate only a newly received persisted handoff path for 480–700 ms. Under reduced motion, replace the path with a static highlight and screen-reader status. Workstream overflow uses a visible scrollbar. Attempt selection uses buttons; desktop details are a persistent non-modal inspector, while narrow screens use a modal Sheet with Escape and trigger-focus restoration.

- [ ] **Step 4: Extend `RunInspector` to accept an optional concrete attempt without breaking its current task-level call sites.**

```ts
type RunInspectorProps = ExistingRunInspectorProps & {
  selectedAttemptId?: string | null;
  selectedAttempt?: AttemptOperationsProjection | null;
};
```

The projection contains the logical execution ID, physical invocation, operation receipt, approval/tool evidence, incident/recovery, and bounded event window for the selected UUID. Display truncation and `Europe/Istanbul` (or API-provided) timezone explicitly. Remove existing “Canlı iz” copy unless the Operations transport/runtime truth is live; polling is labelled `Yenileniyor`.

- [ ] **Step 5: Run project UI, typecheck, and existing run-trace tests.**

Run: `node --import tsx --test artifacts/agentic-company-os/src/lib/run-trace.test.ts`  
Run: `pnpm --filter @workspace/agentic-company-os run typecheck`  
Run: `pnpm exec playwright test tests/ui/project-studio.spec.ts --config playwright.config.ts --grep "ekip koreografisi"`  
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add artifacts/agentic-company-os/src/components/operations artifacts/agentic-company-os/src/components/tasks/run-inspector.tsx artifacts/agentic-company-os/src/lib/run-trace.ts tests/ui/project-studio.spec.ts
git commit -m "feat(ui): visualize durable agent choreography"
```

---

### Task 5: Incidents, recovery, usage, and evidence-backed mission log

**Files:**

- Create: `artifacts/agentic-company-os/src/components/operations/incident-recovery-rail.tsx`
- Create: `artifacts/agentic-company-os/src/components/operations/usage-pulse.tsx`
- Create: `artifacts/agentic-company-os/src/components/operations/mission-log.tsx`
- Create: `artifacts/agentic-company-os/src/components/operations/receipt-reconciliation-dialog.tsx`
- Modify: `tests/ui/project-studio.spec.ts`

**Interfaces:**

- Produces: incident lifecycle, provider route health, attributed usage, tool outcomes, verified milestones, and operator-only unknown-outcome reconciliation.
- Consumes: operations snapshot incident, usage, receipt, route-health, and mission projections.

- [ ] **Step 1: Add failing assertions for an open worker-loss incident, measured recovery, unknown external outcome, invalidated browser approval binding, provider degradation, usage totals, and evidence links.**

Assert that unresolved unknown external outcome is called `Operatör uzlaştırması gerekli`, not retried or shown as recovered. An approved browser action whose runtime/session/epoch/snapshot binding changed is `Yeniden onay gerekli`; the historical approval remains evidence, sensitive payload is absent, and no retry-on-another-worker action exists. Assert cost carries its API-reported/currency context and missing cost displays `Raporlanmadı`, never zero.

- [ ] **Step 2: Run the focused test and verify the rail/log are absent.**

Run: `pnpm exec playwright test tests/ui/project-studio.spec.ts --config playwright.config.ts --grep "olay ve kanıt"`  
Expected: FAIL.

- [ ] **Step 3: Implement incident and recovery rail with semantic status progression.**

Show detected time, cause category, affected task/attempt, elapsed or recovery duration, and outcome. Amber turns to green only after a replacement attempt persisted forward progress. Include text and icon state independent of color.

- [ ] **Step 4: Implement compact usage pulse and evidence-only mission log.**

Mission entries link to the backing attempt, activity, receipt, or health window. Never synthesize celebratory milestones in the browser. Keep animation to one entrance transition per newly persisted mission and disable it under reduced motion.

- [ ] **Step 5: Implement guarded unknown-outcome reconciliation.**

Use `ValidatedForm`/RHF/Zod with the shared AlertDialog, Select, Textarea, Button, and generated reconciliation mutation. Render the action only from server `reconciliationEligible`; never infer a frontend role. Show receipt/effect-boundary evidence, require `confirmed_applied | confirmed_not_applied` plus a non-empty audit note, focus Cancel first, submit pessimistically, and never replay the old receipt. While pending, block duplicate submit and unsafe close. On ordinary failure preserve disposition, note, dialog, and focus. After timeout/session expiry, refetch the receipt before any resubmit; display an already-recorded same decision, reject an opposite/closed decision, and honor 401/403 without losing locally entered evidence. On success announce, show the stable non-secret audit actor, and refetch the scoped attempt/incident projection. `confirmed_applied` renders durable “etki zaten gerçekleşti” continuation evidence; `confirmed_not_applied` states that any later approval-bound execution needs a new logical receipt and new approval.

- [ ] **Step 6: Run focused UI and accessibility checks.**

Run: `pnpm exec playwright test tests/ui/project-studio.spec.ts --config playwright.config.ts --grep "olay ve kanıt"`  
Expected: PASS; reconciliation failure preservation/no-replay assertions pass, and the page has no duplicate IDs, unlabeled controls, or live-region spam.

- [ ] **Step 7: Commit.**

```bash
git add artifacts/agentic-company-os/src/components/operations tests/ui/project-studio.spec.ts
git commit -m "feat(ui): surface recoveries and verified missions"
```

---

### Task 6: Integrate Operations as the project’s truthful default

**Files:**

- Create: `artifacts/agentic-company-os/src/components/operations/project-operations-room.tsx`
- Modify: `artifacts/agentic-company-os/src/components/studio/project-workbench.tsx`
- Create: `artifacts/agentic-company-os/src/components/studio/project-workbench-tabs.tsx`
- Modify: `artifacts/agentic-company-os/src/pages/tasks/detail.tsx`
- Modify: `tests/ui/project-studio.spec.ts`

**Interfaces:**

- Produces: `ProjectOperationsRoom` and a new `operations` workbench tab.
- Consumes: generated project operations query, stream hook, project/members/agents, and all Operations Room sections.

- [ ] **Step 1: Add failing route-level assertions for default-tab rules.**

Active, pending, blocked, and continuous projects open `Operasyon`; completed and cancelled top-level projects open `Teslim`. Subtasks still hide project-only meetings. Selection is URL-backed at `?view=operations`; reload, copied links, Back/Forward, and keyboard selection retain the same valid view and focus.

```ts
await page.goto("/projects/101");
await expect(page.getByRole("tab", { name: "Operasyon" })).toHaveAttribute(
  "aria-selected",
  "true",
);
```

- [ ] **Step 2: Run the default-tab scenario and verify it fails.**

Run: `pnpm exec playwright test tests/ui/project-studio.spec.ts --config playwright.config.ts --grep "varsayılan operasyon"`  
Expected: FAIL.

- [ ] **Step 3: Add the tab and compose `ProjectOperationsRoom`.**

Replace the manual tab implementation with the canonical Radix adapter while keeping Workspace, Plan ve iz, Meetings, Team, and Delivery behavior intact. Query the snapshot on mount, start SSE only after a successful authorized snapshot, expose retry without discarding the last-good data, and show the canonical unavailable state when no snapshot has ever loaded. Resolve the current nested workbench/AppShell vertical scrollers so each active tab has exactly one scroll owner.

- [ ] **Step 4: Make default selection status-aware and stable.**

Parse and validate `?view=` on each project navigation. When it is absent, compute the initial tab from project status and replace the URL once. Do not steal the user’s current tab when a live status update arrives; switch defaults only on a new project navigation. Unknown values fall back to `workspace` without breaking route history.

- [ ] **Step 5: Run project studio, release smoke, typecheck, and production build.**

Run: `pnpm --filter @workspace/agentic-company-os run typecheck`  
Run: `pnpm --filter @workspace/agentic-company-os run build`  
Run: `pnpm exec playwright test tests/ui/project-studio.spec.ts tests/ui/release-smoke.spec.ts --config playwright.config.ts`  
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add artifacts/agentic-company-os/src/components/operations/project-operations-room.tsx artifacts/agentic-company-os/src/components/studio/project-workbench.tsx artifacts/agentic-company-os/src/components/studio/project-workbench-tabs.tsx artifacts/agentic-company-os/src/pages/tasks/detail.tsx tests/ui/project-studio.spec.ts tests/ui/release-smoke.spec.ts
git commit -m "feat(ui): make operations the active project home"
```

---

### Task 7: Global cross-project command center

**Files:**

- Create: `artifacts/agentic-company-os/src/components/operations/fleet-status.tsx`
- Create: `artifacts/agentic-company-os/src/components/operations/project-health-grid.tsx`
- Create: `artifacts/agentic-company-os/src/components/operations/global-operations-feed.tsx`
- Modify: `artifacts/agentic-company-os/src/pages/activity.tsx`
- Modify: `artifacts/agentic-company-os/src/App.tsx`
- Modify: `artifacts/agentic-company-os/src/components/layout/app-shell.tsx`
- Modify: `artifacts/agentic-company-os/src/components/command-palette.tsx`
- Modify: `tests/ui/release-smoke.spec.ts`

**Interfaces:**

- Produces: global worker fleet, queue age, project health cards, incident summary, and durable global event feed.
- Consumes: generated operations overview/instances queries and the Task 2 tagged global stream; without authorized global SSE it explicitly falls back to polling/manual refresh.

- [ ] **Step 1: Add failing release-smoke assertions for truthful title, worker lifecycle, oldest queue age, incident count, per-project health, and project-isolated links.**

The scheduler-disabled fixture must not contain `canlı akış`. The page/sidebar/command-palette label and document title become `Operasyonlar`; `/operations` is canonical and legacy `/activity` redirects without losing query state. Test programmatic focus destination, one `main`/`h1`, stable loading/error/403 titles, global stream authorization, and project-isolated frames.

- [ ] **Step 2: Run the release smoke scenario and verify the command center is absent.**

Run: `pnpm exec playwright test tests/ui/release-smoke.spec.ts --config playwright.config.ts --grep "operasyon merkezi"`  
Expected: FAIL.

- [ ] **Step 3: Replace the flat feed composition with the command center.**

Keep filters as a secondary event-feed control. The first viewport contains runtime truth, fleet instances, oldest due work, project cards, and active incident count. Each project card links to `/projects/:id` and has its own accessible name; never render meeting/chat content globally.

- [ ] **Step 4: Add explicit loading, partial, empty, stale, unauthorized, and disconnected states.**

If overview succeeds but instances fail, retain the overview and mark fleet unavailable. If SSE disconnects or is unauthorized, keep snapshot data with age and explicit polling/manual-refresh state. Surface bounded-window/truncation limits and explicit timezone. A 403 has a named inline state and no restricted actions. No global green indicator may depend on the old five-second activity polling loop; remove or relabel legacy “canlı akış”/“Canlı iz” polling copy.

- [ ] **Step 5: Run responsive UI, typecheck, and build.**

Run: `pnpm --filter @workspace/agentic-company-os run typecheck`  
Run: `pnpm --filter @workspace/agentic-company-os run build`  
Run: `pnpm exec playwright test tests/ui/release-smoke.spec.ts --config playwright.config.ts --grep "operasyon merkezi"`  
Expected: PASS at desktop and the spec’s mobile viewport.

- [ ] **Step 6: Commit.**

```bash
git add artifacts/agentic-company-os/src/components/operations artifacts/agentic-company-os/src/pages/activity.tsx artifacts/agentic-company-os/src/App.tsx artifacts/agentic-company-os/src/components/layout/app-shell.tsx artifacts/agentic-company-os/src/components/command-palette.tsx tests/ui/release-smoke.spec.ts
git commit -m "feat(ui): turn activity into operations command center"
```

---

### Task 8: Frontend quality gates and visual QA

**Files:**

- Modify: `tests/ui/project-studio.spec.ts`
- Modify: `tests/ui/release-smoke.spec.ts`
- Modify: `README.md`
- Maintain: `DESIGN.md`
- Maintain: `UX-CONTRACT.md`
- Maintain: `premium-ui.json`

**Interfaces:**

- Produces: durable browser coverage for operations truth, accessibility, responsive layout, and reduced motion.
- Consumes: all frontend work in this plan.

- [ ] **Step 1: Complete network fixtures for all new snapshot and SSE routes.**

Use deterministic timestamps and an SSE route fixture that emits snapshot, handoff, incident, recovery, and heartbeat frames. Add strict fixtures for overview, instances, project snapshot, bounded attempts/incidents/milestones, stream authorization, and reconciliation. Assert no unhandled request, console error, page error, failed resource, duplicate ID, or unlabeled icon control.

- [ ] **Step 2: Add keyboard, reduced-motion, and narrow-screen acceptance checks.**

At 320 px, 390 px, and a short-height mobile viewport, assert `document.documentElement.scrollWidth <= window.innerWidth`, one vertical scroll owner, and a visible keyboard-reachable horizontal workstream scrollbar. Under `reducedMotion: "reduce"`, assert no indicator has an infinite animation and all state text remains visible. Exercise URL-backed tablist arrows/Home/End, reload/Back/Forward, `/activity` query-preserving redirect/title/focus, loading/error/403 titles and landmarks, attempt selection, mobile Sheet close/focus restore, reconciliation timeout-refetch/session-expiry/failure preservation/duplicate blocking, Select-in-AlertDialog plus Toast layering, and project links.

- [ ] **Step 3: Run targeted UI repeatedly to catch reconnect/timer flakiness.**

Run: `pnpm exec playwright test tests/ui/project-studio.spec.ts tests/ui/release-smoke.spec.ts --config playwright.config.ts --repeat-each=3`  
Expected: PASS three consecutive runs.

- [ ] **Step 4: Run a normal-motion persisted handoff scenario.**

Use a dedicated Playwright project/test override with `reducedMotion: "no-preference"`. Emit one persisted handoff, assert the bounded 480–700 ms transition starts once and settles, and confirm no motion appears for a synthetic/non-persisted client event.

- [ ] **Step 5: Run frontend and generated-client gates.**

Run: `pnpm --filter @workspace/api-spec run codegen`  
Run: `pnpm --filter @workspace/agentic-company-os run typecheck`  
Run: `pnpm --filter @workspace/agentic-company-os run build`  
Run: `pnpm exec playwright test tests/ui/project-studio.spec.ts tests/ui/release-smoke.spec.ts --config playwright.config.ts`  
Expected: PASS.

- [ ] **Step 6: Run the premium UI gate, line triage, and reconcile the drift ledger.**

Run the configured formatter, typecheck, unit, build, and e2e commands from `premium-ui.json`. Then run the premium auditor in report mode and fix every real Operations/touched-file violation. Run strict mode as evidence, but interpret its exit against the manifest's exact known limitations: auditor v1 lowercases JSX component names and can falsely classify shared Button/Textarea/Select. Do not game the gate with redundant props or false ownership. Update `DESIGN.md` with actual remaining real legacy and known false-positive counts; do not mark unrelated debt resolved.

- [ ] **Step 7: Inspect the running product in Chromium at desktop and mobile dimensions.**

Verify project Operations Room, global command center, local-demo truth, live -> stale -> disconnected with last-good age, recovery incident, selected attempt -> receipt/invocation evidence, reconciliation, completed-project default, light/dark contrast, 320px/390px layout, keyboard focus, visible scrollbar, normal motion, and reduced-motion behavior. Record screenshots only as QA evidence; do not add binary artifacts to Git unless documentation explicitly references them.

- [ ] **Step 8: Document the surface and commit.**

```bash
git add tests/ui/project-studio.spec.ts tests/ui/release-smoke.spec.ts README.md DESIGN.md UX-CONTRACT.md premium-ui.json
git commit -m "test(ui): verify operations room experience"
```

## Completion Gate

This plan is complete only when the UI never calls an unverified local process “live,” every active project opens on URL-restorable Operations, every project member has a truthful seven-state presence, SSE loss preserves and ages last-good evidence, selected attempts resolve to durable invocation/receipt evidence, unknown outcomes have a guarded no-replay reconciliation path, bounded windows/timezones are explicit, light/dark contrast and one-scroll-owner rules pass, keyboard/normal-motion/reduced-motion/320px tests pass, the premium report has zero unresolved owners and zero real touched-scope violations (with any strict failure limited to the exact documented auditor defect), and the global command center remains project-isolated.
