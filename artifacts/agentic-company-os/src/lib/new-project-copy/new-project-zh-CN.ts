import type { NewProjectCopy } from "../new-project-copy";

const copy = {
  draftStorageError:
    "此标签页无法保存供重新加载后恢复的草稿。你仍可在此编辑文字；重新加载或关闭标签页前，请先复制保存。",
  back: "返回项目",
  eyebrow: "新项目 · 全体团队",
  title: "提出你的想法，与团队一起实现。",
  teamDescription: (count) =>
    `无需指定唯一负责人。${count ? `${count} 位` : "所有"}活跃专家共享同一项目背景，并在需要时参与。`,
  teamUnavailable: "无法加载活跃团队，已暂停创建项目。",
  retry: "重试",
  projectName: "项目名称",
  namePlaceholder: "例如：客户洞察平台",
  brief: "目标和范围",
  briefPlaceholder: "你想实现什么？请说明成功标准、已有背景信息和预期成果…",
  projectType: "项目类型",
  finite: "以交付为目标",
  continuous: "持续进行",
  priority: "项目优先级",
  priorities: { low: "低", normal: "普通", high: "高", urgent: "紧急" },
  starting: "正在加入团队…",
  start: "启动项目",
  cadence: "工作频率",
  cadences: {
    900: "每 15 分钟",
    3600: "每小时",
    21600: "每 6 小时",
    86400: "每天",
    604800: "每周",
  },
  contextNote: "活跃专家、会议和工作记录都会保留在此项目中。",
  emergencyStop: "紧急停止已启用，无法启动新项目。草稿会保留在此页面。",
  safetyUnverified: "确认安全状态后才能启动新项目。",
  teamLoading: "正在加载团队",
  teamAria: (count) => `由 ${count} 位活跃专家组成的项目团队`,
  validationTitle: "项目信息不完整",
  validationDescription: "请输入项目名称和期望达成的结果。",
  noTeamTitle: "未找到活跃团队",
  noTeamDescription: "启动项目前，请至少启用一位专家。",
  successTitle: "项目工作区已创建",
  successDescription: (id) => `项目 #${id} 已创建，活跃专家已加入。`,
  failureTitle: "无法启动项目",
  failureDescription: "请检查网络连接和权限，然后重试。草稿会保留在此页面。",
} satisfies NewProjectCopy;

export default copy;
