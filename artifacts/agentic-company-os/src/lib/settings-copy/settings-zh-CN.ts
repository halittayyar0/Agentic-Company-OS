import type { SettingsCopy } from "../settings-copy";
const copy: SettingsCopy = {
  title: "连接与设置",
  description: "管理模型访问、语言和工作区外观。",
  preferences: "个人偏好",
  appearance: "外观",
  light: "浅色",
  dark: "深色",
  system: "跟随设备",
  appearanceHelp: "外观偏好保存在此浏览器中。",
  providers: "模型提供商",
  credentialHelp:
    "已配置密钥不代表连接可用。请先保存，再明确选择模型进行测试。",
  key: "新 API 密钥",
  sourceRuntime: "已保存的密钥",
  sourceEnvironment: "服务器环境密钥",
  sourceNone: "未配置密钥",
  save: "保存密钥",
  remove: "移除已保存的密钥",
  removeHelp:
    "要移除本应用保存的密钥吗？如果服务器环境中有密钥，它将生效。正在进行的请求可能仍使用旧密钥完成。",
  storedLocal:
    "密钥保存在服务器本地文件中，应用层不会加密。请保护服务器账户和备份。",
  storedDatabase:
    "密钥在共享数据库中加密存储。工作进程异步接收变更；此页面无法确认每个工作进程都已应用变更。",
  serverManaged: "由服务器管理",
  serverHelp: "请在服务器上配置此提供商。本页面不会更改其服务器设置。",
  unavailable: "当前目录中不可用",
  test: "测试模型",
  testHelp:
    "将向所选提供商发送简短提示词，可能产生费用。输出上限为 10 个 token；服务器等待 20 秒后停止等待，不会自动重试。超时不代表提供商已停止处理。",
  confirmTest: "发送测试请求",
  cancel: "取消",
  saved:
    "服务器已确认保存设置。这不代表已验证模型访问或所有工作进程的应用状态。",
  changed: "设置已在别处更改。请刷新并检查后再试。",
  unconfirmed:
    "无法确认保存结果，变更可能已生效。再次提交前请刷新并检查服务器状态。草稿仅保留在本页面中。",
  refresh: "刷新设置",
  busy: "正在处理…",
  draftHelp: "密钥草稿不会写入浏览器存储。离开或重新加载页面会清除草稿。",
  loading: "正在加载提供商设置…",
  loadError: "无法加载提供商设置。密钥和连接状态未知。",
  stale: "当前显示上次加载的设置。更改设置或发送测试前，请先成功刷新。",
  rateLimited: "请求过多。请等待一分钟，再刷新后重试。",
  testFailed:
    "无法确认测试结果。提供商可能已处理请求或收取费用。未发送自动重试请求。",
  testPassed: "此模型已响应测试请求。",
  testHistorical:
    "此结果仅对应显示的设置版本，不表示持续监控，也不保证其他模型可用。",
  testBlocked: "紧急停止已启用或其状态未知时，无法测试。",
  revision: "设置版本",
  selectedModel: "待测试模型",
  catalog: "模型目录",
  catalogHelp:
    "模型和说明来自服务器目录。可用性、价格和限制可能变化；使用前请向提供商核实。",
  search: "搜索模型",
  tools: "支持工具",
  chatOnly: "仅聊天",
  economy: "经济",
  standard: "标准",
  premium: "高级",
  reasoning: "推理",
  freeIdentifier: "免费层标识；请检查提供商限制",
  defaultModel: "默认模型",
  more: "显示更多模型",
  empty: "没有匹配的模型。",
  source: "目录原始说明",
  runtime: "服务器运行",
  browserHelp:
    "浏览器是否可见由服务器启动设置决定。此页面不读取或更改当前模式。",
  hostHelp:
    "主机命令使用服务账户的操作系统权限运行，没有隔离或权限提升。除非主机已隔离且你了解授予的访问权限，否则请保持这些功能关闭。",
  hostSettings: "默认禁止主机执行。服务器配置：",
  clear: "清除搜索",
  removeTitle: "移除此已保存的密钥？",
  notTested: "本次访问尚无测试结果",
  elapsed: "响应时间（毫秒）",
  currentChanged: "此结果属于较早的设置版本。",
  noDescription: "未提供说明。",
};
export default copy;
