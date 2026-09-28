import type { Locale } from "./i18n";

export type ProjectCollection = "all" | "active" | "completed";

export type ProjectListCopy = {
  eyebrow: string;
  title: string;
  description: string;
  schedulerPaused: string;
  newProject: string;
  listLabel: string;
  filterLabel: string;
  collections: Record<ProjectCollection, string>;
  search: string;
  loading: string;
  errorTitle: string;
  errorDescription: string;
  retry: string;
  emptyInitialTitle: string;
  emptyFilteredTitle: string;
  emptyInitialDescription: string;
  emptyFilteredDescription: string;
  createFirst: string;
  owner: (name: string) => string;
  ownerId: (id: number) => string;
};

const LOADERS = {
  tr: () => import("./project-list-copy/projects-tr"),
  en: () => import("./project-list-copy/projects-en"),
  de: () => import("./project-list-copy/projects-de"),
  ru: () => import("./project-list-copy/projects-ru"),
  "zh-CN": () => import("./project-list-copy/projects-zh-CN"),
  "zh-TW": () => import("./project-list-copy/projects-zh-TW"),
  ar: () => import("./project-list-copy/projects-ar"),
} satisfies Record<Locale, () => Promise<{ default: ProjectListCopy }>>;

export async function loadProjectListCopy(
  locale: Locale,
): Promise<ProjectListCopy> {
  return (await LOADERS[locale]()).default;
}
