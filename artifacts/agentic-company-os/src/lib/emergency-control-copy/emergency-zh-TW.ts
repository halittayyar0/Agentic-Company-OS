import type { EmergencyControlCopy } from "../emergency-control-copy";

export default {
  checking: "正在檢查緊急停止狀態",
  retryLabel: "重新檢查緊急停止狀態",
  unavailable: "無法讀取緊急停止狀態",
  stop: "緊急停止",
  resume: "恢復運作",
  resumeLabel: "恢復工作",
  stopTitle: "停止所有代理工作",
  resumeTitle: "恢復代理工作",
  stopDescription:
    "此安全停止會暫停代理聊天、任務執行、工具和已核准的操作。它不會撤銷已造成的外部影響。",
  resumeDescription:
    "任務排程、代理聊天、工具和已核准的操作將可再次執行。恢復前請確認工作區安全。",
  reason: "停止原因",
  reasonPlaceholder: "例如：正在調查非預期的瀏覽器操作",
  reasonHelp: "至少輸入 3 個字元；原因會記錄在稽核日誌中。",
  actionError: "操作未能完成，請再試一次。",
  cancel: "取消",
  applying: "正在套用…",
  confirmResume: "確認恢復工作",
  confirmStop: "確認停止所有工作",
  safetyUnknown: "無法確認安全停止狀態；新的高風險操作已停用。",
  retry: "重新檢查",
  stopActive: "緊急停止已啟用。",
} satisfies EmergencyControlCopy;
