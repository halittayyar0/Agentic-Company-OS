import type { ResultFormatCopy } from "../task-result-format-copy";
export default {
  title: "结果格式",
  plain: "自由文本",
  table: "表格",
  columns: "列标题",
  help: "可选。每轮完成前，结果必须按顺序包含这些列。此检查仅验证结构，不保证事实准确，也不授予任何权限。",
  add: "添加列",
  remove: "删除列",
  invalid:
    "请填写 2–8 个不同的标题，每个 1–80 个字符，不含首尾空格或控制字符。",
  saved: "已保存的结果格式",
  defaults: ["负责人", "行动", "日期"],
} satisfies ResultFormatCopy;
