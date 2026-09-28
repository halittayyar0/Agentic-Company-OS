# Product Studio V2

## Product thesis

Agentic Company OS is a self-hosted product studio for solo founders and small
product teams. Its single primary job is to turn one goal into a traceable,
reviewable and runnable result without hiding the work behind a generic chat.

The main product object is a project. Agents are specialists inside the project
workflow, not the top-level navigation model.

```text
Workspace
├─ Home
├─ Projects
├─ Operations
├─ Approvals
├─ Company Room
├─ Team
└─ Connections

Project
├─ Conversation
├─ Meetings
│  ├─ Agenda and participants
│  ├─ Transcript
│  └─ Decisions and action items
├─ Plan
├─ Workbench
│  ├─ Preview / Browser
│  ├─ Terminal
│  └─ Files
├─ Operations
│  ├─ Team and workstreams
│  ├─ Attempts and durable receipts
│  └─ Incidents and verified recovery
├─ Evidence
├─ Decision log
├─ Versions
└─ Export / Deploy
```

## Clean-room boundary

Atoms is a product benchmark, not a source repository or asset library. This
project does not copy Atoms source code, trademarks, character art, screenshots,
marketing copy or proprietary layouts. It adopts only general product patterns
observed in public first-party materials: project-centered work, persistent
conversation beside a live work surface, specialist handoffs, explicit human
approval, responsive preview and code ownership.

All implementation, naming, visual tokens, interaction details and copy in this
repository remain original and MIT-licensed.

## Audience and core loop

The primary audience is a founder, operator or small product team that needs a
working product or business result but still wants ownership, observability and
control.

1. Describe the outcome on Home.
2. Choose Team, Engineer, Research or Compare mode.
3. Start a durable project with the full active specialist team; coordination is
   an operational detail rather than a single-agent choice at creation time.
4. Review the proposed plan and any consequential approvals.
5. Watch work in the project workbench while agents hand off evidence.
6. Refine through the project conversation or convene a project meeting.
7. Keep meeting decisions and action items in that project's memory.
8. Verify the result and export or deploy it.
9. Continue operating the project after the first release.

## Visual direction

The visual concept is an editorial workbench: spacious and calm at the moment
of intent, precise and instrument-like inside a running project.

`DESIGN.md` and the runtime variables in
`artifacts/agentic-company-os/src/index.css` are the canonical design contract.
This section is a product-level summary and must not establish a second token
owner.

### Tokens

- Warm Canvas — `#F6F5F3` light / `#202020` dark
- Working Paper — `#FDFDFC` light / `#181818` dark
- Editorial Ink — `#201F1D` light / `#F0F0F0` dark
- Signal Violet — `#665BAE` light / `#ADA8DC` dark
- Verified Jade — `#138B63` light / `#67C1A1` dark
- Attention Amber — `#C47908` light / `#E0AD67` dark
- Rule — semantic `--border` for each mode

IBM Plex Serif is reserved for rare editorial statements; IBM Plex Sans carries
the interface; machine evidence uses a bundled open-source mono face or the
declared system fallback. Dark mode is the product default, with a
contrast-tested light mode rather than an inverted afterthought.

### Signature: handoff spine

Every project shows a compact, truthful sequence of stages:

```text
Niyet → Plan → Ekip → Üretim → Doğrulama → Teslim
```

Each stage is derived from real task and activity data. It shows the accountable
agent, current state and evidence count. It is navigation and progress context,
not decorative numbering.

Inside Operations this spine closes into **Nöbet İzi**, a 24-hour ring composed
only from persisted minute samples. Amber notches identify incidents, jade marks
verified recovery, and missing windows remain visibly unknown. It never infers
health from an open browser tab or decorative animation.

## Project workspace

Desktop uses a focused split surface:

```text
┌ project header · state · actions ──────────────────────────────┐
│ handoff spine                                                   │
├ conversation 340 px ┬ project surface                          │
│ project-only history │ Operations · Workbench · Plan · Meetings │
│ agent mentions       │                                         │
│ prompt composer      │ contextual plan/evidence drawer          │
└──────────────────────┴─────────────────────────────────────────┘
```

On mobile the workbench comes first and the project-only conversation follows
as a dedicated panel in the same reading flow. The compact global navigation
remains available through the mobile menu and no horizontal page scroll is
permitted.

### Project meetings

A meeting is never a global activity stream entry masquerading as a durable
object. It belongs to exactly one root project, has an explicit agenda and
participant roster, and persists its own transcript, summary, decisions and
action items. Opening another project must never reveal the first project's
meetings. The project page is the only place meetings are created and read.

Participants are not capped by an arbitrary product limit. Runtime work is
still protected with bounded concurrency, leases, emergency-stop checks and
usage accounting. A selected participant speaks in their own identity and may
not claim another agent's work.

### Company Room

The Company Room is a durable group conversation, not a broadcast fan-out. Its
membership is independent from the number of responses to any one message:

- the founder can add any active agent to the room without a four-person UI
  cap;
- an explicit `@mention` routes the turn only to the mentioned members;
- without a mention, routing considers the room membership and only agents
  with a relevant contribution answer;
- every stored response records its real sender and the founder message it
  replies to;
- routing is bounded and fail-closed, but membership is not silently truncated;
- a Company Room message may link to a project, while meetings remain inside
  that project's own history.

## Backend contract additions

The existing root task remains the durable project record for compatibility.
This avoids a destructive migration while the project domain grows.

First additions:

- project-scoped agent messages via optional `taskId`;
- isolated conversation history per project;
- project-scoped meeting, participant and transcript records;
- project meeting decisions and action items as durable evidence;
- durable Company Room membership and mention-aware routing;
- relevance-gated group responses rather than unconditional fan-out;
- task-aware agent leases, tool activity and usage accounting;
- project workbench composition from the owner agent's existing browser,
  terminal and file workspace;
- configurable OpenRouter, direct OpenAI and local Ollama provider adapters;
- provider-aware model catalog, connection health and redacted connection
  settings;
- generated API types and tests for the new scope.

Later additions:

- project artifacts and immutable versions;
- export manifests and deploy adapters;
- project members and role-based collaboration;
- connector registry with explicit capability and approval contracts.

## Quality gates

The V2 milestone is not complete until all of the following pass on current
source:

- frontend and backend typecheck;
- production build under the pinned Node and pnpm versions;
- unit and integration tests;
- desktop and mobile project-workspace browser tests;
- light and dark visual QA;
- keyboard and reduced-motion checks;
- cross-project meeting isolation and participant validation checks;
- Company Room membership, mention routing and no-forced-reply checks;
- secret-boundary and API-contract regression checks;
- open-source setup from `.env.example` without proprietary infrastructure.
