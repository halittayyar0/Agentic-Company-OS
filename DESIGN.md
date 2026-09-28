---
version: alpha
name: "Agentic Company OS"
description: "A calm, readable operations workspace for supervising durable multi-agent work."
colors:
  primary: "#1A5BBC"
  primary-dark: "#88BAFB"
  canvas-light: "#F5F7FA"
  canvas-dark: "#121821"
  paper-light: "#FFFFFF"
  paper-dark: "#1A222E"
  ink-light: "#192334"
  ink-dark: "#F1F5F8"
  verified-light: "#138B63"
  verified-dark: "#67C1A1"
  verified-text-light: "#0B6848"
  attention-light: "#C47908"
  attention-dark: "#E0AD67"
  attention-text-light: "#815000"
  destructive-light: "#BE2727"
  destructive-dark: "#D74242"
typography:
  sans:
    fontFamily: '"IBM Plex Sans Variable", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
  serif:
    fontFamily: '"IBM Plex Sans Variable", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
  mono:
    fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace'
rounded:
  control-sm: "0.625rem"
  control: "0.75rem"
  panel: "1rem"
  feature: "1.5rem"
spacing:
  unit: "0.25rem"
  shell-width: "17.375rem"
  topbar-height: "4rem"
  page-max: "93.75rem"
  operations-max: "105rem"
components:
  theme-canvas-light:
    backgroundColor: "{colors.canvas-light}"
    textColor: "{colors.ink-light}"
  theme-canvas-dark:
    backgroundColor: "{colors.canvas-dark}"
    textColor: "{colors.ink-dark}"
  surface-paper-light:
    backgroundColor: "{colors.paper-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.panel}"
  surface-paper-dark:
    backgroundColor: "{colors.paper-dark}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.panel}"
  button-primary-light:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.control}"
  button-primary-dark:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.paper-dark}"
    rounded: "{rounded.control}"
  status-verified-light:
    backgroundColor: "{colors.paper-light}"
    textColor: "{colors.verified-text-light}"
  status-verified-dark:
    backgroundColor: "{colors.paper-dark}"
    textColor: "{colors.verified-dark}"
  status-attention-light:
    backgroundColor: "{colors.paper-light}"
    textColor: "{colors.attention-text-light}"
  status-attention-dark:
    backgroundColor: "{colors.paper-dark}"
    textColor: "{colors.attention-dark}"
  status-icon-verified-light:
    textColor: "{colors.verified-light}"
  status-icon-attention-light:
    textColor: "{colors.attention-light}"
  action-destructive-light:
    textColor: "{colors.destructive-light}"
  action-destructive-dark:
    textColor: "{colors.destructive-dark}"
  scrollbar:
    backgroundColor: "color-mix(in srgb, {colors.ink-light} 28%, transparent)"
    size: "0.625rem"
---

# Agentic Company OS — Design System

- **Status:** Accepted product contract
- **Last updated:** 2026-09-26
- **Applies to:** `artifacts/agentic-company-os`

## Product direction

Agentic Company OS is a calm operations workspace: a clear place to state intent and an exact instrument when autonomous work is live. The interface should feel like a professional team room, not a chatbot, terminal, game, or decorative NOC dashboard.

The visual promise is simple:

1. Operational truth is the decoration. Durable attempts, leases, receipts, incidents, recoveries, owners, and timestamps may create visual interest; invented “live” activity may not.
2. Projects are the primary unit of work. Meetings, conversations, agents, attempts, evidence, and approvals remain visibly scoped to their project.
3. Dense evidence is allowed, but decisions stay obvious. The operator should answer “çalışıyor mu, kim çalışıyor, ne bekliyor, ne bozuldu, ne zaman toparlandı?” before reading raw telemetry.
4. Human control remains visible around side effects. Approval, emergency stop, and unknown-outcome reconciliation never disappear behind optimistic UI.

## Visual north star

Cool neutral layers, an ink-colored dark canvas, one blue command signal, semantic status colors, and generous empty space around the next important decision. All major statements, controls, and evidence use a readable sans hierarchy; mono remains reserved for IDs and machine data. CJK and Arabic glyphs fall back to platform fonts.

The default mode follows the operating system. Light and dark modes share the same information structure and are checked independently.

### Anti-references

