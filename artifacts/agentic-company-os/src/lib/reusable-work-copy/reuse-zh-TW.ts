import type { ReusableWorkCopy } from "../reusable-work-copy";

export default {
  incomingTitle: "選擇要使用的任務說明",
  incomingHelp: "在您選擇以新的任務說明取代之前，目前的草稿會保持不變。",
  keepCurrent: "保留目前草稿",
  useIncoming: "使用新的任務說明",
  choiceError:
    "此分頁未能儲存您的選擇。目前的文字仍可編輯。開始任務前，請重新選擇。",
  preparationOnly: "此操作只準備草稿，不會啟動任務或授予工具存取權限。",
} satisfies ReusableWorkCopy;
