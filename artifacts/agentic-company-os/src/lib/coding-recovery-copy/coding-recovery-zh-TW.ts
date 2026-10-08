import type { CodingRecoveryCopy } from "../coding-recovery-copy";
export default {
  title: "程式開發工作階段",
  description:
    "重設已停止且無法繼續的程式開發工作階段。先前的檔案與歷史紀錄會保留。任務仍會暫停；繼續之前，請檢查結果不確定的操作。",
  acknowledge: "我已查看任務歷史，並了解結果不確定的操作仍未確認。",
  reset: "封存並重設工作階段",
  checking: "正在檢查工作階段…",
  inspect: "檢查已儲存的結果",
  retry: "重新傳送同一個請求",
  missing: "此請求尚無已儲存的結果。您可以重新傳送同一個請求。",
  unknown: "重設結果尚未確認。提交新請求之前，請檢查已儲存的結果。",
  storage:
    "無法在此分頁中安全儲存復原資訊。重試之前，請檢查瀏覽器儲存空間及任務歷史。",
  snapshotError: "無法載入工作階段狀態。請重新檢查。",
  success:
    "工作階段已封存。先前的檔案與證據已保留。任務未重新開始；繼續之前，請檢查未完成的操作。",
  reasons: {
    task_missing: "此任務已不存在。",
    session_missing: "此任務沒有可重設的程式開發工作階段。",
    revision_changed: "工作階段已變更。提交新請求之前，請檢查目前狀態。",
    revision_exhausted: "無法安全增加紀錄版本。請聯絡伺服器管理員。",
    task_active: "任務仍在執行或由執行器持有。請停止任務並等待清理完成。",
    session_running: "程式開發程序仍由執行器持有。請等待停止狀態獲得確認。",
    cleanup_unknown: "程序停止尚未確認。無法安全啟動新的執行環境。",
    native_pending: "本機操作仍在等待決定或結果。請先查看該操作。",
    already_reset:
      "先前的工作階段已封存。之後獲准執行的程式開發任務可以啟動新工作階段。",
  },
} satisfies CodingRecoveryCopy;
