import type { HomeCopy } from "../home-copy";

const copy = {
  deskKicker: "Your workspace",
  heroTitle: "What should we accomplish together today?",
  heroDescription:
    "Describe your goal. Let your team plan the work and assign the right experts. Follow progress and results in one place.",
  guideLabel: "Getting started",
  guideTitle: "How it works",
  guideSteps: [
    {
      title: "Describe the goal",
      text: "Write what you need and what a good result would look like.",
    },
    {
      title: "Let the team divide the work",
      text: "The plan, tasks, and owners come together in the project space.",
    },
    {
      title: "Review the result",
      text: "Inspect deliverables and checks, then steer the work if needed.",
    },
  ],
  controlTitle: "You stay in control",
  controlDescription:
    "Actions that need approval wait for you. You can stop work from the top bar.",
  firstUse: "First step: check connections",
  meetExperts: "Meet {count} experts",
  seeRoles: "See how each expert can help.",
  resumeKicker: "Pick up where you left off",
  recentProjects: "Recent projects",
  viewAll: "View all",
  projectsLoadError: "Could not load projects",
  retry: "Try again",
  sharedSpacesLabel: "Shared workspaces",
  companyRoomTitle: "Company room",
  companyRoomDescription:
    "Ask the team a question or share an idea. Relevant experts can join the conversation.",
  trackProjectsTitle: "Track your projects",
  trackProjectsDescription:
    "Review the plan, tasks, and deliverables in each project space.",
  buildTeamTitle: "Set up a ready team",
  buildTeamDescription: "Choose experts and a workflow from a prepared team.",
  teamLoading: "Loading team",
  activeTeamMembers: "{count} active team members",
  projectOwner: "Project owner",
  emptyProjectsTitle: "Your first project starts here",
  emptyProjectsDescription:
    "Choose an example above or describe your own goal.",
  detailedProject: "Create a detailed project",
  open: "Open",
  rosterLoadError: "Could not load the team",
  rosterLoadDescription: "Check your connection and try again.",
  modeGroup: "Work approach",
  modes: {
    team: {
      label: "Team",
      hint: "The team divides work around your goal.",
      instruction:
        "Clarify the goal and acceptance criteria. Assign distinct responsibilities to suitable existing experts and order dependencies. After delivery, have an appropriate expert independently verify the result. Combine the outcome, evidence, and remaining gaps in one handoff.",
    },
    engineer: {
      label: "Build a product",
      hint: "Design, implementation, and testing serve the same goal.",
      instruction:
        "Build a working product. Assign design, implementation, and independent quality checks to suitable existing experts. Deliver real test evidence, run instructions, and known gaps.",
    },
    research: {
      label: "Research",
      hint: "Review sources and prepare a reasoned conclusion.",
      instruction:
        "Focus on sources, evidence, and decisions. Separate verified findings, assumptions, and inferences. Deliver traceable sources and uncertainties with the conclusion.",
    },
    compare: {
      label: "Compare",
      hint: "Evaluate options against the same criteria.",
      instruction:
        "Evaluate at least two approaches against the same explicit criteria. Identify data gaps and deliver a reasoned recommendation with a decision table.",
    },
  },
  validationShort: "Tell us a little more: enter at least 10 characters.",
  validationLong: "Keep your goal within 7,000 characters.",
  examples: [
    {
      label: "Build a website",
      mode: "engineer",
      prompt:
        "Build a mobile-friendly website for my business. Plan the page structure, then create the design and working site. Check the forms, mobile layout, and accessibility; deliver the result with test evidence.",
    },
    {
      label: "Research a topic",
      mode: "research",
      prompt:
        "Research the audience and existing alternatives for my new product idea. Prepare a sourced comparison, user needs, and the first three steps to try. My idea and audience: ",
    },
    {
      label: "Improve a process",
      mode: "team",
      prompt:
        "Simplify a recurring work process and prepare an automation plan. Define inputs, owners, outputs, error cases, and checkpoints. The process I want to improve: ",
    },
  ],
  projectReadyTitle: "Project space is ready",
  projectReadyDescription:
    "You can follow the plan, team activity, and deliverables here.",
  projectLaunchError:
    "Could not start the project. Check your connection and model settings, then try again. Your draft is saved here.",
  desiredOutcome: "The result you want",
  placeholder:
    "For example: Build a website where customers can book appointments with my small business…",
  composerHelp: "Describe the goal, constraints, and expected deliverable.",
  submitShortcut: "Press Ctrl / ⌘ + Enter to start",
  startingProject: "Starting project…",
  startProject: "Start project",
  blocked:
    "The safety stop is active. Check the stop status before starting a project; your text stays on this screen.",
  beforeStart: "Before you start,",
  firstExpert: "add your first expert",
  exampleKicker: "Start with an example",
} satisfies HomeCopy;

export default copy;
