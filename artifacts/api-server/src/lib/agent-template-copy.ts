export const AGENT_TEMPLATE_KEYS = [
  "ceo",
  "marketing_director",
  "sales_director",
  "operations_director",
  "finance_director",
  "product_director",
  "engineering_director",
  "research_director",
  "support_director",
  "content_director",
  "ux_designer",
  "quality_engineer",
  "data_analyst",
  "automation_specialist",
  "specialist",
] as const;
export type AgentTemplateKey = (typeof AGENT_TEMPLATE_KEYS)[number];

/** Authored copy only. Identity, permissions and hierarchy come from the
 * canonical template definitions and must never be supplied by a translation. */
export interface AuthoredTemplateText {
  name: string;
  defaultRole: string;
  description: string;
  /** Complete original playbook, excluding only the appended common rules. */
  body: string;
}
export interface HandoffCopy {
  installedByManager: string;
  outgoingReview: string;
  outgoing: string;
  incomingReview: string;
  incoming: string;
  outgoingDirection: string;
  incomingDirection: string;
  heading: string;
  team: string;
  role: string;
  reportsTo: string;
  mission: string;
  capabilities: string;
  noHandoff: string;
  flowRule: string;
  teamRule: string;
  finalRule: string;
  modes: { ai: string; next: string; review: string };
  orchestrations: { flow: string; team: string };
}
export interface AgentTemplateCopy {
  managerRules: string;
  specialistRules: string;
  templates: Record<AgentTemplateKey, AuthoredTemplateText>;
  handoff: HandoffCopy;
}
