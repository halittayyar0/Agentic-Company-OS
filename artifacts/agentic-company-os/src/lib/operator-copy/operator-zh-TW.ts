import type { OperatorCopy } from "../operator-copy";
const copy: OperatorCopy = {
  check: "檢查伺服器紀錄",
  checking: "正在檢查伺服器紀錄…",
  help: "檢查只讀取此請求的紀錄，不會重複執行或取消操作。",
  legacy: "此舊本機紀錄沒有伺服器復原識別碼。清除前請檢查操作的影響。",
  reserved: "伺服器已記錄請求，但尚未確認是否已送出執行。",
  dispatched: "已記錄送出執行，但最終結果尚未確認。",
  complete: "伺服器已記錄操作完成。",
  unavailable:
    "操作已完成，但已儲存的輸出無法取得。請勿僅為取得輸出而重複操作。",
  not_dispatched: "伺服器紀錄顯示，此請求未送出執行。",
  unknown: "操作可能已執行，結果仍未確認。",
  missing: "找不到相符的紀錄。這不能證明操作從未執行。",
  error: "無法驗證伺服器紀錄。請保留此警告並再次檢查。",
  browser: "已儲存的瀏覽器紀錄不會恢復控制權限。再次接管前請檢查目前頁面。",
  review: "檢查本機警告",
  reviewHelp:
    "清除此分頁的警告前，請檢查可能產生的影響。清除不會停止或重複操作。",
  reviewCheck: "我已檢查操作的影響，並理解清除只會移除此本機警告。",
  finish: "清除本機警告",
  cancel: "取消",
  changed: "紀錄已變更或無法儲存。請關閉對話框，檢查目前紀錄後重試。",
};
export default copy;
