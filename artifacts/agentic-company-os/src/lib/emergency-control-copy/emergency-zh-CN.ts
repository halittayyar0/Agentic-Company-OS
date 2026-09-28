import type { EmergencyControlCopy } from "../emergency-control-copy";

export default {
  checking: "正在检查紧急停止状态",
  retryLabel: "重新检查紧急停止状态",
  unavailable: "无法读取紧急停止状态",
  stop: "紧急停止",
  resume: "恢复运行",
  resumeLabel: "恢复工作",
  stopTitle: "停止所有智能体工作",
  resumeTitle: "恢复智能体工作",
  stopDescription:
    "此安全停止会暂停智能体聊天、任务执行、工具和已批准的操作。它不会撤销已经产生的外部影响。",
  resumeDescription:
    "任务调度、智能体聊天、工具和已批准的操作将可以重新运行。恢复前请确认工作区安全。",
  reason: "停止原因",
  reasonPlaceholder: "例如：正在调查意外的浏览器操作",
  reasonHelp: "至少输入 3 个字符；原因会记录在审计日志中。",
  actionError: "操作未能完成，请重试。",
  cancel: "取消",
  applying: "正在应用…",
  confirmResume: "确认恢复工作",
  confirmStop: "确认停止所有工作",
  safetyUnknown: "无法确认安全停止状态；新的高风险操作已禁用。",
  retry: "重新检查",
  stopActive: "紧急停止已启用。",
} satisfies EmergencyControlCopy;