- No neon cyber/NOC treatment, purple fog, glass stacks, decorative grid overload, or fake scanners.
- No fake green “live” dot. “Canlı” is shown only when transport and backend runtime truth both support it.
- No card around every subsection, deeply nested rounded panels, or one-off radii.
- No arcade badges, streak counters, confetti, wandering agent avatars, or motion unsupported by durable events.
- No raw terminal aesthetic as the primary presentation of operator decisions.
- No direct copying of Atoms branding, assets, copy, or proprietary layout. We adapt the project-first workflow cleanly into this product system.

## Token ownership

This repository uses **Model B** token ownership:

`src/index.css semantic CSS variables -> Tailwind v4 @theme aliases -> shared UI primitives -> product screens`

This file mirrors and explains accepted values. It does not generate runtime tokens. `src/lib/theme.ts` may select the saved theme and color mode, but it must not override mode-sensitive colors inline. Any token change must update `src/index.css`, this file, affected shared components, and tests in the same changeset.

- **Canonical runtime source:** `artifacts/agentic-company-os/src/index.css`
- **Mode selector:** `artifacts/agentic-company-os/src/lib/theme.ts`
- **Interaction ownership:** `UX-CONTRACT.md`
- **Machine-readable audit map:** `premium-ui.json`

## Color system

Six palette roles carry the product identity. Destructive red remains a safety semantic, not a brand color.

| Role            | Runtime token  |     Light |      Dark | Use                                   |
| --------------- | -------------- | --------: | --------: | ------------------------------------- |
| Cool Canvas     | `--background` | `#F5F7FA` | `#121821` | App and route background              |
| Working Paper   | `--card`       | `#FFFFFF` | `#1A222E` | Panels, inspectors, dialogs           |
| Clear Ink       | `--foreground` | `#192334` | `#F1F5F8` | Primary text and icons                |
| Command Blue    | `--primary`    | `#1A5BBC` | `#88BAFB` | Primary command, selection, focus     |
| Verified Jade   | `--verified`   | `#138B63` | `#67C1A1` | Verified recovery/success only        |
| Attention Amber | `--attention`  | `#C47908` | `#E0AD67` | Waiting, degraded, incident attention |

Additional semantic rules:

- Destructive uses `--destructive` (`#BE2727` light, `#D74242` dark) only for danger, denied safety state, and irreversible intent.
- `primary-foreground` must preserve WCAG AA contrast against `primary` in both modes. The light pair is `#1A5BBC` with white; the dark pair is `#88BAFB` with near-black.
- Light-mode state text uses `--verified-foreground: #0B6848` and `--attention-foreground: #815000`; the brighter palette signals remain chart/icon accents and borders. Dark-mode state text may use `#67C1A1` and `#E0AD67` directly. Verified/attention controls use soft semantic surfaces, not inaccessible solid light-mode fills.
- `--verified-border` is `#138B63` light / `#67C1A1` dark; `--attention-border` is `#C47908` light / `#E0AD67` dark. Runtime components may apply alpha to these named borders but may not substitute raw utilities.
- Raw emerald/amber/rose/black/white utilities are not allowed in new product screens when a semantic token exists.
- Charts inherit these semantic roles. Hue alone never communicates status; label, icon, shape, or text accompanies it.

## Typography

| Role              | Family                 | Weight/size guidance | Use                                                        |
| ----------------- | ---------------------- | -------------------- | ---------------------------------------------------------- |
| Editorial display | IBM Plex Sans Variable | 650; 28–52px         | Home proposition, project outcome, rare major statements   |
| Interface         | IBM Plex Sans Variable | 400–650; 12–20px     | Navigation, controls, prose, headings                      |
| Evidence          | IBM Plex Mono          | 500–600; 10–12px     | Attempt IDs, durations, timestamps, receipt/state evidence |

IBM Plex Sans and Serif remain bundled locally. The evidence face must be a bundled open-source IBM Plex Mono asset before relying on it for brand-specific rendering; until then the declared system mono fallback is acceptable but tracked as drift. Uppercase and wide tracking are reserved for terse machine labels, never paragraphs.

## Geometry and spacing

- Foundation unit: 4px.
- Standard spacing steps: 4, 8, 12, 16, 24, 32, 48px.
- Controls: 10–12px radius.
- Standard panels: 16px radius.
- One featured project/operations frame per view may use 24px.
- Full pills are limited to compact state, count, or avatar indicators.
- Existing app shell remains 278px wide with a 64px top bar on desktop.
- Ordinary route content is capped at 1500px. Project and Operations workspaces may reach 1680px.

