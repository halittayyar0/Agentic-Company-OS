import type { WorkforceCatalogCopy } from "../workforce-localization";

export default {
  "product-shipping-crew": {
    name: "產品交付團隊",
    tagline: "驗證問題，交付產品，證明成果。",
    description:
      "由一位負責人統籌的跨職能團隊，透過研究、實作與品質證據，推動從需求探索到技術交付的產品決策。",
    recommendedFor: [
      "新功能或新產品線",
      "尚不明確的客戶問題",
      "需要研究、開發與品質驗證的交付",
    ],
    triggerLabels: ["產品", "功能", "MVP", "發佈", "交付"],
    members: {
      "product-lead": {
        name: "產品協調員",
        role: "產品交付負責人",
        mission:
          "將業務成果與使用者問題轉化為可衡量的驗收標準，在同一交付計畫中協調探索、工程與品質工作。",
        capabilities: ["問題界定", "交付計畫", "相依關係管理", "成果審查"],
      },
      "discovery-researcher": {
        name: "需求研究員",
        role: "產品需求研究員",
        mission:
          "利用最新來源與可追溯證據，驗證目標使用者的工作、現有替代方案及關鍵假設。",
        capabilities: ["使用者研究", "競品研究", "證據矩陣"],
      },
      "delivery-engineer": {
        name: "交付工程師",
        role: "產品交付工程師",
        mission:
          "將已核准的範圍轉化為相容於現有架構、安全且可測試的最小正式環境變更。",
        capabilities: ["技術設計", "實作", "測試自動化", "發佈準備"],
      },
      "quality-reviewer": {
        name: "品質審查員",
        role: "產品品質審查員",
        mission:
          "獨立檢查需求、無障礙使用、故障行為與證據充分性，將缺口轉化為具體的修正要求。",
        capabilities: ["驗收測試", "邊界情況審查", "證據查核"],
      },
    },
    handoffs: {
      "discovery-researcher/product-lead/review":
        "提交問題證據、不確定因素與建議範圍，供負責人決策。",
      "product-lead/delivery-engineer/ai":
        "將已核准的範圍、驗收標準與證據要求作為實作任務說明移交。",
      "delivery-engineer/quality-reviewer/next":
        "將實作成果及已執行的檢查移交獨立品質審查。",
      "quality-reviewer/product-lead/review":
        "報告已通過的檢查、剩餘缺口與發佈建議，供負責人決策。",
    },
  },
  "go-to-market-crew": {
    name: "市場進入團隊",
    tagline: "面向合適的客戶，以證據支撐訊息，以數據衡量需求。",
    description:
      "將理想客戶研究與定位、內容及銷售啟動相結合的成長團隊，不把草稿當作真實聯繫或營收。",
    recommendedFor: [
      "產品發佈或進入新市場",
      "B2B 需求開發",
      "行銷訊息與通路驗證",
    ],
    triggerLabels: ["成長", "銷售", "行銷活動", "GTM", "銷售管道"],
    members: {
      "gtm-lead": {
        name: "市場進入協調員",
        role: "市場進入負責人",
        mission:
          "將理想客戶輪廓、方案、通路及銷售方式納入同一衡量計畫，使團隊產出與合格需求相連結。",
        capabilities: ["市場進入策略", "訊息層級", "通路組合", "實驗管理"],
      },
      "market-analyst": {
        name: "市場分析師",
        role: "市場情報分析師",
        mission:
          "根據第一手來源整理目標客戶、購買觸發因素、替代方案及差異化證據。",
        capabilities: ["理想客戶研究", "客戶訊號", "競品證據"],
      },
      "campaign-builder": {
        name: "行銷活動設計師",
        role: "行銷活動與內容專員",
        mission:
          "將已驗證的訊息轉化為適合通路、有來源且可衡量的行銷素材，保留主張與證據之間的連結。",
        capabilities: ["行銷活動簡報", "內容創作", "通路調整"],
      },
      "revenue-operator": {
        name: "銷售營運專員",
        role: "銷售啟動專員",
        mission:
          "篩選優先客戶，準備個人化聯繫草稿，並將每次進展記錄為有證據支持的銷售階段。",
        capabilities: ["客戶優先順序", "聯繫草稿", "商機篩選", "銷售管道證據"],
      },
    },
    handoffs: {
      "market-analyst/gtm-lead/review":
        "提交理想客戶及差異化證據，供負責人審查行銷訊息決策。",
      "gtm-lead/campaign-builder/ai":
        "將已核准的客群、方案、主張界線與通路衡量方式作為製作任務說明移交。",
      "campaign-builder/revenue-operator/next":
        "移交已核准的訊息與證據素材，用於特定客戶的銷售啟動；傳送操作始終由使用者控制。",
      "revenue-operator/gtm-lead/review":
        "分別報告實際聯繫及銷售管道證據，不與草稿或活動指標混淆。",
    },
  },
  "incident-command-flow": {
    name: "事件應變流程",
    tagline: "控制影響，查明原因，安全復原。",
    description:
      "依序執行分級、調查、復原驗證與利害關係人溝通的受控流程，用於處理營運或技術事件。",
    recommendedFor: [
      "正式環境事件或服務中斷",
      "疑似安全問題",
      "反覆發生的營運故障",
    ],
    triggerLabels: ["事件", "中斷", "故障", "安全", "SLA"],
    members: {
      "incident-lead": {
        name: "事件指揮員",
        role: "事件應變負責人",
        mission:
          "從影響評估到復原維護統一事件紀錄，依客戶影響、安全性及可逆性決定優先順序。",
        capabilities: ["事件分級", "事件時間軸", "決策與責任", "復原驗收"],
      },
      "systems-investigator": {
        name: "系統調查員",
        role: "系統調查專員",
        mission:
          "將症狀轉化為可重現證據，透過檢查紀錄、變更及相依關係，逐步縮小根因假設範圍。",
        capabilities: ["技術分級", "紀錄分析", "根因假設"],
      },
      "risk-reviewer": {
        name: "風險審查員",
        role: "安全與復原審查員",
        mission: "獨立驗證建議修正的安全性、資料完整性、回復方案及復發風險。",
        capabilities: ["風險評估", "回復檢查", "復原驗證"],
      },
      "stakeholder-reporter": {
        name: "利害關係人報告員",
        role: "事件溝通專員",
        mission:
          "根據已查證的事件事實準備清楚的溝通草稿，說明影響、目前狀態、下次更新及使用者需要採取的行動。",
        capabilities: ["狀態摘要", "客戶溝通草稿", "事後檢討"],
      },
    },
    handoffs: {
      "incident-lead/systems-investigator/next":
        "移交影響已受控的事件背景、時間軸與安全調查界線。",
      "systems-investigator/risk-reviewer/review":
        "提交根因證據、建議修正與回復計畫，進行獨立審查。",
      "risk-reviewer/incident-lead/review":
        "向負責人回報復原建議、已通過的檢查、未解決風險及回復條件。",
      "incident-lead/stakeholder-reporter/ai":
        "要求僅使用已查證的事件時間軸與已核准狀態撰寫利害關係人溝通草稿。",
    },
  },
} satisfies WorkforceCatalogCopy;
