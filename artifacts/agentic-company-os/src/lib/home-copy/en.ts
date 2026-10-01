import type { HomeCopy } from "../home-copy";

const copy = {
  deskKicker: "Your workspace",
  heroTitle: "What should we accomplish together today?",
  heroDescription:
    "Describe the result you need. An existing agent starts the work and brings in suitable experts when needed. Follow progress and delivery in one place.",
  quickToolsTitle: "Try a useful check without a model",
  quickToolsDescription:
    "Inspect a CSV or JSON file, or compare two lists in this browser.",
  guideLabel: "Getting started",
  guideTitle: "How it works",
  guideSteps: [
    {
      title: "Describe the goal",
      text: "Write what you need and what a good result would look like.",
    },
    {
      title: "Let the agent get started",
      text: "The same agent completes small jobs. A suitable existing expert joins when independent work is needed.",
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
      label: "Get it done",
      hint: "Start with an existing agent; bring in suitable experts when needed.",
      instruction:
        "Start with a suitable existing agent. Complete small work yourself. Delegate only an independent deliverable or necessary specialist work to a suitable existing agent; keep parallel work bounded. Clarify the goal and acceptance criteria, and verify the result with appropriate checks. Combine the outcome, evidence, and remaining gaps in one handoff.",
    },
    engineer: {
      label: "Build a product",
      hint: "Design, implementation, and testing serve the same goal.",
      instruction:
        "Build a working product. Complete small work yourself; bring in a suitable existing expert only for an independent deliverable or necessary specialist work. Complete the design, implementation, and appropriate quality checks. Deliver real test evidence, run instructions, and known gaps.",
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
