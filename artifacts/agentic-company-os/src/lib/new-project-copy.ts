import type { Locale } from "./i18n";
import type { TaskPriority } from "@workspace/api-client-react";

export type ProjectCadence = 900 | 3600 | 21600 | 86400 | 604800;

export type NewProjectCopy = {
  recovery: {
    title: string;
    uncertain: string;
    missing: string;
    created: string;
    rejected: string;
    checking: string;
    check: string;
    open: string;
    retry: string;
    prepare: string;
    stored: string;
    storageError: string;
    noTokens: string;
    reasons: Record<
      | "EMERGENCY_STOP_ACTIVE"
      | "AGENT_UNAVAILABLE"
      | "RUNTIME_CAPACITY_EXCEEDED"
      | "EXECUTION_POLICY_DENIED",
      string
    >;
  };
  draftStorageError: string;
  back: string;
  eyebrow: string;
  title: string;
  teamDescription: (count: number) => string;
  teamUnavailable: string;
  retry: string;
  projectName: string;
  namePlaceholder: string;
  brief: string;
  briefPlaceholder: string;
  projectType: string;
  finite: string;
  continuous: string;
  priority: string;
  priorities: Record<TaskPriority, string>;
  starting: string;
  start: string;
  cadence: string;
  cadences: Record<ProjectCadence, string>;
  contextNote: string;
  emergencyStop: string;
  safetyUnverified: string;
  teamLoading: string;
  teamAria: (count: number) => string;
  validationTitle: string;
  validationDescription: string;
  noTeamTitle: string;
  noTeamDescription: string;
  successTitle: string;
  successDescription: (id: number) => string;
  failureTitle: string;
  failureDescription: string;
};

const LOADERS = {
  tr: () => import("./new-project-copy/new-project-tr"),
  en: () => import("./new-project-copy/new-project-en"),
  de: () => import("./new-project-copy/new-project-de"),
  ru: () => import("./new-project-copy/new-project-ru"),
  "zh-CN": () => import("./new-project-copy/new-project-zh-CN"),
  "zh-TW": () => import("./new-project-copy/new-project-zh-TW"),
  ar: () => import("./new-project-copy/new-project-ar"),
} satisfies Record<Locale, () => Promise<{ default: NewProjectCopy }>>;

export async function loadNewProjectCopy(
  locale: Locale,
): Promise<NewProjectCopy> {
  return (await LOADERS[locale]()).default;
}
