import type { ReusableWorkCopy } from "../reusable-work-copy";

export default {
  incomingTitle: "选择要使用的任务说明",
  incomingHelp: "在您选择用新的任务说明替换之前，当前草稿会保持不变。",
  keepCurrent: "保留当前草稿",
  useIncoming: "使用新的任务说明",
  choiceError:
    "此标签页未能保存您的选择。当前文本仍可编辑。开始任务前，请重新选择。",
  preparationOnly: "此操作只准备草稿，不会启动任务或授予工具访问权限。",
} satisfies ReusableWorkCopy;
