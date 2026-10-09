import type { NewProjectCopy } from "../new-project-copy";

const copy = {
  draftStorageError:
    "此分頁無法儲存供重新載入後復原的草稿。你仍可在此編輯文字；重新載入或關閉分頁前，請先複製保存。",
  back: "返回專案",
  eyebrow: "新專案 · 全體團隊",
  title: "提出你的想法，與團隊一起實現。",
  teamDescription: (count) =>
    `不必指定唯一負責人。${count ? `${count} 位` : "所有"}現役專家共享同一專案背景，並在需要時參與。`,
  teamUnavailable: "無法載入現役團隊，已暫停建立專案。",
  retry: "重試",
  projectName: "專案名稱",
  namePlaceholder: "例如：客戶洞察平台",
  brief: "目標與範圍",
  briefPlaceholder: "你想達成什麼？請說明成功標準、現有背景資訊和預期成果…",
  projectType: "專案類型",
  finite: "以交付為目標",
  continuous: "持續進行",
  priority: "專案優先順序",
  priorities: { low: "低", normal: "一般", high: "高", urgent: "緊急" },
  starting: "正在加入團隊…",
  start: "啟動專案",
  cadence: "工作頻率",
  cadences: {
    900: "每 15 分鐘",
    3600: "每小時",
    21600: "每 6 小時",
    86400: "每天",
    604800: "每週",
  },
  contextNote: "現役專家、會議和工作紀錄都會保留在此專案中。",
  emergencyStop: "緊急停止已啟用，無法啟動新專案。草稿會保留在此頁面。",
  safetyUnverified: "確認安全狀態後才能啟動新專案。",
  teamLoading: "正在載入團隊",
  teamAria: (count) => `由 ${count} 位現役專家組成的專案團隊`,
  validationTitle: "專案資訊不完整",
  validationDescription: "請輸入專案名稱和期望達成的結果。",
  noTeamTitle: "找不到現役團隊",
  noTeamDescription: "啟動專案前，請至少啟用一位專家。",
  successTitle: "專案工作區已建立",
  successDescription: (id) => `專案 #${id} 已建立，現役專家已加入。`,
  failureTitle: "無法啟動專案",
  failureDescription: "請檢查網路連線和權限，然後重試。草稿會保留在此頁面。",
} satisfies NewProjectCopy;

export default copy;
