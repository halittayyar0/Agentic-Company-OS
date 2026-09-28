import type { ProjectListCopy } from "../project-list-copy";

const copy = {
  eyebrow: "你的工作區",
  title: "專案",
  description: "對話、會議、團隊決策與交付成果都集中保存在所屬專案中。",
  schedulerPaused: "工作排程已暫停",
  newProject: "新增專案",
  listLabel: "專案列表",
  filterLabel: "依狀態篩選專案",
  collections: { all: "全部", active: "進行中", completed: "已完成" },
  search: "搜尋專案",
  loading: "正在載入專案",
  errorTitle: "無法載入專案",
  errorDescription: "不會顯示過期的專案資料。",
  retry: "重試",
  emptyInitialTitle: "團隊已準備好開始第一個專案",
  emptyFilteredTitle: "這裡沒有專案",
  emptyInitialDescription: "描述你的目標，讓現役專家在同一專案中協作。",
  emptyFilteredDescription: "請變更篩選條件或搜尋詞。",
  createFirst: "建立第一個專案",
  owner: (name) => `專案負責人：${name}`,
  ownerId: (id) => `專案負責人 #${id}`,
} satisfies ProjectListCopy;

export default copy;
