import type { HomeCopy } from "../home-copy";

const copy = {
  deskKicker: "你的工作区",
  heroTitle: "今天我们一起完成什么？",
  heroDescription:
    "描述你需要的结果。现有代理会开始工作，并在需要时请合适的专家协助。在同一处查看进展和交付成果。",
  quickToolsTitle: "无需模型，立即试用实用检查",
  quickToolsDescription: "直接在浏览器中检查 CSV 或 JSON，或比较两个列表。",
  guideLabel: "入门指南",
  guideTitle: "工作方式",
  guideSteps: [
    {
      title: "描述目标",
      text: "写下你的需求，以及理想成果应是什么样子。",
    },
    {
      title: "让代理开始工作",
      text: "小任务由同一个代理完成。需要独立工作时，再邀请合适的现有专家参与。",
    },
    {
      title: "审查结果",
      text: "检查交付物和验证结果，必要时调整方向。",
    },
  ],
  controlTitle: "控制权在你手中",
  controlDescription:
    "需要批准的操作会等待你的决定。你可以从顶部菜单停止工作。",
  firstUse: "第一步：检查连接",
  meetExperts: "认识 {count} 位专家",
  seeRoles: "了解每位专家可以提供哪些帮助。",
  resumeKicker: "继续上次的工作",
  recentProjects: "最近的项目",
  viewAll: "查看全部",
  projectsLoadError: "无法加载项目",
  retry: "重试",
  sharedSpacesLabel: "共享工作区",
  companyRoomTitle: "团队讨论室",
  companyRoomDescription: "向团队提问或分享想法。相关专家会参与讨论。",
  trackProjectsTitle: "跟进项目",
  trackProjectsDescription: "在项目空间查看计划、任务和交付成果。",
  buildTeamTitle: "组建现成团队",
  buildTeamDescription: "从预设团队中选择专家和工作流程。",
  teamLoading: "正在加载团队",
  activeTeamMembers: "{count} 位活跃团队成员",
  projectOwner: "项目负责人",
  emptyProjectsTitle: "从这里开始第一个项目",
  emptyProjectsDescription: "选择上面的示例，或描述你自己的目标。",
  detailedProject: "创建详细项目",
  open: "打开",
  rosterLoadError: "无法加载团队",
  rosterLoadDescription: "检查网络连接后重试。",
  modeGroup: "工作方式",
  modes: {
    team: {
      label: "完成任务",
      hint: "从现有代理开始；需要时请合适的专家协助。",
      instruction:
        "从合适的现有代理开始。小任务由自己完成。仅为独立交付成果或必要的专业工作委派给合适的现有代理，并限制并行工作。明确目标和验收标准，进行适当检查以验证结果。一次交付结果、证据和剩余缺项。",
    },
    engineer: {
      label: "开发产品",
      hint: "设计、开发和测试围绕同一目标协作。",
      instruction:
        "构建可运行的产品。小任务由自己完成；仅为独立交付成果或必要的专业工作请合适的现有专家协助。完成设计、实现和适当的质量检查。交付实际测试证据、运行说明和已知缺项。",
    },
    research: {
      label: "研究",
      hint: "查阅资料并形成有依据的结论。",
      instruction:
        "围绕来源、证据和决策开展工作。区分已核实的发现、假设和推论。提供可追溯的来源、结论和不确定性。",
    },
    compare: {
      label: "比较",
      hint: "用相同标准评估不同方案。",
      instruction:
        "根据相同的明确标准评估至少两种方案。指出数据缺口，并通过决策表给出有依据的建议。",
    },
  },
  validationShort: "请多描述一些目标：至少输入 10 个字符。",
  validationLong: "请将目标控制在 7,000 个字符以内。",
  examples: [
    {
      label: "制作网站",
      mode: "engineer",
      prompt:
        "为我的企业制作一个方便在手机上使用的网站。先规划页面结构，再完成设计和可运行的网站。检查表单、移动端布局和无障碍体验，并附上测试证据。",
    },
    {
      label: "研究一个主题",
      mode: "research",
      prompt:
        "研究我的新产品想法的目标用户和现有替代方案。提供有来源的比较、用户需求以及前三个可尝试的步骤。我的想法和目标用户是：",
    },
    {
      label: "改进流程",
      mode: "team",
      prompt:
        "简化一项重复性工作并制定自动化计划。说明输入、负责人、输出、异常情况和检查点。我想改进的流程是：",
    },
  ],
  projectReadyTitle: "项目空间已就绪",
  projectReadyDescription: "你可以在这里跟进计划、团队工作和交付成果。",
  projectLaunchError:
    "无法启动项目。请检查网络连接和模型设置，然后重试。你的草稿仍保留在此处。",
  desiredOutcome: "你想要的成果",
  placeholder: "例如：为我的小企业制作一个可供客户预约的网站…",
  composerHelp: "描述目标、限制条件和预期交付物。",
  submitShortcut: "按 Ctrl / ⌘ + Enter 开始",
  startingProject: "正在启动项目…",
  startProject: "启动项目",
  blocked:
    "安全停止开关已启用。启动项目前请检查停止状态；你输入的内容会保留在此页面。",
  beforeStart: "开始之前，",
  firstExpert: "添加第一位专家",
  exampleKicker: "从示例开始",
} satisfies HomeCopy;

export default copy;
