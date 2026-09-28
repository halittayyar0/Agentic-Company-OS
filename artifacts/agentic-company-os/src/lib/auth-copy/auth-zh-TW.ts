import type { AuthCopy } from "../auth-copy";

const copy = {
  badge: "安全的管理員登入",
  title: "進入 AgenticOS",
  description: "此安裝受到存取金鑰保護。金鑰僅用於建立安全工作階段。",
  accessKey: "存取金鑰",
  invalidSession: "無法驗證工作階段，請重試。",
  loginFailed: "登入失敗。",
  verifying: "正在驗證…",
  signIn: "安全登入",
  checkingSession: "正在驗證安全工作階段…",
  serviceUnavailable: "工作階段服務無法使用",
  serviceUnavailableDescription: "確認安全狀態之前，工作區將保持關閉。",
  retry: "重試",
  invalidKey: "存取金鑰無效。",
} satisfies AuthCopy;

export default copy;