## Surfaces and elevation

The system is border-first. Ordinary cards and panels have no shadow. The only accepted depth tokens are `--shadow-raised: 0 12px 32px -24px rgb(0 0 0 / 0.45)` for a floating inspector/popover and `--shadow-overlay: 0 24px 70px -32px rgb(0 0 0 / 0.72)` for dialogs/sheets. Screen-level arbitrary shadows are drift.

Layer ownership is explicit and centralized:

| Layer                  | Token          | Value |
| ---------------------- | -------------- | ----: |
| Dropdown/menu          | `--z-dropdown` |    40 |
| Popover/tooltip/select | `--z-popover`  |    45 |
| Modal backdrop         | `--z-backdrop` |    50 |
| Dialog/alert dialog    | `--z-dialog`   |    60 |
| Sheet/mobile inspector | `--z-sheet`    |    60 |
| Command palette        | `--z-command`  |    70 |
| Toast viewport         | `--z-toast`    |    80 |

Canvas and paper remain in normal document flow. A component consumes these tokens; it does not invent another `z-50`. Select-in-dialog, tooltip-in-sheet, and toast-over-dialog stacking are browser-tested with focus still owned by the active modal.

## Motion

- Controls and disclosure: 160–200ms.
- Evidence-backed handoff or recovery transition: 480–700ms.
- Status pulse: at most 1.8s and only while a real bounded state is active.
- No infinite scanner, ticker, or animation used to imply agent activity.
- `prefers-reduced-motion` removes non-essential animation without removing timestamps, labels, notches, selection, or focus feedback.

## Responsive composition

Operations begins with runtime truth and a six-metric summary. The summary uses two columns on phones and six on wide screens. Project team lanes precede the health and mission history; the desktop attempt inspector remains beside the attempt ledger. Mobile order is truth -> team -> health/mission history -> attempt timeline -> receipts. The active project tab owns one vertical scroll surface; nested vertical workbench scrollers are prohibited.

At 320px, primary actions remain reachable, icon controls retain labels, long IDs wrap or truncate with an accessible full value, and horizontal workstream/timeline overflow uses a visible, keyboard-reachable scrollbar.

The canonical scrollbar is 10px on both axes. Its track is transparent; its
thumb is `color-mix(in srgb, var(--foreground) 28%, transparent)`, rising to
42% on hover and focus-within, with a 3px transparent inset border and
`background-clip: content-box`. The app-shell scroll owner uses
`scrollbar-gutter: stable`; horizontal evidence lanes use `overflow-x: auto`,
a visible thumb, and `tabindex="0"` with an accessible label. Product screens
may not hide a native scrollbar or create a second vertical scroll owner.

## Signature element: Nöbet İzi

The existing six-stage handoff spine is the linear form of the product’s signature. In Operations it forms a 24-hour window of persisted minute samples:

- amber notches mark incidents or degraded intervals;
- jade marks healthy samples, while complete coverage is a separate fact;
- selecting a segment filters the associated attempts;
- labels and timestamps expose the exact state behind every segment;
- reduced-motion mode presents fixed notches and the same evidence.

The ring never invents missing samples, interpolates “healthy,” or equates an open browser tab with runtime life. Missing windows render explicitly as unavailable. Full sample coverage is not a real 24-hour endurance certificate. Fleet samples remain labeled as fleet evidence inside a project.

## Component conventions

### Guided start and expert directory

The home page is a working desk: a left-aligned outcome composer, editable
examples, and a narrow three-step guide. Steps explain the actual sequence
(describe, coordinate, review); they never imply a project has already run.
Team counts come from the active roster. Expert cards describe their concrete
contribution, with status and a profile link. The directory uses the same
paper, border, type, and control tokens as project surfaces.

Expert creation starts with a role and identity. Model selection, custom
instructions, and permissions live in a disclosure so first-time users can
start with the template's established defaults. The maintained Button,
Textarea, SearchInput, and ValidatedForm own interaction and field behavior.
Color modes are selected by classes only; legacy inline color overrides are
removed. Reduced motion disables transitions completely, avoiding delayed
inherited text colors during theme changes.

