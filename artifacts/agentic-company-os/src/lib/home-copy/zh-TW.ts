import type { HomeCopy } from "../home-copy";

const copy = {
  deskKicker: "你的工作區",
  heroTitle: "今天我們一起完成什麼？",
  heroDescription:
    "描述你的目標。團隊會規劃工作並分配合適的專家。你可以在同一處查看進度與成果。",
  quickToolsTitle: "無需模型，立即試用實用檢查",
  quickToolsDescription: "直接在瀏覽器中檢查 CSV 或 JSON，或比較兩個清單。",
  guideLabel: "入門指南",
  guideTitle: "運作方式",
  guideSteps: [
    {
      title: "描述目標",
      text: "寫下你的需求，以及理想成果應有的樣貌。",
    },
    {
      title: "讓團隊分工",
      text: "計畫、任務與負責人會集中在專案空間。",
    },
    {
      title: "檢查結果",
      text: "檢查交付內容與驗證結果，必要時調整方向。",
    },
  ],
  controlTitle: "控制權在你手中",
  controlDescription:
    "需要核准的操作會等待你的決定。你可以從頂部選單停止工作。",
  firstUse: "第一步：檢查連線",
  meetExperts: "認識 {count} 位專家",
  seeRoles: "了解每位專家能提供哪些協助。",
  resumeKicker: "接續上次的工作",
  recentProjects: "最近的專案",
  viewAll: "檢視全部",
  projectsLoadError: "無法載入專案",
  retry: "重試",
  sharedSpacesLabel: "共用工作區",
  companyRoomTitle: "團隊討論室",
  companyRoomDescription: "向團隊提問或分享想法。相關專家會加入討論。",
  trackProjectsTitle: "追蹤專案",
  trackProjectsDescription: "在專案空間檢視計畫、任務與交付成果。",
  buildTeamTitle: "建立現成團隊",
  buildTeamDescription: "從預設團隊選擇專家與工作流程。",
  teamLoading: "正在載入團隊",
  activeTeamMembers: "{count} 位活躍團隊成員",
  projectOwner: "專案負責人",
  emptyProjectsTitle: "從這裡開始第一個專案",
  emptyProjectsDescription: "選擇上方的範例，或描述你自己的目標。",
  detailedProject: "建立詳細專案",
  open: "開啟",
  rosterLoadError: "無法載入團隊",
  rosterLoadDescription: "請檢查網路連線後重試。",
  modeGroup: "工作方式",
  modes: {
    team: {
      label: "團隊",
      hint: "團隊會依目標分配工作。",
      instruction:
        "明確訂出目標與驗收標準。將不重疊的職責交給合適的現有專家，並安排相依工作的順序。交付後請合適的專家獨立驗證成果。將結果、證據及剩餘問題彙整為一份交付說明。",
    },
    engineer: {
      label: "開發產品",
      hint: "設計、開發與測試共同服務同一目標。",
      instruction:
        "製作可運作的產品。將設計、實作與獨立品質檢查交給合適的現有專家。提供真實測試證據、執行說明與已知缺口。",
    },
    research: {
      label: "研究",
      hint: "查閱資料並提出有根據的結論。",
      instruction:
        "以來源、證據和決策為核心。區分已查證的發現、假設與推論。提供可追溯的來源、結論及不確定性。",
    },
    compare: {
      label: "比較",
      hint: "以相同標準評估不同方案。",
      instruction:
        "依相同且明確的標準評估至少兩種方案。指出資料缺口，並透過決策表提出有根據的建議。",
    },
  },
  validationShort: "請多描述一些目標：至少輸入 10 個字元。",
  validationLong: "請將目標控制在 7,000 個字元以內。",
  examples: [
    {
      label: "製作網站",
      mode: "engineer",
      prompt:
        "為我的企業製作方便在手機上使用的網站。先規劃頁面架構，再完成設計與可運作的網站。檢查表單、行動版排版和無障礙體驗，並附上測試證據。",
    },
    {
      label: "研究一個主題",
      mode: "research",
      prompt:
        "研究我的新產品構想的目標客群與現有替代方案。提供有來源的比較、使用者需求與前三個可嘗試的步驟。我的構想與目標客群是：",
    },
    {
      label: "改善流程",
      mode: "team",
      prompt:
        "簡化一項重複性工作並擬定自動化計畫。說明輸入、負責人、輸出、異常情況與檢查點。我想改善的流程是：",
    },
  ],
  projectReadyTitle: "專案空間已就緒",
  projectReadyDescription: "你可以在這裡追蹤計畫、團隊工作與交付成果。",
  projectLaunchError:
    "無法啟動專案。請檢查網路連線和模型設定後重試。你的草稿仍保留在此處。",
  desiredOutcome: "你想要的成果",
  placeholder: "例如：為我的小型企業製作可供客戶預約的網站…",
  composerHelp: "描述目標、限制條件與預期交付內容。",
  submitShortcut: "按 Ctrl / ⌘ + Enter 開始",
  startingProject: "正在啟動專案…",
  startProject: "啟動專案",
  blocked:
    "安全停止開關已啟用。啟動專案前請檢查停止狀態；你輸入的內容會保留在此頁面。",
  beforeStart: "開始之前，",
  firstExpert: "新增第一位專家",
  exampleKicker: "從範例開始",
} satisfies HomeCopy;

export default copy;
