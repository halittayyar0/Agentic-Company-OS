import type { Agent } from "@workspace/api-client-react";
import type { Locale } from "./i18n";
import type { DEPARTMENT_LABELS } from "./agent-presentation";

export type DirectoryRole =
  | "ceo"
  | "marketing_director"
  | "sales_director"
  | "operations_director"
  | "finance_director"
  | "product_director"
  | "engineering_director"
  | "research_director"
  | "support_director"
  | "content_director"
  | "ux_designer"
  | "quality_engineer"
  | "data_analyst"
  | "automation_specialist";

export type AgentDirectoryCopy = {
  eyebrow: string;
  title: string;
  description: string;
  addExpert: string;
  conversationTitle: string;
  conversationDescription: string;
  companyRoom: string;
  directory: string;
  search: string;
  searchPlaceholder: string;
  department: string;
  allDepartments: string;
  general: string;
  departments: Record<keyof typeof DEPARTMENT_LABELS, string>;
  summaries: Record<DirectoryRole, string>;
  customSummary: (role: string) => string;
  filterStatus: string;
  all: string;
  statuses: Record<Agent["status"], string>;
  count: (shown: string, total: string, filtered: boolean) => string;
  loading: string;
  countUnavailable: string;
  loadFailed: string;
  refreshFailed: string;
  errorDescription: string;
  staleDescription: string;
  retry: string;
  noMatch: string;
  noMatchDescription: string;
  emptyTitle: string;
  emptyDescription: string;
  clearFilters: string;
  pagination: string;
  previous: string;
  next: string;
  page: (current: string, total: string) => string;
  workingAction: string;
  openProfile: string;
};

const LOADERS = {
  tr: () => import("./agent-directory-copy/directory-tr"),
  en: () => import("./agent-directory-copy/directory-en"),
  de: () => import("./agent-directory-copy/directory-de"),
  ru: () => import("./agent-directory-copy/directory-ru"),
  "zh-CN": () => import("./agent-directory-copy/directory-zh-CN"),
  "zh-TW": () => import("./agent-directory-copy/directory-zh-TW"),
  ar: () => import("./agent-directory-copy/directory-ar"),
} satisfies Record<Locale, () => Promise<{ default: AgentDirectoryCopy }>>;

export async function loadAgentDirectoryCopy(
  locale: Locale,
): Promise<AgentDirectoryCopy> {
  return (await LOADERS[locale]()).default;
}

export function directoryDepartment(
  value: string | null | undefined,
  copy: AgentDirectoryCopy,
): string {
  if (!value) return copy.general;
  const key = value === "customer_support" ? "support" : value;
  const label = copy.departments[key as keyof typeof copy.departments];
  return typeof label === "string" ? label : value;
}

export function directorySummary(
  agent: Pick<Agent, "templateKey" | "role" | "isCustomPrompt">,
  copy: AgentDirectoryCopy,
): string {
  const summary =
    agent.templateKey && copy.summaries[agent.templateKey as DirectoryRole];
  return !agent.isCustomPrompt && typeof summary === "string"
    ? summary
    : copy.customSummary(agent.role);
}
