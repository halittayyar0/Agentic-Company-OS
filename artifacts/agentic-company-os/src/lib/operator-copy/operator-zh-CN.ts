import type { OperatorCopy } from "../operator-copy";
const copy: OperatorCopy = {
  check: "检查服务器记录",
  checking: "正在检查服务器记录…",
  help: "检查只读取此请求的记录，不会重复执行或取消操作。",
  legacy: "此旧本地记录没有服务器恢复标识。清除前请检查操作的影响。",
  reserved: "服务器已记录请求，但尚未确认是否已发送执行。",
  dispatched: "已记录发送执行，但最终结果尚未确认。",
  complete: "服务器已记录操作完成。",
  unavailable: "操作已完成，但已保存的输出不可用。请勿仅为获取输出而重复操作。",
  not_dispatched: "服务器记录表明，此请求未发送执行。",
  unknown: "操作可能已执行，结果仍未确认。",
  missing: "未找到匹配的记录。这不能证明操作从未执行。",
  error: "无法核实服务器记录。请保留此警告并再次检查。",
  browser: "已保存的浏览器记录不会恢复控制权限。再次接管前请检查当前页面。",
  review: "检查本地警告",
  reviewHelp:
    "清除此标签页的警告前，请检查可能产生的影响。清除不会停止或重复操作。",
  reviewCheck: "我已检查操作的影响，并理解清除只会移除此本地警告。",
  finish: "清除本地警告",
  cancel: "取消",
  changed: "记录已更改或无法保存。请关闭对话框，检查当前记录后重试。",
};
export default copy;
