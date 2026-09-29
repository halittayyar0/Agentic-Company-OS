import type { Locale } from "./i18n";
export type TraceCopy = {
  title: string;
  help: string;
  loading: string;
  error: string;
  stale: string;
  snapshot: string;
  retry: string;
  export: string;
  exportHelp: string;
  evidenceExport: string;
  evidenceHelp: string;
  evidenceError: string;
  operations: string;
  window: string;
  range: string;
  unknown: string;
  empty: string;
  noMatch: string;
  all: string;
  people: string;
  tools: string;
  gates: string;
  issues: string;
  records: string;
  toolRecords: string;
  judges: string;
  participants: string;
  model: string;
  steps: string;
  cycles: string;
  categories: string;
  intake: string;
  plan: string;
  route: string;
  execute: string;
  review: string;
  deliver: string;
  created: string;
  owned: string;
  planningRecorded: string;
  executionRecorded: string;
  reviewRecorded: string;
  summaryStored: string;
  markedCompleted: string;
  missing: string;
  taskSource: string;
  activitySource: string;
  source: string;
  record: string;
  agent: string;
  system: string;
  detail: string;
  noDetail: string;
  yes: string;
  no: string;
  delegations: string;
  delegationHelp: string;
  delegationLimit: string;
  noDelegations: string;
  taskListError: string;
  manager: string;
  owner: string;
  assignment: string;
  accepted: string;
  progress: string;
  response: string;
  completed: string;
  status: string;
  lastUpdated: string;
  info: string;
  warning: string;
  critical: string;
  fields: Record<
    | "status"
    | "outcome"
    | "taskDisposition"
    | "progressPercent"
    | "delegationLifecycle"
    | "fromAgentId"
    | "toAgentId"
    | "newAgentId"
    | "parentTaskId"
    | "completedSubtaskId"
    | "selectedTool"
    | "tool"
    | "toolName"
    | "surface"
    | "previousSurface"
    | "phase"
    | "lifecyclePhase"
    | "transition"
    | "sequence"
    | "durationMs"
    | "commandName"
    | "commandChars"
    | "exitCode"
    | "outputStored"
    | "count"
    | "verdict"
    | "modelId"
    | "primaryModelId"
    | "fallbackModelId"
    | "nextModelId"
    | "provider"
    | "fallbackProvider"
    | "usedModelFallback"
    | "freeOnly"
    | "failureKind"
    | "attempt"
    | "consecutiveFailures"
    | "remainsActive"
    | "runtimeEvent"
    | "guard"
    | "category"
    | "approvalId"
    | "actionQueued"
    | "autonomyMode"
    | "cadenceSeconds"
    | "nextAttemptAt"
    | "nextRunAt"
    | "expiresAt"
    | "url"
    | "scope.toolName",
    string
  >;
};
const loaders = {
  en: () => import("./trace-copy/trace-en"),
  tr: () => import("./trace-copy/trace-tr"),
  de: () => import("./trace-copy/trace-de"),
  ru: () => import("./trace-copy/trace-ru"),
  "zh-CN": () => import("./trace-copy/trace-zh-CN"),
  "zh-TW": () => import("./trace-copy/trace-zh-TW"),
  ar: () => import("./trace-copy/trace-ar"),
};
export async function loadTraceCopy(locale: Locale): Promise<TraceCopy> {
  return (await loaders[locale]()).default;
}
