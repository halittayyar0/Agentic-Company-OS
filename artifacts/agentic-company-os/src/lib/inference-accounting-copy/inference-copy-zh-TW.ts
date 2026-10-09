import type { InferenceAccountingCopy } from "../inference-accounting-copy";
export default {
  title: "模型用量紀錄",
  clear: "沒有未確認的用量",
  pending: "仍在回應等待期間",
  recovery_required: "用量需要核實",
  pendingHelp: "回應仍可能到達。此狀態不表示代理仍在執行。",
  recoveryHelp:
    "無法核實用量。此範圍內的新模型請求保持暫停。請保留請求編號以便排查。檢查狀態不會重新傳送請求。",
  clearHelp:
    "沒有未確認的用量紀錄阻止此範圍繼續工作。這不代表任務成功，也不授予執行權限。",
  inspect: "檢查已儲存的紀錄",
  error: "無法核實目前狀態。之前顯示的紀錄仍然保留。",
  observed: "上次檢查",
  request: "請求編號",
  tokens: "權杖",
  lowerBound: "已回報的最低用量",
  complete: "已回報的用量",
  unknownUsage: "用量未知",
  unknownCost: "未回報費用",
  more: "僅顯示最近 20 筆紀錄；未確認的紀錄排在前面。",
  states: {
    reserved: "已準備，尚未傳送",
    dispatched: "已傳送，等待用量紀錄",
    uncertain: "用量未確認",
    accounted: "用量已記錄",
    not_dispatched: "未傳送",
  },
} satisfies InferenceAccountingCopy;
