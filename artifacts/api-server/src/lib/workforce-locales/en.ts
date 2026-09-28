import type { WorkforceCatalogCopy } from "../workforce-localization";

export default {
  "product-shipping-crew": {
    name: "Product Delivery Team",
    tagline: "Validate the problem, deliver the product, prove the outcome.",
    description:
      "A cross-functional team led by one accountable owner, combining research, implementation, and quality evidence from discovery through delivery.",
    recommendedFor: [
      "A new feature or product line",
      "An uncertain customer problem",
      "Delivery requiring research, engineering, and QA",
    ],
    triggerLabels: ["product", "feature", "MVP", "launch", "delivery"],
    members: {
      "product-lead": {
        name: "Product Coordinator",
        role: "Product Delivery Lead",
        mission:
          "Turn the business outcome and user problem into measurable acceptance criteria; manage discovery, engineering, and quality in one delivery plan.",
        capabilities: [
          "Problem framing",
          "Delivery planning",
          "Dependency management",
          "Outcome review",
        ],
      },
      "discovery-researcher": {
        name: "Discovery Researcher",
        role: "Product Discovery Researcher",
        mission:
          "Validate the target user's work, existing alternatives, and critical assumptions using current sources and traceable evidence.",
        capabilities: [
          "User research",
          "Competitor research",
          "Evidence matrix",
        ],
      },
      "delivery-engineer": {
        name: "Delivery Engineer",
        role: "Product Delivery Engineer",
        mission:
          "Turn the approved scope into the smallest secure, testable production change that fits the existing architecture.",
        capabilities: [
          "Technical design",
          "Implementation",
          "Test automation",
          "Release preparation",
        ],
      },
      "quality-reviewer": {
        name: "Quality Reviewer",
        role: "Product Quality Reviewer",
        mission:
          "Independently review requirements, accessibility, failure behavior, and the sufficiency of evidence; turn gaps into specific correction requests.",
        capabilities: [
          "Acceptance testing",
          "Edge case review",
          "Evidence audit",
        ],
      },
    },
    handoffs: {
      "discovery-researcher/product-lead/review":
        "Present the problem evidence, uncertainties, and proposed scope for the lead's decision.",
      "product-lead/delivery-engineer/ai":
        "Pass the approved scope, acceptance criteria, and required evidence as an implementation brief.",
      "delivery-engineer/quality-reviewer/next":
        "Hand over the implementation artifacts and completed checks for independent quality review.",
      "quality-reviewer/product-lead/review":
        "Report passing checks, remaining gaps, and the release recommendation for a decision.",
    },
  },
  "go-to-market-crew": {
    name: "Go-to-Market Team",
    tagline: "Reach the right accounts with evidence and measurable demand.",
    description:
      "A growth team connecting ideal-customer research with positioning, content, and sales activation, without treating drafts as real outreach or revenue.",
    recommendedFor: [
      "A product or market launch",
      "B2B demand generation",
      "Message and channel validation",
    ],
    triggerLabels: ["growth", "sales", "campaign", "GTM", "pipeline"],
    members: {
      "gtm-lead": {
        name: "GTM Coordinator",
        role: "Go-to-Market Lead",
        mission:
          "Combine the ideal customer profile, offer, channels, and sales motion in one measurement plan; connect team outputs to qualified demand.",
        capabilities: [
          "GTM strategy",
          "Message hierarchy",
          "Channel portfolio",
          "Experiment management",
        ],
      },
      "market-analyst": {
        name: "Market Analyst",
        role: "Market Intelligence Analyst",
        mission:
          "Map ideal-customer accounts, buying triggers, alternatives, and differentiating evidence using primary sources.",
        capabilities: [
          "Ideal-customer research",
          "Account signals",
          "Competitor evidence",
        ],
      },
      "campaign-builder": {
        name: "Campaign Builder",
        role: "Campaign and Content Builder",
        mission:
          "Turn verified messaging into sourced, measurable campaign artifacts suited to each channel; preserve the link between claims and evidence.",
        capabilities: [
          "Campaign briefs",
          "Content creation",
          "Channel adaptation",
        ],
      },
      "revenue-operator": {
        name: "Revenue Operator",
        role: "Revenue Activation Specialist",
        mission:
          "Qualify priority accounts, prepare personalized outreach drafts, and record each advance as an evidence-backed sales stage.",
        capabilities: [
          "Account prioritization",
          "Outreach drafts",
          "Opportunity qualification",
          "Pipeline evidence",
        ],
      },
    },
    handoffs: {
      "market-analyst/gtm-lead/review":
        "Submit ideal-customer and differentiation evidence for the lead to review the messaging decision.",
      "gtm-lead/campaign-builder/ai":
        "Pass the approved segment, offer, claim boundaries, and channel measurements as a production brief.",
      "campaign-builder/revenue-operator/next":
        "Hand over approved messaging and evidence for account-level activation; keep sending actions under user control.",
      "revenue-operator/gtm-lead/review":
        "Report actual outreach and pipeline evidence separately from draft and activity metrics.",
    },
  },
  "incident-command-flow": {
    name: "Incident Response Workflow",
    tagline: "Contain the impact, establish the cause, recover safely.",
    description:
      "A controlled response workflow taking an operational or technical incident through triage, investigation, recovery verification, and stakeholder communication in order.",
    recommendedFor: [
      "A production incident or service outage",
      "A suspected security issue",
      "A recurring operational failure",
    ],
    triggerLabels: ["incident", "outage", "failure", "security", "SLA"],
    members: {
      "incident-lead": {
        name: "Incident Commander",
        role: "Incident Commander",
        mission:
          "Manage one incident record from impact through recovery; prioritize customer impact, safety, and reversibility.",
        capabilities: [
          "Triage",
          "Incident timeline",
          "Decisions and ownership",
          "Recovery gate",
        ],
      },
      "systems-investigator": {
        name: "Systems Investigator",
        role: "Systems Investigator",
        mission:
          "Turn symptoms into reproducible evidence; narrow root-cause hypotheses by testing logs, changes, and dependencies.",
        capabilities: [
          "Technical triage",
          "Log analysis",
          "Root-cause hypotheses",
        ],
      },
      "risk-reviewer": {
        name: "Risk Reviewer",
        role: "Safety and Recovery Reviewer",
        mission:
          "Independently verify the proposed fix for safety, data integrity, rollback, and recurrence risk.",
        capabilities: [
          "Risk assessment",
          "Rollback checks",
          "Recovery verification",
        ],
      },
      "stakeholder-reporter": {
        name: "Stakeholder Reporter",
        role: "Incident Communications Specialist",
        mission:
          "Turn verified incident facts into a clear communication draft covering impact, current status, the next update, and required user action.",
        capabilities: [
          "Status summaries",
          "Customer communication drafts",
          "Postmortem narrative",
        ],
      },
    },
    handoffs: {
      "incident-lead/systems-investigator/next":
        "Pass the contained incident context, timeline, and safe investigation boundaries.",
      "systems-investigator/risk-reviewer/review":
        "Submit root-cause evidence, the proposed fix, and the rollback plan for independent review.",
      "risk-reviewer/incident-lead/review":
        "Return the recovery recommendation with passing checks, outstanding risks, and rollback conditions.",
      "incident-lead/stakeholder-reporter/ai":
        "Request a stakeholder communication draft using only the verified timeline and approved incident status.",
    },
  },
} satisfies WorkforceCatalogCopy;
