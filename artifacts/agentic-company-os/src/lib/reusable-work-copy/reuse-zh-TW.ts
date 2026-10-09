import type { ReusableWorkCopy } from "../reusable-work-copy";

export default {
  incomingTitle: "選擇要使用的任務說明",
  incomingHelp: "在您選擇以新的任務說明取代之前，目前的草稿會保持不變。",
  keepCurrent: "保留目前草稿",
  useIncoming: "使用新的任務說明",
  choiceError:
    "此分頁未能儲存您的選擇。目前的文字仍可編輯。開始任務前，請重新選擇。",
  preparationOnly: "此操作只準備草稿，不會啟動任務或授予工具存取權限。",
  savedBrief: "已儲存的任務說明",
  useBrief: "再次使用說明",
  prepareGuide: "準備個人指南",
  sourceHelp:
    "根據此來源快照準備可編輯文字。請檢查是否適合下一項任務；啟動工作需要另外操作。",
  guideSource: "來自本機專案 #{id} 已儲存的說明。再次使用前請檢查。",
  preparedGuide: "檢查由已儲存說明建立的指南草稿",
  guideTitleHelp:
    "來源標題完整保留。儲存前請自行修改超過 120 個字元的標題，並檢查指令與代理可用性。",
  prepareProject: "準備專案",
  disabledGuideHelp:
    "此指南尚未啟用供代理探索。使用其文字準備專案不會變更此設定。",
  runtimeHelp:
    "新任務使用此安裝中選定的連線、存取規則以及 token 與費用限制。啟動前請檢查設定。",
  waitingGuide: "請先完成上一次儲存的檢查，再檢查新傳入的指南。",
} satisfies ReusableWorkCopy;
