import type { ReusableWorkCopy } from "../reusable-work-copy";

export default {
  incomingTitle: "选择要使用的任务说明",
  incomingHelp: "在您选择用新的任务说明替换之前，当前草稿会保持不变。",
  keepCurrent: "保留当前草稿",
  useIncoming: "使用新的任务说明",
  choiceError:
    "此标签页未能保存您的选择。当前文本仍可编辑。开始任务前，请重新选择。",
  preparationOnly: "此操作只准备草稿，不会启动任务或授予工具访问权限。",
  savedBrief: "已保存的任务说明",
  useBrief: "再次使用说明",
  prepareGuide: "准备个人指南",
  sourceHelp:
    "根据此来源快照准备可编辑文本。请检查是否适合下一项任务；启动工作需要单独操作。",
  guideSource: "来自本地项目 #{id} 已保存的说明。再次使用前请检查。",
  preparedGuide: "检查由已保存说明生成的指南草稿",
  guideTitleHelp:
    "来源标题完整保留。保存前请自行修改超过 120 个字符的标题，并检查指令与智能体可用性。",
  prepareProject: "准备项目",
  disabledGuideHelp:
    "此指南未启用供智能体发现。使用其文本准备项目不会改变此设置。",
  runtimeHelp:
    "新任务使用此安装中选定的连接、访问规则以及 token 和费用限制。启动前请检查设置。",
  waitingGuide: "请先完成上一次保存的检查，再检查新传入的指南。",
} satisfies ReusableWorkCopy;
