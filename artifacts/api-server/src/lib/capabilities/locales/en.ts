import type { CatalogLocale } from "../catalog-types";
export const en: CatalogLocale = {
  copy: {
    title: "Skills & tools",
    intro:
      "Start with a clear structure. Review the inputs and adapt a skill to your project.",
    search: "Search skills",
    all: "All areas",
    empty: "No skills match this search.",
    skills: "Work skills",
    tools: "Built-in tools",
    inputs: "Inputs to provide",
    steps: "Procedure",
    checks: "Before delivery",
    deliverable: "Expected result",
    use: "Create project draft",
    requirements: "Tools and access",
    browser: "Browser access",
    files: "Workspace file access",
    boundary:
      "Skills are working guides, not permissions or guarantees. Ask for missing inputs. Follow the operator's scope and existing approval rules. Do not install, spend, publish or contact others without authorization. Report unavailable tools and unverified results. Review this draft before starting.",
    toolBoundary:
      "These tools process supplied data locally. They do not open files, access the network or add a subscription. Agent model usage still follows your provider settings.",
    error: "The skill library could not be loaded.",
    retry: "Try again",
    loading: "Loading skill library…",
    invalid:
      "The tool input is invalid or exceeds its limits. Check the tool schema and supplied data.",
    completed: "Tool result",
    skillMissing: "This built-in skill could not be found.",
  },
  groups: {
    research: {
      title: "Research",
      inputs: [
        "Question, audience, decision and date range.",
        "Allowed sources, exclusions and available browser access.",
      ],
      steps: [
        "Clarify the question and record inclusion criteria before collecting evidence.",
        "Open primary sources where available; record URLs, dates, quotations and uncertainty separately.",
        "Compare independent evidence, flag contradictions and separate observed facts from inference.",
      ],
    },
    engineering: {
      title: "Software",
      inputs: [
        "Repository or relevant files, target behavior and reproduction steps.",
        "Runtime constraints, available file access and authorized test commands.",
      ],
      steps: [
        "Inspect the relevant implementation and contracts before proposing changes.",
        "Trace inputs, failure states and permissions; collect a minimal reproduction or exact code evidence.",
        "Prioritize findings by impact, propose a bounded fix and specify verification and rollback. Do not claim unrun tests passed.",
      ],
    },
    data: {
      title: "Data & analysis",
      inputs: [
        "CSV/JSON/text data, field definitions, units and period.",
        "Question, expected population and rules for missing or duplicate data.",
      ],
      steps: [
        "Inspect the supplied data's structure, size and provenance; retain the original.",
        "Measure missing values, duplicates and inconsistent types before calculating; disclose exclusions and denominators.",
        "Recompute key totals with tools, label units and rounding, and distinguish evidence from assumptions.",
      ],
    },
    content: {
      title: "Documents & content",
      inputs: [
        "Source material, audience, language, tone and required format.",
        "Approved facts, length limit and publication constraints.",
      ],
      steps: [
        "Extract the approved facts and outline the audience's actual information needs.",
        "Produce the requested draft with clear headings; preserve names, figures and source meaning.",
        "Compare the draft against its sources, check consistency and mark unanswered questions. Deliver a draft for review.",
      ],
    },
    operations: {
      title: "Operations",
      inputs: [
        "Objective, current process, owners, deadlines and time zones.",
        "Dependencies, available resources, constraints and approval boundaries.",
      ],
      steps: [
        "Map the current state and ask for missing owners or critical constraints.",
        "Break work into observable actions with owners, dependencies and explicit completion conditions.",
        "Check timing and risks, include escalation and recovery steps, and leave external commitments for authorized review.",
      ],
    },
  },
  checks: [
    "Every factual claim has a source or is explicitly marked as an assumption; preserve unresolved gaps.",
    "Check the expected result against the supplied inputs. List what was checked, what failed and what remains unverified.",
  ],
  skills: [
    [
      "Source-backed brief",
      "Deliver a concise answer with a source table, dates, confidence limits and the next decision.",
    ],
    [
      "Competitor map",
      "Compare named competitors by audience, offering, verifiable features and dated pricing; mark missing evidence.",
    ],
    [
      "Claim verification",
      "Deliver a claim-by-claim table with supporting and conflicting evidence, source dates and an uncertainty verdict.",
    ],
    [
      "Product comparison",
      "Build a requirements-weighted comparison with dated sources, disqualifiers and explicit trade-offs.",
    ],
    [
      "Literature map",
      "Map relevant papers by question, method, sample, findings and limitations; distinguish reviews from original studies.",
    ],
    [
      "Interview plan",
      "Draft non-leading interview questions, a recruitment profile, consent notes and a synthesis template; do not contact participants.",
    ],
    [
      "Code review",
      "Deliver prioritized findings with file locations, concrete failure scenarios and targeted fixes; separate verified defects from questions.",
    ],
    [
      "Bug triage",
      "Produce a reproducible bug report with expected versus actual behavior, evidence, probable causes and a minimal verification plan.",
    ],
    [
      "Test plan",
      "Map critical behaviors to normal, boundary and failure tests with fixtures and measurable pass conditions.",
    ],
    [
      "API contract review",
      "Compare request and response contracts, authentication, error handling and pagination; list breaking changes with examples.",
    ],
    [
      "Release readiness",
      "Produce a release checklist with passing, failing and unrun gates, artifact identity, rollback instructions and remaining blockers.",
    ],
    [
      "Dependency review",
      "Inventory dependencies and versions, direct and transitive scope, license evidence and update risks; do not invent vulnerability findings.",
    ],
    [
      "CSV quality report",
      "Report header issues, missing cells, ragged rows, duplicate values and numeric ranges; provide correction rules without changing the source.",
    ],
    [
      "JSON structure audit",
      "Inspect JSON types, required fields and selected pointers; report missing paths and contract mismatches with bounded examples.",
    ],
    [
      "Metric report",
      "Calculate explicitly defined metrics with units, denominators, periods and reproducible totals; distinguish missing values from zero.",
    ],
    [
      "Data dictionary",
      "Document each field's meaning, type, unit, allowed values, provenance and unresolved ambiguity with source examples.",
    ],
    [
      "Record reconciliation",
      "Compare two supplied datasets by an agreed key; report duplicates, missing records, value mismatches and reconciled totals.",
    ],
    [
      "Experiment analysis",
      "Summarize treatment and control counts, outcome definitions, effect estimates and limitations; do not infer causality without a valid design.",
    ],
    [
      "Document outline",
      "Create an audience-focused outline with key messages, supporting evidence, section goals and unanswered questions.",
    ],
    [
      "Copy editing",
      "Deliver edited copy and a concise change rationale; preserve approved facts, names, numerical meaning and requested tone.",
    ],
    [
      "Translation review",
      "Compare source and translation for meaning, terminology, numbers, placeholders and locale conventions; list uncertain phrases.",
    ],
    [
      "FAQ draft",
      "Draft source-backed answers to likely user questions, identify unsupported answers and include a clear escalation path.",
    ],
    [
      "Changelog draft",
      "Summarize supplied changes by user impact, migration needs and known limitations; avoid claiming undocumented fixes.",
    ],
    [
      "Meeting actions",
      "Extract decisions, action owners, due dates and open questions from supplied notes; mark unassigned work and uncertain dates.",
    ],
    [
      "Project plan",
      "Create milestones, dependencies, owners, acceptance criteria and a realistic risk-aware schedule with stated assumptions.",
    ],
    [
      "Incident review",
      "Build an evidence-backed incident timeline, impact summary, contributing factors and corrective actions with owners.",
    ],
    [
      "Operating runbook",
      "Write prerequisites, numbered steps, observable checks, failure branches, escalation and rollback instructions.",
    ],
    [
      "Risk register",
      "List concrete risks with likelihood rationale, impact, warning signals, owners, mitigation and remaining exposure.",
    ],
    [
      "Process map",
      "Map triggers, inputs, steps, handoffs, decisions, bottlenecks and measurable outputs for the current process.",
    ],
    [
      "Work handoff",
      "Prepare a handoff with current status, evidence links, owners, pending decisions, next actions and recovery instructions.",
    ],
  ],
  tools: [
    ["Find skills", "Find built-in skills by keyword or area."],
    [
      "Read a skill",
      "Load a skill's procedure, inputs and checks by its exact ID.",
    ],
    [
      "Calculate",
      "Compute sums, ratios, percentages and descriptive aggregates from finite numbers.",
    ],
    ["Analyze text", "Count words, lines, Unicode characters and UTF-8 bytes."],
    [
      "Compare text",
      "Compare line positions with bounded excerpts and explicit truncation.",
    ],
    ["Inspect JSON", "Parse JSON and inspect an exact JSON Pointer."],
    [
      "Profile CSV",
      "Check quoted CSV, field quality, row shape and numeric ranges.",
    ],
    [
      "Convert date & time",
      "Convert an explicitly zoned timestamp to a named time zone.",
    ],
    ["Inspect a URL", "Parse address components without opening the address."],
    [
      "Fingerprint text",
      "Compute SHA-256 over the exact UTF-8 text; this does not encrypt it.",
    ],
  ],
};
