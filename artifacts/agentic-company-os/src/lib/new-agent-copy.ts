import type { Locale } from "./i18n";
import type { AgentTemplate } from "@workspace/api-client-react";

export type NewAgentCopy = {
  back: string;
  eyebrow: string;
  title: string;
  description: string;
  specialtyHeading: string;
  recommended: string;
  recommendedAria: string;
  templatesLoading: string;
  templatesError: string;
  templatesEmpty: string;
  allTemplates: string;
  chooseTemplate: string;
  identityHeading: string;
  name: string;
  namePlaceholder: string;
  nameHelp: string;
  role: string;
  rolePlaceholder: string;
  department: string;
  departmentPlaceholder: string;
  departmentHelp: string;
  parent: string;
  parentNone: string;
  teamLoading: string;
  teamError: string;
  advanced: string;
  advancedHelp: string;
  modelMode: string;
  modelAuto: string;
  modelManual: string;
  modelHelp: string;
  fixedModel: string;
  autoSummary: string;
  custom: string;
  customHelp: string;
  prompt: string;
  promptPlaceholder: string;
  promptReview: string;
  promptSource: string;
  permissionsHeading: string;
  permissionsAria: string;
  permissionsHelp: string;
  startHint: string;
  customSummary: string;
  cancel: string;
  submit: string;
  submitting: string;
  retry: string;
  saveFailed: string;
  saved: string;
  savedDescription: string;
  validation: {
    nameShort: string;
    nameLong: string;
    roleShort: string;
    roleLong: string;
    departmentLong: string;
    promptLong: string;
    template: string;
    promptShort: string;
    model: string;
  };
  permissions: {
    canBrowse: string;
    canUseTerminal: string;
    canDelegate: string;
    canCreateSubAgents: string;
    canSpend: string;
    canDelete: string;
    canPublish: string;
    canContactExternal: string;
  };
  templates: {
    marketing_director: string;
    sales_director: string;
    operations_director: string;
    finance_director: string;
    product_director: string;
    engineering_director: string;
    research_director: string;
    support_director: string;
    content_director: string;
    ux_designer: string;
    quality_engineer: string;
    data_analyst: string;
    automation_specialist: string;
    specialist: string;
  };
  specialistSummary: string;
  model: {
    search: string;
    placeholder: string;
    count: string;
    loading: string;
    error: string;
    stale: string;
    connection: string;
    connectReason: string;
    toolsReason: string;
    default: string;
    free: string;
    noTools: string;
    showMore: string;
    empty: string;
    noMatch: string;
    emptyHelp: string;
    noMatchHelp: string;
    sourceDescription: string;
    builtin: string;
    tiers: {
      economy: string;
      standard: string;
      premium: string;
      reasoning: string;
    };
  };
};

const LOADERS = {
  tr: () => import("./new-agent-copy/new-expert-tr"),
  en: () => import("./new-agent-copy/new-expert-en"),
  de: () => import("./new-agent-copy/new-expert-de"),
  ru: () => import("./new-agent-copy/new-expert-ru"),
  "zh-CN": () => import("./new-agent-copy/new-expert-zh-CN"),
  "zh-TW": () => import("./new-agent-copy/new-expert-zh-TW"),
  ar: () => import("./new-agent-copy/new-expert-ar"),
} satisfies Record<Locale, () => Promise<{ default: NewAgentCopy }>>;

export async function loadNewAgentCopy(locale: Locale): Promise<NewAgentCopy> {
  return (await LOADERS[locale]()).default;
}

export function expertTemplateName(
  template: Pick<AgentTemplate, "key" | "name">,
  copy: NewAgentCopy,
): string {
  const name = Object.hasOwn(copy.templates, template.key)
    ? copy.templates[template.key as keyof typeof copy.templates]
    : undefined;
  return typeof name === "string" ? name : template.name;
}