- Extend canonical shared components before adding a screen-local primitive.
- A busy control preserves its label width, sets `aria-busy`, and blocks duplicate submission.
- Icon-only controls require a visible tooltip and a Turkish accessible name.
- Toasts report bounded user mutation results. Runtime health, incidents, stale data, and connection state stay inline and persistent.
- Loading skeletons match final geometry. Empty, filtered-empty, partial, unauthorized, stale, and disconnected are different states.
- Desktop attempt details are a non-modal persistent inspector; mobile details use a focus-trapped Sheet with Escape and focus restoration.

## Operations information hierarchy

1. Truth strip: runtime enabled, leader/lease health, useful work, blockers, last verified recovery.
2. Project-scoped team and workstream lanes.
3. Incident/recovery rail with severity and ownership.
4. Attempt timeline and Nöbet İzi.
5. Selected attempt inspector: durable attempt, invocation, operation receipt, approval, tools, usage, and audit evidence.

Transport state (`disabled`, `connecting`, `live`, `stale`, `disconnected`) is displayed separately from backend operational state. The last known good snapshot remains visible with its age when transport degrades.

## Accessibility baseline

- WCAG 2.2 AA contrast for text, controls, focus, and meaningful status.
- Global 2px focus outline with 2px offset; focus is never removed without an equivalent.
- Keyboard operation and visible focus for tabs, workstream overflow, inspectors, dialogs, and reconciliation.
- Semantic landmarks and one page-level `h1` per route.
- Status never depends on color or animation alone.
- The setup shell, operator sign-in, navigation, and workspace agent-language preference support `tr`, `en`, `de`, `ru`, `zh-CN`, `zh-TW`, and `ar`; Arabic uses RTL. Deeper route copy is still being localized and must be reviewed before claiming complete translations. Date/time evidence always names the effective timezone.

## Drift ledger

| ID   | Drift                                                                                                       | Required resolution                                                                                                                              | Status                        |
| ---- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| D-01 | `theme.ts` overwrote light `--primary` with a dark-mode value, producing insufficient white-text contrast   | Theme clears legacy inline values; CSS owns both modes. Browser regression checks light card text and surface colors.                            | Resolved 2026-09-04           |
| D-02 | `docs/product-studio-v2.md` described the retired light/blue direction                                      | Mark this document and runtime tokens canonical; reconcile old spec                                                                              | Resolved 2026-09-01           |
| D-03 | Screen-level hardcoded shadows conflict with no-shadow tokens                                               | Replace with central raised/overlay elevation only                                                                                               | Open — staged migration       |
| D-04 | One-off radii from 9px through 28px                                                                         | Migrate touched surfaces to control/panel/feature vocabulary                                                                                     | Open — staged migration       |
| D-05 | Hundreds of raw semantic color utilities                                                                    | Replace in every touched workflow; track remaining count                                                                                         | Open — staged migration       |
| D-06 | Evidence mono face is not bundled                                                                           | Add IBM Plex Mono or explicitly retain generic fallback                                                                                          | Open — foundation task        |
| D-07 | Scrollbars are hidden/scoped inconsistently                                                                 | Global standards-based scrollbar plus WebKit fallback; shell has stable gutter and legacy hiding utilities are removed.                          | Resolved for global baseline  |
| D-08 | Manual project tabs and nested route/workbench scrolling                                                    | Move to canonical Radix tabs, URL state, one scroll owner                                                                                        | Open — Operations integration |
| D-09 | “Canlı” labels are backed by polling instead of transport/runtime truth                                     | Use Operations stream state or remove claim                                                                                                      | Open — Operations integration |
| D-10 | No visual/contrast regression gate                                                                          | Add token/a11y checks plus desktop/mobile browser evidence                                                                                       | Open — verification task      |
| D-11 | Premium auditor lowercases some JSX component names, producing known Button/Textarea/Select false positives | Keep full report plus exact rule/file/line fingerprints; any moved or new result requires fresh source review, and redundant props are forbidden | Open — tooling limitation     |

Changes must update this table rather than creating an untracked parallel design list.

The 2026-09-04 source review records 19 JSX auditor false positives in
`premium-ui.json`. The full strict audit still reports 17 legacy contract
findings: eight form boundaries, six resizable textareas, two native selects,
and the command canvas scrollbar override. Their scope and validation evidence
are recorded in `docs/frontend-ux-2026-09-04.md`; global baseline work does not
claim these legacy workflows have migrated.

These exact file/line fingerprints predate the 2026-09-26 layout and typography sweep; rerun and review the premium audit before using them as current release evidence.
