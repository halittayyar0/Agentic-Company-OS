import type { InferenceAccountingCopy } from "../inference-accounting-copy";
export default {
  title: "模型用量记录",
  clear: "没有未确认的用量",
  pending: "仍在响应等待期内",
  recovery_required: "用量需要核实",
  pendingHelp: "响应仍可能到达。此状态不表示代理仍在运行。",
  recoveryHelp:
    "无法核实用量。此范围内的新模型请求保持暂停。请保留请求编号以便排查。检查状态不会重新发送请求。",
  clearHelp:
    "没有未确认的用量记录阻止此范围继续工作。这不代表任务成功，也不授予执行权限。",
  inspect: "检查已保存的记录",
  error: "无法核实当前状态。之前显示的记录仍然保留。",
  observed: "上次检查",
  request: "请求编号",
  tokens: "令牌",
  lowerBound: "已报告的最低用量",
  complete: "已报告的用量",
  unknownUsage: "用量未知",
  unknownCost: "未报告费用",
  more: "仅显示最近 20 条记录；未确认的记录排在前面。",
  states: {
    reserved: "已准备，尚未发送",
    dispatched: "已发送，等待用量记录",
    uncertain: "用量未确认",
    accounted: "用量已记录",
    not_dispatched: "未发送",
  },
} satisfies InferenceAccountingCopy;
