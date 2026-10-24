import type { ResultFormatCopy } from "../task-result-format-copy";
export default {
  title: "結果格式",
  plain: "自由文字",
  table: "表格",
  columns: "欄位標題",
  help: "選填。每輪完成前，結果必須依序包含這些欄位。此檢查僅驗證結構，不保證事實正確，也不授予任何權限。",
  add: "新增欄位",
  remove: "移除欄位",
  invalid:
    "請填寫 2–8 個不同的標題，每個 1–80 個字元，不含前後空白或控制字元。",
  saved: "已儲存的結果格式",
  defaults: ["負責人", "行動", "日期"],
} satisfies ResultFormatCopy;
