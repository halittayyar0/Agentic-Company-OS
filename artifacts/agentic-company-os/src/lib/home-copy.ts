import type { Locale } from "./i18n";

export type HomeMode = "team" | "engineer" | "research" | "compare";

type ModeCopy = {
  label: string;
  hint: string;
  instruction: string;
};

type ExampleCopy = {
  label: string;
  mode: HomeMode;
  prompt: string;
};

export type HomeCopy = {
  deskKicker: string;
  heroTitle: string;
  heroDescription: string;
  guideLabel: string;
  guideTitle: string;
  guideSteps: readonly [
    { title: string; text: string },
    { title: string; text: string },
    { title: string; text: string },
  ];
  controlTitle: string;
  controlDescription: string;
  firstUse: string;
  meetExperts: string;
  seeRoles: string;
  resumeKicker: string;
  recentProjects: string;
  viewAll: string;
  projectsLoadError: string;
  retry: string;
  sharedSpacesLabel: string;
  companyRoomTitle: string;
  companyRoomDescription: string;
  trackProjectsTitle: string;
  trackProjectsDescription: string;
  buildTeamTitle: string;
  buildTeamDescription: string;
  teamLoading: string;
  activeTeamMembers: string;
  projectOwner: string;
  emptyProjectsTitle: string;
  emptyProjectsDescription: string;
  detailedProject: string;
  open: string;
  rosterLoadError: string;
  rosterLoadDescription: string;
  modeGroup: string;
  modes: Record<HomeMode, ModeCopy>;
  validationShort: string;
  validationLong: string;
  examples: readonly [ExampleCopy, ExampleCopy, ExampleCopy];
  projectReadyTitle: string;
  projectReadyDescription: string;
  projectLaunchError: string;
  desiredOutcome: string;
  placeholder: string;
  composerHelp: string;
  submitShortcut: string;
  startingProject: string;
  startProject: string;
  blocked: string;
  beforeStart: string;
  firstExpert: string;
  exampleKicker: string;
};

const LOADERS = {
  tr: () => import("./home-copy/tr"),
  en: () => import("./home-copy/en"),
  de: () => import("./home-copy/de"),
  ru: () => import("./home-copy/ru"),
  "zh-CN": () => import("./home-copy/zh-CN"),
  "zh-TW": () => import("./home-copy/zh-TW"),
  ar: () => import("./home-copy/ar"),
} satisfies Record<Locale, () => Promise<{ default: HomeCopy }>>;

export async function loadHomeCopy(locale: Locale): Promise<HomeCopy> {
  return (await LOADERS[locale]()).default;
}
