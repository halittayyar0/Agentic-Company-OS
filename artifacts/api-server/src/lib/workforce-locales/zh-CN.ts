import type { WorkforceCatalogCopy } from "../workforce-localization";

export default {
  "product-shipping-crew": {
    name: "产品交付团队",
    tagline: "验证问题，交付产品，证明成果。",
    description:
      "由一位负责人统筹的跨职能团队，通过研究、实施和质量证据，推动从需求探索到技术交付的产品决策。",
    recommendedFor: [
      "新功能或新产品线",
      "尚不明确的客户问题",
      "需要研究、开发和质量验证的交付",
    ],
    triggerLabels: ["产品", "功能", "MVP", "发布", "交付"],
    members: {
      "product-lead": {
        name: "产品协调员",
        role: "产品交付负责人",
        mission:
          "将业务成果和用户问题转化为可衡量的验收标准，在同一交付计划中协调探索、工程和质量工作。",
        capabilities: ["问题界定", "交付计划", "依赖管理", "成果评审"],
      },
      "discovery-researcher": {
        name: "需求研究员",
        role: "产品需求研究员",
        mission:
          "利用最新来源和可追溯证据，验证目标用户的工作、现有替代方案及关键假设。",
        capabilities: ["用户研究", "竞品研究", "证据矩阵"],
      },
      "delivery-engineer": {
        name: "交付工程师",
        role: "产品交付工程师",
        mission:
          "将已批准的范围转化为兼容现有架构、安全且可测试的最小生产变更。",
        capabilities: ["技术设计", "实施", "测试自动化", "发布准备"],
      },
      "quality-reviewer": {
        name: "质量评审员",
        role: "产品质量评审员",
        mission:
          "独立检查需求、无障碍使用、故障行为和证据充分性，将缺口转化为具体的修正要求。",
        capabilities: ["验收测试", "边界情况评审", "证据审查"],
      },
    },
    handoffs: {
      "discovery-researcher/product-lead/review":
        "提交问题证据、不确定因素和建议范围，供负责人决策。",
      "product-lead/delivery-engineer/ai":
        "将已批准的范围、验收标准和证据要求作为实施任务说明移交。",
      "delivery-engineer/quality-reviewer/next":
        "将实施成果及已执行的检查移交独立质量评审。",
      "quality-reviewer/product-lead/review":
        "报告已通过的检查、剩余缺口和发布建议，供负责人决策。",
    },
  },
  "go-to-market-crew": {
    name: "市场进入团队",
    tagline: "面向合适的客户，以证据支撑信息，以数据衡量需求。",
    description:
      "将理想客户研究与定位、内容及销售启动相结合的增长团队，不把草稿当作真实联系或收入。",
    recommendedFor: [
      "产品发布或进入新市场",
      "B2B 需求开发",
      "营销信息与渠道验证",
    ],
    triggerLabels: ["增长", "销售", "营销活动", "GTM", "销售管道"],
    members: {
      "gtm-lead": {
        name: "市场进入协调员",
        role: "市场进入负责人",
        mission:
          "将理想客户画像、方案、渠道及销售方式纳入同一衡量计划，使团队产出与合格需求相联系。",
        capabilities: ["市场进入策略", "信息层级", "渠道组合", "实验管理"],
      },
      "market-analyst": {
        name: "市场分析师",
        role: "市场情报分析师",
        mission:
          "根据一手来源梳理目标客户、购买触发因素、替代方案及差异化证据。",
        capabilities: ["理想客户研究", "客户信号", "竞品证据"],
      },
      "campaign-builder": {
        name: "营销活动设计师",
        role: "营销活动与内容专员",
        mission:
          "将已验证的信息转化为适合渠道、有来源且可衡量的营销材料，保留主张与证据之间的联系。",
        capabilities: ["营销活动简报", "内容创作", "渠道适配"],
      },
      "revenue-operator": {
        name: "销售运营专员",
        role: "销售启动专员",
        mission:
          "筛选优先客户，准备个性化联系草稿，并将每次进展记录为有证据支持的销售阶段。",
        capabilities: ["客户优先级", "联系草稿", "商机筛选", "销售管道证据"],
      },
    },
    handoffs: {
      "market-analyst/gtm-lead/review":
        "提交理想客户及差异化证据，供负责人审核营销信息决策。",
      "gtm-lead/campaign-builder/ai":
        "将已批准的客群、方案、主张边界和渠道衡量方式作为制作任务说明移交。",
      "campaign-builder/revenue-operator/next":
        "移交已批准的信息和证据材料，用于具体客户的销售启动；发送操作始终由用户控制。",
      "revenue-operator/gtm-lead/review":
        "单独报告实际联系及销售管道证据，不与草稿或活动指标混淆。",
    },
  },
  "incident-command-flow": {
    name: "事件响应流程",
    tagline: "控制影响，查明原因，安全恢复。",
    description:
      "按顺序执行分级、调查、恢复验证和相关方沟通的受控流程，用于处理运营或技术事件。",
    recommendedFor: [
      "生产事件或服务中断",
      "疑似安全问题",
      "反复发生的运营故障",
    ],
    triggerLabels: ["事件", "中断", "故障", "安全", "SLA"],
    members: {
      "incident-lead": {
        name: "事件指挥员",
        role: "事件响应负责人",
        mission:
          "从影响评估到恢复维护统一事件记录，根据客户影响、安全性及可逆性确定优先级。",
        capabilities: ["事件分级", "事件时间线", "决策与责任", "恢复验收"],
      },
      "systems-investigator": {
        name: "系统调查员",
        role: "系统调查专员",
        mission:
          "将症状转化为可复现证据，通过检查日志、变更及依赖关系逐步缩小根因假设范围。",
        capabilities: ["技术分级", "日志分析", "根因假设"],
      },
      "risk-reviewer": {
        name: "风险评审员",
        role: "安全与恢复评审员",
        mission: "独立验证建议修复的安全性、数据完整性、回滚方案和复发风险。",
        capabilities: ["风险评估", "回滚检查", "恢复验证"],
      },
      "stakeholder-reporter": {
        name: "相关方报告员",
        role: "事件沟通专员",
        mission:
          "根据已核实的事件事实准备清晰的沟通草稿，说明影响、当前状态、下次更新及用户需要采取的行动。",
        capabilities: ["状态摘要", "客户沟通草稿", "事后复盘"],
      },
    },
    handoffs: {
      "incident-lead/systems-investigator/next":
        "移交影响已受控的事件背景、时间线和安全调查边界。",
      "systems-investigator/risk-reviewer/review":
        "提交根因证据、建议修复及回滚计划，进行独立评审。",
      "risk-reviewer/incident-lead/review":
        "向负责人反馈恢复建议、已通过的检查、未解决风险及回滚条件。",
      "incident-lead/stakeholder-reporter/ai":
        "要求仅使用已核实的事件时间线和已批准状态撰写相关方沟通草稿。",
    },
  },
} satisfies WorkforceCatalogCopy;
