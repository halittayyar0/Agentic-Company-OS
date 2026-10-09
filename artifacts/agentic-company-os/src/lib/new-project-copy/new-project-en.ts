import type { NewProjectCopy } from "../new-project-copy";

const copy = {
  draftStorageError:
    "This tab cannot save your draft for reload. Your text remains editable here; keep a copy before reloading or closing the tab.",
  back: "Back to projects",
  eyebrow: "New project · whole team",
  title: "Bring in your idea. Build it together with your team.",
  teamDescription: (count) =>
    `You do not need to choose one owner. The active team${count ? ` (size: ${count})` : ""} shares the same project context and steps in when needed.`,
  teamUnavailable:
    "Could not load the active team. Project creation is paused.",
  retry: "Try again",
  projectName: "Project name",
  namePlaceholder: "For example, customer insights platform",
  brief: "Goal and scope",
  briefPlaceholder:
    "What do you want to achieve? Describe success criteria, available context, and the result you expect…",
  projectType: "Project type",
  finite: "Delivery focused",
  continuous: "Ongoing",
  priority: "Project priority",
  priorities: { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" },
  starting: "Adding the team…",
  start: "Start project",
  cadence: "Work cadence",
  cadences: {
    900: "Every 15 minutes",
    3600: "Every hour",
    21600: "Every 6 hours",
    86400: "Every day",
    604800: "Every week",
  },
  contextNote:
    "Active experts, meetings, and work records stay within this project.",
  emergencyStop:
    "Emergency stop is active. You cannot start a new project. Your draft stays on this screen.",
  safetyUnverified:
    "You cannot start a new project until the safety status is verified.",
  teamLoading: "Loading team",
  teamAria: (count) => `Project team of ${count} active experts`,
  validationTitle: "The project needs direction",
  validationDescription: "Enter a project name and the outcome you want.",
  noTeamTitle: "No active team found",
  noTeamDescription:
    "Activate at least one expert before starting the project.",
  successTitle: "Project workspace created",
  successDescription: (id) =>
    `Project #${id} created. Active experts were added.`,
  failureTitle: "Could not start the project",
  failureDescription:
    "Check your connection and permissions, then try again. Your draft stays on this screen.",
} satisfies NewProjectCopy;

export default copy;
