import type { AgentDirectoryCopy } from "../agent-directory-copy";

const copy = {
  eyebrow: "Meet your team",
  title: "The right expert for your work.",
  description:
    "Discover what each expert does, start a conversation, or add a new role to your team.",
  addExpert: "Add an expert",
  conversationTitle: "One expert or the whole team?",
  conversationDescription:
    "Talk one to one from an expert's profile. Use the company room for a shared topic.",
  companyRoom: "Open company room",
  directory: "Expert directory",
  search: "Search experts",
  searchPlaceholder: "Name, expertise, or work you have in mind…",
  department: "Area of expertise",
  allDepartments: "All areas",
  general: "General",
  departments: {
    executive: "Leadership",
    marketing: "Marketing",
    sales: "Sales",
    operations: "Operations",
    finance: "Finance",
    product: "Product",
    engineering: "Engineering",
    research: "Research",
    support: "Customer support",
    content: "Content",
    design: "Design",
    quality: "Quality",
    data: "Data",
    automation: "Automation",
    custom: "Custom expertise",
  },
  summaries: {
    ceo: "Turns goals into plans, coordinates responsibilities, and brings the results together.",
    marketing_director:
      "Works on audiences, brand messaging, and measurable growth plans.",
    sales_director:
      "Organizes customer needs, sales opportunities, and proposal preparation.",
    operations_director:
      "Tracks processes, responsibilities, and the progress of daily operations.",
    finance_director:
      "Evaluates budgets, costs, and financial plans using available data.",
    product_director:
      "Turns user needs into product scope, priorities, and acceptance criteria.",
    engineering_director:
      "Coordinates working software, technical implementation, and maintainable architecture.",
    research_director:
      "Researches sources, checks claims, and gathers findings for decisions.",
    support_director:
      "Organizes customer issues and drafts solutions and clear replies.",
    content_director:
      "Creates writing, content plans, and publication drafts in the brand's voice.",
    ux_designer:
      "Turns complex screens into accessible flows that work on phones and computers.",
    quality_engineer:
      "Tests work through realistic scenarios and reports defects and delivery evidence.",
    data_analyst:
      "Examines data, checks calculations, and prepares analysis to support decisions.",
    automation_specialist:
      "Turns recurring work into controlled, observable flows that can recover from failures.",
  },
  customSummary: (role) =>
    `\u2068${role}\u2069. Review this expert's instructions and permissions in their profile.`,
  filterStatus: "Filter experts by status",
  all: "All",
  statuses: {
    idle: "Ready",
    working: "Working",
    blocked: "Needs support",
    archived: "Archived",
  },
  count: (shown, total, filtered) =>
    filtered ? `Experts: ${shown} of ${total}` : `Experts: ${shown}`,
  loading: "Loading experts…",
  countUnavailable: "Team count unavailable",
  loadFailed: "Could not load experts",
  refreshFailed: "Could not refresh experts",
  errorDescription: "Check your connection and try again.",
  staleDescription:
    "Showing the last loaded team. Check your connection and try again.",
  retry: "Try again",
  noMatch: "No matching experts",
  noMatchDescription: "Try a shorter search or clear the filters.",
  emptyTitle: "Add your first expert",
  emptyDescription: "Choose a ready-made role to start building your team.",
  clearFilters: "Clear filters",
  pagination: "Expert pages",
  previous: "Previous",
  next: "Next",
  page: (current, total) => `Page ${current} of ${total}`,
  workingAction: "Working on the assigned task",
  openProfile: "Profile and working instructions",
} satisfies AgentDirectoryCopy;

export default copy;
