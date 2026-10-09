import type { NewProjectCopy } from "../new-project-copy";

const copy = {
  recovery: {
    title: "Recover your project start",
    uncertain:
      "The response was not confirmed. Check this saved request before starting another project.",
    missing:
      "No saved receipt was found yet. The first request may still arrive; retrying uses that same request.",
    created:
      "Your project workspace was created. Open it to see the current work status.",
    rejected:
      "This request was rejected. Prepare a new start after resolving the reason; your draft stays here.",
    checking: "Checking request…",
    check: "Check request",
    open: "Open project",
    retry: "Retry same request",
    prepare: "Prepare a new start",
    stored: "Submitted project",
    storageError:
      "This tab could not verify its saved request. Keep a copy of your draft. No new request will be sent until it can be saved; a damaged record must be recovered in this tab.",
    noTokens:
      "Checking only reads the saved outcome. It spends no model tokens and does not run the job again.",
    reasons: {
      EMERGENCY_STOP_ACTIVE: "Emergency stop is active.",
      AGENT_UNAVAILABLE: "The required active team was unavailable.",
      RUNTIME_CAPACITY_EXCEEDED:
        "The workspace reached its running-work limit.",
      EXECUTION_POLICY_DENIED: "The execution policy blocked this start.",
    },
  },
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
