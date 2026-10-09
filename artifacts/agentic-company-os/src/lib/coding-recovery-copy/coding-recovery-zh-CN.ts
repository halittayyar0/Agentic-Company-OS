import type { CodingRecoveryCopy } from "../coding-recovery-copy";
export default {
  title: "编程会话",
  description:
    "重置已停止且无法继续的编程会话。之前的文件和历史记录将保留。任务仍会暂停；继续之前，请检查结果不确定的操作。",
  acknowledge: "我已查看任务历史，并理解结果不确定的操作仍未确认。",
  reset: "归档并重置会话",
  checking: "正在检查会话…",
  inspect: "检查已保存的结果",
  retry: "重新发送同一请求",
  missing: "此请求尚无已保存的结果。您可以重新发送同一请求。",
  unknown: "重置结果尚未确认。提交新请求之前，请检查已保存的结果。",
  storage:
    "无法在此标签页中安全保存恢复信息。重试之前，请检查浏览器存储和任务历史。",
  snapshotError: "无法加载会话状态。请重新检查。",
  success:
    "会话已归档。之前的文件和证据已保留。任务未重新开始；继续之前，请检查未完成的操作。",
  reasons: {
    task_missing: "此任务已不存在。",
    session_missing: "此任务没有可重置的编程会话。",
    revision_changed: "会话已发生变化。提交新请求之前，请检查当前状态。",
    revision_exhausted: "无法安全增加记录版本。请联系服务器管理员。",
    task_active: "任务仍在执行或由执行器持有。请停止任务并等待清理完成。",
    session_running: "编程进程仍由执行器持有。请等待停止得到确认。",
    cleanup_unknown: "进程停止尚未确认。无法安全启动新的运行环境。",
    native_pending: "本地操作仍在等待决定或结果。请先查看该操作。",
    already_reset: "之前的会话已归档。之后获准执行的编程任务可以启动新会话。",
  },
} satisfies CodingRecoveryCopy;
