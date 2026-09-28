import type { ProjectListCopy } from "../project-list-copy";

const copy = {
  eyebrow: "Your workspaces",
  title: "Projects",
  description:
    "Conversations, meetings, team decisions, and deliverables stay together in the context of their project.",
  schedulerPaused: "Task scheduler is paused",
  newProject: "New project",
  listLabel: "Project list",
  filterLabel: "Filter projects by status",
  collections: { all: "All", active: "Active", completed: "Completed" },
  search: "Search projects",
  loading: "Loading projects",
  errorTitle: "Could not load projects",
  errorDescription: "We are not showing outdated project data.",
  retry: "Try again",
  emptyInitialTitle: "Your team is ready for its first project",
  emptyFilteredTitle: "No projects here",
  emptyInitialDescription:
    "Describe your goal so active experts can work together in one project.",
  emptyFilteredDescription: "Change the filter or search terms.",
  createFirst: "Create your first project",
  owner: (name) => `Project owner: ${name}`,
  ownerId: (id) => `Project owner #${id}`,
} satisfies ProjectListCopy;

export default copy;
