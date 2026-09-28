import type { ProjectListCopy } from "../project-list-copy";

const copy = {
  eyebrow: "你的工作区",
  title: "项目",
  description: "对话、会议、团队决策和交付成果集中保存在所属项目中。",
  schedulerPaused: "任务调度已暂停",
  newProject: "新建项目",
  listLabel: "项目列表",
  filterLabel: "按状态筛选项目",
  collections: { all: "全部", active: "进行中", completed: "已完成" },
  search: "搜索项目",
  loading: "正在加载项目",
  errorTitle: "无法加载项目",
  errorDescription: "不会显示过期的项目数据。",
  retry: "重试",
  emptyInitialTitle: "团队已准备好开始第一个项目",
  emptyFilteredTitle: "这里没有项目",
  emptyInitialDescription: "描述你的目标，让活跃的专家在同一项目中协作。",
  emptyFilteredDescription: "请更改筛选条件或搜索词。",
  createFirst: "创建第一个项目",
  owner: (name) => `项目负责人：${name}`,
  ownerId: (id) => `项目负责人 #${id}`,
} satisfies ProjectListCopy;

export default copy;
